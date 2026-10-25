"""Recreate the original synthetic WAV fixtures used to exercise media playback."""
from pathlib import Path
import math
import struct
import wave

assets = Path(__file__).resolve().parents[1] / 'examples/runtime/assets'
assets.mkdir(parents=True, exist_ok=True)
for name, duration, notes in [('cue', .18, [880]), ('voice-test', .8, [440, 550]), ('music-test', 3, [220, 277.18, 329.63])]:
    rate = 8000
    data = bytearray()
    for index in range(int(rate * duration)):
        time = index / rate
        envelope = min(1, time / .03) * min(1, (duration - time) / .15)
        value = sum(math.sin(2 * math.pi * frequency * time) for frequency in notes) / len(notes) * .13 * envelope
        data.extend(struct.pack('<h', int(value * 32767)))
    with wave.open(str(assets / (name + '.wav')), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(data)
