"""
wifi_reader.py - reads the Wi-Fi signal strength (RSSI) of THIS laptop.

RSSI = Received Signal Strength Indicator, in dBm (decibel-milliwatts).
It is always negative: -40 dBm is very strong, -90 dBm is almost nothing.

read_rssi() returns a dict:
    {"rssi": -52.0, "ssid": "MyWiFi", "method": "netsh-rssi", "error": None}
If something goes wrong, "rssi" is None and "error" explains why.

Each operating system exposes the value differently:
    Windows : `netsh wlan show interfaces`      ("Rssi" line, or "Signal: N%")
    Linux   : /proc/net/wireless                (level column) + `iwgetid -r`
    macOS   : `system_profiler SPAirPortDataType` ("Signal / Noise" line)
"""

import platform
import re
import subprocess

# Message shown when Windows 11 blocks Wi-Fi info because Location is off.
WINDOWS_LOCATION_HELP = (
    "Windows is blocking Wi-Fi details because Location access is off. "
    "Open Settings > Privacy & security > Location, turn on 'Location services' "
    "and 'Let desktop apps access your location', then try again."
)


def _result(rssi=None, ssid=None, method=None, error=None):
    """Build the standard result dictionary returned by every reader."""
    return {"rssi": rssi, "ssid": ssid, "method": method, "error": error}


def _run(cmd):
    """Run a command and return its text output (stdout + stderr)."""
    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=15, errors="replace"
    )
    return (proc.stdout or "") + (proc.stderr or "")


# --------------------------------------------------------------------- Windows
def percent_to_dbm(percent):
    """Windows 'Signal: N%' -> approximate dBm.  dBm = N/2 - 100
    (0 % = -100 dBm, 100 % = -50 dBm, the mapping Windows itself uses)."""
    return percent / 2 - 100


def parse_netsh(text):
    """Parse the output of `netsh wlan show interfaces` (kept separate so it
    can be tested without a Wi-Fi card)."""
    lowered = text.lower()

    # Windows 11 (24H2+) refuses to show WLAN info without Location permission.
    if "location permission" in lowered or "privacy-location" in lowered:
        return _result(method="netsh", error=WINDOWS_LOCATION_HELP)

    if "there is no wireless interface" in lowered or "wlan autoconfig" in lowered:
        return _result(method="netsh", error="No Wi-Fi adapter found (or WLAN service stopped).")

    # Each line looks like "    Name      : value". Build a small dictionary.
    fields = {}
    for line in text.splitlines():
        match = re.match(r"^\s*([^:]+?)\s*:\s*(.*)$", line)
        if match:
            fields.setdefault(match.group(1).strip().lower(), match.group(2).strip())

    state = fields.get("state", "")
    if state and state != "connected":
        return _result(method="netsh", error=f"Wi-Fi is not connected (state: {state}). Connect to a network first.")

    ssid = fields.get("ssid") or None

    # Newer Windows 11 prints the real RSSI in dBm - prefer it.
    if "rssi" in fields:
        try:
            return _result(float(fields["rssi"]), ssid, "netsh-rssi")
        except ValueError:
            pass

    # Otherwise convert the signal quality percentage.
    if "signal" in fields:
        percent = re.match(r"(\d+)", fields["signal"])
        if percent:
            return _result(percent_to_dbm(int(percent.group(1))), ssid, "netsh-signal%")

    return _result(method="netsh", error="Could not find a Signal/Rssi line in netsh output.")


def _read_windows():
    return parse_netsh(_run(["netsh", "wlan", "show", "interfaces"]))


# ----------------------------------------------------------------------- Linux
def _read_linux():
    """/proc/net/wireless has 2 header lines, then one line per interface:
    ' wlan0: 0000   54.  -56.  -256 ...'  ->  columns: status, link, LEVEL, noise"""
    try:
        with open("/proc/net/wireless") as f:
            lines = f.readlines()[2:]
    except OSError as exc:
        return _result(method="proc", error=f"Cannot read /proc/net/wireless: {exc}")
    if not lines:
        return _result(method="proc", error="No wireless interface is connected.")

    parts = lines[0].split()
    level = float(parts[3].rstrip("."))
    if level > 0:            # some drivers report an unsigned byte
        level -= 256

    try:
        ssid = _run(["iwgetid", "-r"]).strip() or None
    except (OSError, subprocess.SubprocessError):
        ssid = None
    return _result(level, ssid, "proc-net-wireless")


# ----------------------------------------------------------------------- macOS
def _read_macos():
    text = _run(["system_profiler", "SPAirPortDataType"])
    match = re.search(r"Signal / Noise:\s*(-?\d+)\s*dBm", text)
    if not match:
        return _result(method="system_profiler", error="Not connected, or no 'Signal / Noise' line found.")
    # The SSID is the line ending in ':' right after "Current Network Information:".
    ssid = re.search(r"Current Network Information:\s*\n\s*(.+?):\s*\n", text)
    return _result(float(match.group(1)), ssid.group(1) if ssid else None, "system_profiler")


# ------------------------------------------------------------------ public API
def read_rssi():
    """Read the current RSSI on whatever OS we are running on."""
    system = platform.system()
    try:
        if system == "Windows":
            return _read_windows()
        if system == "Linux":
            return _read_linux()
        if system == "Darwin":
            return _read_macos()
        return _result(error=f"Unsupported operating system: {system}")
    except FileNotFoundError as exc:
        return _result(error=f"Required system tool not found: {exc}")
    except subprocess.TimeoutExpired:
        return _result(error="Reading the Wi-Fi adapter timed out.")


if __name__ == "__main__":
    # Quick self-test:  python wifi_reader.py
    reading = read_rssi()
    print(reading)
    if reading["error"]:
        print("ERROR:", reading["error"])
    else:
        print(f"Connected to '{reading['ssid']}' at {reading['rssi']:.1f} dBm ({reading['method']})")
