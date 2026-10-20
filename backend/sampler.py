"""
sampler.py - background live sampler (started once by app.py).

Two daemon threads run for as long as the server runs:

  sampler thread  every 1 s : read_rssi() -> ring buffer of the last 120 samples
                  every 10 s: scan_networks() -> latest list of nearby networks
  ping thread     every 1 s : ping the router (default gateway, or 8.8.8.8)
                              -> latency of the last 30 pings -> jitter, packet loss

Everything else reads from here instead of touching the Wi-Fi adapter:
  - /api/stream  pushes every new sample to the browser (Server-Sent Events)
  - /measure and /walk wait for N *fresh* samples and average them

"Daemon" threads stop automatically when the main program exits.
"""

import platform
import queue
import re
import subprocess
import threading
import time
from collections import deque

from wifi_reader import read_rssi, scan_networks

HISTORY_SIZE = 120     # samples kept (2 minutes at 1 per second)
PING_WINDOW = 30       # pings used for jitter / packet loss
SCAN_EVERY_S = 10      # seconds between network scans
DEAD_DBM = -75         # below this the stream raises a dead-zone alert


# ------------------------------------------------------------------ ping helpers
def find_gateway():
    """IP of the default gateway (the router), or None if it cannot be found."""
    system = platform.system()
    try:
        if system == "Windows":
            # route print: "0.0.0.0   0.0.0.0   192.168.0.1   192.168.0.96   25"
            out = subprocess.run(["route", "print", "-4", "0.0.0.0"], capture_output=True,
                                 text=True, timeout=5).stdout
            match = re.search(r"^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)", out, re.M)
        elif system == "Linux":
            out = subprocess.run(["ip", "route", "show", "default"], capture_output=True,
                                 text=True, timeout=5).stdout
            match = re.search(r"default via (\d+\.\d+\.\d+\.\d+)", out)
        else:  # macOS
            out = subprocess.run(["route", "-n", "get", "default"], capture_output=True,
                                 text=True, timeout=5).stdout
            match = re.search(r"gateway:\s*(\d+\.\d+\.\d+\.\d+)", out)
        return match.group(1) if match else None
    except (OSError, subprocess.SubprocessError):
        return None


def ping_once(host):
    """One ping -> round-trip time in ms, or None if it was lost."""
    system = platform.system()
    if system == "Windows":
        cmd = ["ping", "-n", "1", "-w", "1000", host]
    elif system == "Darwin":
        cmd = ["ping", "-c", "1", "-t", "1", host]
    else:
        cmd = ["ping", "-c", "1", "-W", "1", host]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    # "time=2ms" (Windows), "time<1ms" (Windows, very fast), "time=2.31 ms" (Linux/macOS)
    match = re.search(r"time[=<]\s*([\d.]+)\s*ms", out)
    return float(match.group(1)) if match else None


def ping_stats(pings):
    """Latency / jitter / packet loss from a list of ping results (None = lost).
    jitter = average change between consecutive successful pings (RFC 3550 idea)."""
    if not pings:
        return {"latency_ms": None, "jitter_ms": None, "loss_pct": None}
    ok = [p for p in pings if p is not None]
    jitter = (sum(abs(a - b) for a, b in zip(ok, ok[1:])) / (len(ok) - 1)) if len(ok) > 1 else None
    return {
        "latency_ms": round(ok[-1], 1) if ok and pings[-1] is not None else None,
        "jitter_ms": round(jitter, 1) if jitter is not None else None,
        "loss_pct": round(100 * (len(pings) - len(ok)) / len(pings), 1),
    }


# ------------------------------------------------------------------ the sampler
class Sampler:
    def __init__(self):
        self.samples = deque(maxlen=HISTORY_SIZE)   # ring buffer: oldest drop off
        self.pings = deque(maxlen=PING_WINDOW)
        self.count = 0                               # total samples ever taken
        self.networks, self.networks_time, self.networks_error = [], None, None
        self.gateway = None
        self.new_sample = threading.Condition()      # wakes up threads waiting for samples
        self.listeners = []                          # one queue per open /api/stream
        self.listeners_lock = threading.Lock()
        self.started = False

    def start(self):
        if self.started:
            return
        self.started = True
        threading.Thread(target=self._sample_loop, name="sampler", daemon=True).start()
        threading.Thread(target=self._ping_loop, name="pinger", daemon=True).start()

    # -- thread 1: RSSI every second, network scan every 10 s
    def _sample_loop(self):
        last_scan = 0.0
        while True:
            started = time.time()
            reading = read_rssi()
            sample = {**reading, "time": round(started, 3), **ping_stats(list(self.pings))}
            sample["alert"] = reading["rssi"] is not None and reading["rssi"] < DEAD_DBM
            with self.new_sample:
                self.samples.append(sample)
                self.count += 1
                self.new_sample.notify_all()
            self.publish("sample", sample)

            if started - last_scan >= SCAN_EVERY_S:
                last_scan = started
                try:
                    self.networks, self.networks_error = scan_networks(), None
                    self.networks_time = round(time.time(), 3)
                except RuntimeError as exc:
                    self.networks_error = str(exc)

            time.sleep(max(0.0, 1.0 - (time.time() - started)))

    # -- thread 2: ping the router every second
    def _ping_loop(self):
        self.gateway = find_gateway() or "8.8.8.8"
        while True:
            started = time.time()
            self.pings.append(ping_once(self.gateway))
            time.sleep(max(0.0, 1.0 - (time.time() - started)))

    # -- reading data
    def latest(self):
        return self.samples[-1] if self.samples else None

    def history(self):
        return list(self.samples)

    def quality(self):
        return {**ping_stats(list(self.pings)), "gateway": self.gateway}

    def wait_for_samples(self, n, timeout=None):
        """Block until n NEW samples have arrived, then return them.
        (Samples already in the buffer are ignored - the user may have just moved.)"""
        timeout = timeout or n * 1.5 + 5
        with self.new_sample:
            start = self.count
            ok = self.new_sample.wait_for(lambda: self.count - start >= n, timeout=timeout)
            fresh = list(self.samples)[-(self.count - start):] if self.count > start else []
        if not ok:
            raise TimeoutError(f"Only {len(fresh)} of {n} samples arrived in {timeout:.0f} s.")
        return fresh[-n:]

    # -- live stream (Server-Sent Events) fan-out
    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.listeners_lock:
            self.listeners.append(q)
        return q

    def unsubscribe(self, q):
        with self.listeners_lock:
            if q in self.listeners:
                self.listeners.remove(q)

    def publish(self, event, data):
        """Send an event to every open dashboard. A slow/closed client whose
        queue is full simply misses events instead of blocking the sampler."""
        with self.listeners_lock:
            for q in self.listeners:
                try:
                    q.put_nowait((event, data))
                except queue.Full:
                    pass


sampler = Sampler()   # the single shared instance used by app.py
