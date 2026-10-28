"""Original R2 sample score and sound design. Python standard library only.

Memory: 96 BPM, A minor, four bars. Each group is one bar of quarter notes.
Melody MIDI: A4 C5 E5 B4 | G4 B4 D5 A4 | F4 A4 C5 E5 | E4 G4 B4 E5.
Harmony: Am7 | G6 | Fmaj7 | Em7. Soft additive plucks, no recordings.
Rain: seeded low-pass noise. Bell: decaying inharmonic sine partials.
All PCM is mono 48 kHz / 16 bit, with explicit zero-ended fade envelopes.
Technical synthesis does not establish listening or production approval.
"""
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'examples/creative/assets'
RATE = 48000
BEAT = 60 / 96


def save(name, values):
    ROOT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(ROOT / name), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(b''.join(struct.pack('<h', round(max(-0.95, min(0.95, v)) * 32767)) for v in values))


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def pluck(t, note):
    return sum(math.sin(2 * math.pi * frequency(note) * harmonic * t) / harmonic ** 2
               for harmonic in (1, 2, 3)) * (1 - math.exp(-t * 80)) * math.exp(-t * 3)


def generate():
    duration = 16 * BEAT
    melody = [69, 72, 76, 71, 67, 71, 74, 69, 65, 69, 72, 76, 64, 67, 71, 76]
    harmony = [(45, 52, 55, 60), (43, 50, 55, 59), (41, 48, 52, 57), (40, 47, 50, 55)]
    music = []
    rain = []
    rng = random.Random(6028)
    filtered = 0
    for i in range(round(duration * RATE)):
        t = i / RATE
        note_index = min(15, int(t / BEAT))
        bar = min(3, note_index // 4)
        local = t - note_index * BEAT
        chord_time = t - bar * 4 * BEAT
        edge = min(1, t / 0.08, (duration - 1 / RATE - t) / 0.08)
        music.append(edge * (0.22 * pluck(local, melody[note_index])
                            + 0.055 * sum(pluck(chord_time, n) for n in harmony[bar])))
        filtered = filtered * 0.92 + rng.uniform(-1, 1) * 0.08
        rain.append(filtered * 0.17 * edge)
    # Quantized endpoints are exactly zero, making the endpoint discontinuity explicit.
    music[0] = music[-1] = rain[0] = rain[-1] = 0
    save('memory.wav', music)
    save('rain.wav', rain)
    bell = []
    for i in range(round(1.2 * RATE)):
        t = i / RATE
        edge = min(1, t / 0.004, (1.2 - 1 / RATE - t) / 0.06)
        bell.append(edge * sum(weight * math.sin(2 * math.pi * hz * t) * math.exp(-t * decay)
                               for hz, weight, decay in [(880, 0.25, 4), (1409, 0.12, 5), (2123, 0.06, 7)]))
    bell[0] = bell[-1] = 0
    save('bell.wav', bell)


if __name__ == '__main__':
    generate()
