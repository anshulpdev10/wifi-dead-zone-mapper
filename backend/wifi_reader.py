"""
wifi_reader.py - reads Wi-Fi information from THIS laptop's own adapter.

RSSI = Received Signal Strength Indicator, in dBm (decibel-milliwatts).
It is always negative: -40 dBm is very strong, -90 dBm is almost nothing.

Two public functions:

read_rssi()      -> the network we are connected to
    {"rssi": -52.0, "ssid": "MyWiFi", "bssid": "8c:86:..", "channel": 149,
     "band": "5 GHz", "method": "netsh-rssi", "error": None}
    If something goes wrong, "rssi" is None and "error" explains why.

scan_networks()  -> every network the adapter can hear
    [{"ssid", "bssid", "rssi", "channel", "band", "connected"}, ...]

Each operating system exposes this differently:
    Windows : `netsh wlan show interfaces` / `netsh wlan show networks mode=bssid`
    Linux   : /proc/net/wireless + `iw dev <iface> link` (or iwgetid) / `nmcli dev wifi list`
    macOS   : `system_profiler SPAirPortDataType`
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


def _result(rssi=None, ssid=None, bssid=None, channel=None, band=None, method=None, error=None):
    """Build the standard result dictionary returned by read_rssi()."""
    return {"rssi": rssi, "ssid": ssid, "bssid": bssid, "channel": channel,
            "band": band, "method": method, "error": error}


def _decode(raw):
    """Command output -> text. SSIDs are raw UTF-8 bytes (emoji, Hindi names...),
    so try UTF-8 first and fall back to the system code page."""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("mbcs" if platform.system() == "Windows" else "latin-1", errors="replace")


def _run(cmd):
    """Run a command and return its text output (stdout + stderr)."""
    proc = subprocess.run(cmd, capture_output=True, timeout=15)
    return _decode(proc.stdout or b"") + _decode(proc.stderr or b"")


def percent_to_dbm(percent):
    """Windows 'Signal: N%' -> approximate dBm.  dBm = N/2 - 100
    (0 % = -100 dBm, 100 % = -50 dBm, the mapping Windows itself uses)."""
    return percent / 2 - 100


def band_from_channel(channel):
    """Channels 1-14 are the 2.4 GHz band; everything above is 5 GHz."""
    if channel is None:
        return None
    return "2.4 GHz" if 1 <= channel <= 14 else "5 GHz"


def channel_from_freq(mhz):
    """Centre frequency (MHz) -> channel number (used on Linux)."""
    if mhz == 2484:
        return 14
    if 2412 <= mhz <= 2472:
        return (mhz - 2407) // 5
    if 5000 <= mhz <= 5900:
        return (mhz - 5000) // 5
    return None


def _int(text):
    """First whole number in a string, or None."""
    match = re.search(r"\d+", text or "")
    return int(match.group()) if match else None


def _clean_band(text, channel):
    """Use the band the OS reports ("2.4 GHz", "5 GHz", "6 GHz"), else work it out."""
    match = re.search(r"(2\.4|5|6)\s*GHz", text or "")
    return f"{match.group(1)} GHz" if match else band_from_channel(channel)


def _location_blocked(text):
    lowered = text.lower()
    return "location permission" in lowered or "privacy-location" in lowered


# ===================================================================== Windows
def parse_netsh(text):
    """Parse `netsh wlan show interfaces` (kept separate so it can be tested
    without a Wi-Fi card)."""
    lowered = text.lower()
    if _location_blocked(text):
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

    channel = _int(fields.get("channel"))
    info = {
        "ssid": fields.get("ssid") or None,
        "bssid": fields.get("ap bssid") or fields.get("bssid") or None,
        "channel": channel,
        "band": _clean_band(fields.get("band"), channel),
    }

    # Newer Windows 11 prints the real RSSI in dBm - prefer it.
    if "rssi" in fields:
        try:
            return _result(float(fields["rssi"]), method="netsh-rssi", **info)
        except ValueError:
            pass
    # Otherwise convert the signal quality percentage.
    percent = _int(fields.get("signal"))
    if percent is not None:
        return _result(percent_to_dbm(percent), method="netsh-signal%", **info)
    return _result(method="netsh", error="Could not find a Signal/Rssi line in netsh output.")


def parse_netsh_networks(text, connected_bssid=None):
    """Parse `netsh wlan show networks mode=bssid`. One SSID block can contain
    several BSSIDs (access points); every BSSID becomes one row."""
    networks, ssid, current = [], None, None
    for line in text.splitlines():
        ssid_match = re.match(r"^SSID \d+\s*:\s*(.*)$", line)
        if ssid_match:
            ssid = ssid_match.group(1).strip() or "(hidden)"
            continue
        key_value = re.match(r"^\s+([^:]+?)\s*:\s*(.*)$", line)
        if not key_value or ssid is None:
            continue
        key, value = key_value.group(1).lower(), key_value.group(2).strip()
        if key.startswith("bssid"):
            current = {"ssid": ssid, "bssid": value.lower(), "rssi": None,
                       "channel": None, "band": None, "connected": False}
            networks.append(current)
        elif current is not None and key == "signal":
            current["rssi"] = percent_to_dbm(_int(value) or 0)
        elif current is not None and key == "channel":
            current["channel"] = _int(value)
        elif current is not None and key == "band":
            current["band"] = _clean_band(value, None)

    for net in networks:
        net["band"] = net["band"] or band_from_channel(net["channel"])
        net["connected"] = bool(connected_bssid) and net["bssid"] == connected_bssid.lower()
    return [n for n in networks if n["rssi"] is not None]


def _read_windows():
    return parse_netsh(_run(["netsh", "wlan", "show", "interfaces"]))


def _scan_windows():
    text = _run(["netsh", "wlan", "show", "networks", "mode=bssid"])
    if _location_blocked(text):
        raise RuntimeError(WINDOWS_LOCATION_HELP)
    return parse_netsh_networks(text, _read_windows().get("bssid"))


# ======================================================================= Linux
def _linux_iface():
    """Name of the first wireless interface listed in /proc/net/wireless."""
    with open("/proc/net/wireless") as f:
        lines = f.readlines()[2:]          # 2 header lines
    return lines[0].split(":")[0].strip() if lines else None


def _read_linux():
    """/proc/net/wireless:  ' wlan0: 0000   54.  -56.  -256 ...'
    columns after the name: status, link quality, LEVEL (dBm), noise."""
    try:
        with open("/proc/net/wireless") as f:
            lines = f.readlines()[2:]
    except OSError as exc:
        return _result(method="proc", error=f"Cannot read /proc/net/wireless: {exc}")
    if not lines:
        return _result(method="proc", error="No wireless interface is connected.")

    iface, rest = lines[0].split(":", 1)
    level = float(rest.split()[2].rstrip("."))
    if level > 0:                    # some drivers report an unsigned byte
        level -= 256

    ssid = bssid = channel = None
    try:   # `iw dev wlan0 link` -> "Connected to <bssid>", "SSID: x", "freq: 2437"
        link = _run(["iw", "dev", iface.strip(), "link"])
        if m := re.search(r"Connected to ([0-9a-f:]{17})", link):
            bssid = m.group(1)
        if m := re.search(r"SSID:\s*(.+)", link):
            ssid = m.group(1).strip()
        if m := re.search(r"freq:\s*(\d+)", link):
            channel = channel_from_freq(int(m.group(1)))
    except (OSError, subprocess.SubprocessError):
        pass
    if ssid is None:
        try:
            ssid = _run(["iwgetid", "-r"]).strip() or None
        except (OSError, subprocess.SubprocessError):
            pass
    return _result(level, ssid, bssid, channel, band_from_channel(channel), "proc-net-wireless")


def _scan_linux():
    """nmcli terse output: fields split by ':' ; colons inside values are '\\:'."""
    text = _run(["nmcli", "-t", "-f", "IN-USE,SSID,BSSID,SIGNAL,CHAN,FREQ", "dev", "wifi", "list"])
    networks = []
    for line in text.splitlines():
        parts = [p.replace("\\:", ":") for p in re.split(r"(?<!\\):", line)]
        if len(parts) < 6 or not parts[3].isdigit():
            continue
        channel = _int(parts[4])
        networks.append({
            "ssid": parts[1] or "(hidden)", "bssid": parts[2].lower(),
            # nmcli SIGNAL is a 0-100 % quality - same conversion as Windows
            "rssi": percent_to_dbm(int(parts[3])), "channel": channel,
            "band": band_from_channel(channel), "connected": parts[0].strip() == "*",
        })
    return networks


# ======================================================================= macOS
def _read_macos():
    text = _run(["system_profiler", "SPAirPortDataType"])
    current = text.split("Other Local Wi-Fi Networks:")[0]
    match = re.search(r"Signal / Noise:\s*(-?\d+)\s*dBm", current)
    if not match:
        return _result(method="system_profiler", error="Not connected, or no 'Signal / Noise' line found.")
    ssid = re.search(r"Current Network Information:\s*\n\s*(.+?):\s*\n", current)
    chan = re.search(r"Channel:\s*(\d+)\s*\(([^)]*)\)", current)
    channel = int(chan.group(1)) if chan else None
    band = _clean_band(chan.group(2).replace("2GHz", "2.4 GHz").replace("5GHz", "5 GHz"), channel) if chan else None
    return _result(float(match.group(1)), ssid.group(1) if ssid else None, None, channel, band, "system_profiler")


def _scan_macos():
    """Networks listed under 'Other Local Wi-Fi Networks:' (+ the current one)."""
    text = _run(["system_profiler", "SPAirPortDataType"])
    networks, current = [], None
    section = None          # None, or True/False = inside current / other networks
    name_indent = None      # indentation of the network-name lines in this section
    for line in text.splitlines():
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        if stripped in ("Current Network Information:", "Other Local Wi-Fi Networks:"):
            section, name_indent = stripped.startswith("Current"), None
            continue
        if section is None or not stripped:
            continue
        if name_indent is not None and indent < name_indent:   # section finished
            section = None
            continue
        if stripped.endswith(":") and (name_indent is None or indent == name_indent):
            name_indent = indent                                # "MyWiFi:" starts a network
            current = {"ssid": stripped[:-1], "bssid": None, "rssi": None,
                       "channel": None, "band": None, "connected": section}
            networks.append(current)
        elif current and (m := re.match(r"Channel:\s*(\d+)", stripped)):
            current["channel"] = int(m.group(1))
            current["band"] = band_from_channel(current["channel"])
        elif current and (m := re.match(r"Signal / Noise:\s*(-?\d+)\s*dBm", stripped)):
            current["rssi"] = float(m.group(1))
    return [n for n in networks if n["rssi"] is not None]


# ================================================================ public API
def read_rssi():
    """Read the connected network's RSSI on whatever OS we are running on."""
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


def scan_networks():
    """List nearby networks, strongest first. Raises RuntimeError on failure."""
    system = platform.system()
    try:
        if system == "Windows":
            networks = _scan_windows()
        elif system == "Linux":
            networks = _scan_linux()
        elif system == "Darwin":
            networks = _scan_macos()
        else:
            raise RuntimeError(f"Unsupported operating system: {system}")
    except FileNotFoundError as exc:
        raise RuntimeError(f"Required system tool not found: {exc}")
    except subprocess.TimeoutExpired:
        raise RuntimeError("Scanning for networks timed out.")
    return sorted(networks, key=lambda n: n["rssi"], reverse=True)


if __name__ == "__main__":
    # Quick self-test:  python wifi_reader.py
    import sys
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")   # emoji SSIDs in the console
    reading = read_rssi()
    print(reading)
    if reading["error"]:
        print("ERROR:", reading["error"])
    else:
        print(f"Connected to '{reading['ssid']}' ({reading['bssid']}) at {reading['rssi']:.1f} dBm, "
              f"channel {reading['channel']} / {reading['band']} ({reading['method']})")

    print("\nNearby networks:")
    try:
        for n in scan_networks():
            mark = "*" if n["connected"] else " "
            print(f" {mark} {n['rssi']:6.1f} dBm  ch {str(n['channel']):>3}  {n['band'] or '?':7}  {n['ssid']}")
    except RuntimeError as exc:
        print("SCAN ERROR:", exc)
