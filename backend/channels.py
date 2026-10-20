"""
channels.py - which 2.4 GHz channel is least crowded?

2.4 GHz channels are only 5 MHz apart but each Wi-Fi signal is ~22 MHz wide,
so a network on channel 6 also spills onto channels 2-10. Only 1, 6 and 11 do
not overlap each other, so a router should use one of those three.

For each candidate (1, 6, 11) we add up how much every nearby network
overlaps it:
    overlap  = max(0, 1 - |channel - candidate| / 5)   (1 = same channel, 0 = 5+ apart)
    power_mW = 10 ** (dBm / 10)                          (dBm is logarithmic -> convert to mW)
    load     = sum(power_mW * overlap)
The candidate with the smallest load is recommended. Our own connected
network is left out (it is the one we would be moving).
"""

import math

CANDIDATES = (1, 6, 11)
SPREAD = 5      # channels apart at which a 22 MHz signal no longer overlaps


def overlap(channel, candidate):
    return max(0.0, 1 - abs(channel - candidate) / SPREAD)


def recommend_24ghz(networks):
    others = [n for n in networks
              if n.get("channel") and 1 <= n["channel"] <= 14 and not n.get("connected")]
    load = {c: sum(10 ** (n["rssi"] / 10) * overlap(n["channel"], c) for n in others)
            for c in CANDIDATES}
    if not others:
        return {"recommended_channel": None, "channel_load": None}
    best = min(CANDIDATES, key=lambda c: load[c])
    # Report the load in dBm again so it is readable (higher = more crowded).
    readable = {str(c): (round(10 * math.log10(v), 1) if v > 0 else None) for c, v in load.items()}
    return {"recommended_channel": best, "channel_load": readable}
