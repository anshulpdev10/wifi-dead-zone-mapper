"""Parsers for the Windows `netsh` output and the channel recommendation."""
import channels
import wifi_reader

CONNECTED = """
There is 1 interface on the system:

    Name                   : Wi-Fi
    State                  : connected
    SSID                   : HomeNet
    AP BSSID               : 8c:86:dd:b7:39:77
    Band                   : 5 GHz
    Channel                : 149
    Signal                 : 78%
    Rssi                   : -66
"""

NETWORKS = """
SSID 1 : HomeNet
    Network type            : Infrastructure
    BSSID 1                 : 8c:86:dd:b7:39:77
         Signal             : 80%
         Band               : 5 GHz
         Channel            : 149
SSID 2 : Neighbour
    BSSID 1                 : aa:bb:cc:dd:ee:ff
         Signal             : 40%
         Band               : 2.4 GHz
         Channel            : 6
"""


def test_parse_netsh_prefers_real_rssi():
    r = wifi_reader.parse_netsh(CONNECTED)
    assert r["error"] is None
    assert r["rssi"] == -66.0 and r["method"] == "netsh-rssi"
    assert r["ssid"] == "HomeNet" and r["channel"] == 149 and r["band"] == "5 GHz"


def test_parse_netsh_falls_back_to_signal_percent():
    r = wifi_reader.parse_netsh(CONNECTED.replace("    Rssi                   : -66\n", ""))
    assert r["rssi"] == 78 / 2 - 100 and r["method"] == "netsh-signal%"


def test_parse_netsh_disconnected_and_location_blocked():
    assert "not connected" in wifi_reader.parse_netsh("    State : disconnected\n")["error"]
    blocked = wifi_reader.parse_netsh("Network shell commands need location permission to access WLAN information.")
    assert blocked["rssi"] is None and "Location" in blocked["error"]


def test_parse_networks_marks_connected():
    nets = wifi_reader.parse_netsh_networks(NETWORKS, "8C:86:DD:B7:39:77")
    assert [n["ssid"] for n in nets] == ["HomeNet", "Neighbour"]
    assert nets[0]["connected"] and not nets[1]["connected"]
    assert nets[1]["channel"] == 6 and nets[1]["band"] == "2.4 GHz" and nets[1]["rssi"] == -80


def test_channel_from_freq():
    assert wifi_reader.channel_from_freq(2437) == 6
    assert wifi_reader.channel_from_freq(2484) == 14
    assert wifi_reader.channel_from_freq(5745) == 149


def test_recommend_avoids_busy_channel():
    nets = [{"channel": 1, "rssi": -40, "connected": False},
            {"channel": 6, "rssi": -45, "connected": False}]
    assert channels.recommend_24ghz(nets)["recommended_channel"] == 11
    assert channels.recommend_24ghz([])["recommended_channel"] is None
