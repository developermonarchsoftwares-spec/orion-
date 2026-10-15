"""Original score for the Orion launch teaser: organ pedal, slow arpeggio, riser, sub boom.
Pure synthesis (no samples), so there are no licensing questions."""
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, fftconvolve

sr = 44100
T = 20.0
n = int(sr * T)
t = np.arange(n) / sr
rng = np.random.default_rng(20261005)


def smooth(x0, x1, tt):
    u = np.clip((tt - x0) / (x1 - x0), 0, 1)
    return u * u * (3 - 2 * u)


def organ(f, tt, harm=(1, .55, .36, .26, .16, .1, .06)):
    out = np.zeros_like(tt)
    for k, a in enumerate(harm, 1):
        out += a * (np.sin(2 * np.pi * f * k * tt) + np.sin(2 * np.pi * f * 1.0025 * k * tt + 1.3)) * .5
    return out


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, 'low', fs=sr, output='sos'), x)


def bp(x, lo, hi):
    return sosfilt(butter(2, [lo, hi], 'band', fs=sr, output='sos'), x)


# ---------- chord pad (organ) ----------
chords = [
    (0.0, 6.8, [55.0, 82.41, 110.0, 164.81, 220.0]),             # Am
    (6.8, 12.5, [43.65, 65.41, 130.81, 164.81, 261.63]),         # Fmaj7
    (12.5, 20.0, [73.42, 110.0, 146.83, 174.61, 220.0, 329.63]),  # Dm9
]
pad = np.zeros(n)
for a, b, fs in chords:
    seg = np.zeros(n)
    for f in fs:
        seg += organ(f, t) * (1.0 if f < 150 else 0.55)
    w = smooth(a - 0.9, a + 0.9, t) * (1 - smooth(b - 0.9, b + 0.9, t)) if a > 0 else (1 - smooth(b - 0.9, b + 0.9, t))
    pad += seg * w
swell = 0.12 + 0.88 * smooth(0.3, 12.4, t) ** 1.4
after = np.where(t > 12.5, 0.8 - 0.12 * smooth(12.5, 17.5, t), 1.0)
pad = lp(pad, 2400) * swell * after * 0.085
breath = 1 + 0.06 * np.sin(2 * np.pi * t / 6.5)
pad *= breath

# ---------- arpeggio ostinato ----------
bpm = 96
step = 60 / bpm / 2


def pluck(f, dur=0.55):
    m = int(sr * dur)
    tt = np.arange(m) / sr
    s = sum(a * np.sin(2 * np.pi * f * k * tt) for k, a in enumerate((1, .45, .3, .18, .1), 1))
    env = np.minimum(tt / 0.006, 1) * np.exp(-tt / 0.16)
    return s * env


arp_pat = {
    'Am': [220, 329.63, 440, 523.25, 659.25, 523.25, 440, 329.63],
    'F': [174.61, 261.63, 349.23, 440, 523.25, 440, 349.23, 261.63],
    'Dm': [146.83, 220, 293.66, 349.23, 440, 349.23, 293.66, 220],
}
arpL = np.zeros(n)
arpR = np.zeros(n)
i = 0
tt0 = 4.8
while tt0 < 19.2:
    if 12.4 <= tt0 < 13.7:
        tt0 += step
        continue
    pat = arp_pat['Am'] if tt0 < 6.8 else arp_pat['F'] if tt0 < 12.5 else arp_pat['Dm']
    f = pat[i % 8]
    if tt0 < 12.5:
        vol = 0.015 + 0.5 * smooth(4.8, 12.3, np.array([tt0]))[0]
    else:
        vol = 0.2 * (1 - smooth(16.5, 19.2, np.array([tt0]))[0])
    p = pluck(f) * vol * 0.11
    k0 = int(tt0 * sr)
    k1 = min(n, k0 + len(p))
    (arpL if i % 2 == 0 else arpR)[k0:k1] += p[:k1 - k0] * 0.9
    (arpR if i % 2 == 0 else arpL)[k0:k1] += p[:k1 - k0] * 0.35
    tt0 += step
    i += 1

# ---------- star pings (pentatonic, one per ignition) ----------
ign = [5.0, 5.4, 5.8, 6.1, 6.4, 6.9, 7.4, 7.9, 8.3, 8.6, 9.0, 9.3, 9.6, 9.9, 10.3, 10.8]
scale = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.7, 1318.5]
pingL = np.zeros(n)
pingR = np.zeros(n)
for j, tk in enumerate(ign):
    f = scale[min(j // 2, len(scale) - 1)]
    m = int(sr * 1.6)
    tt = np.arange(m) / sr
    s = (np.sin(2 * np.pi * f * tt) + .3 * np.sin(2 * np.pi * f * 2 * tt)) * np.exp(-tt / 0.5) * np.minimum(tt / 0.004, 1)
    k0 = int(tk * sr)
    k1 = min(n, k0 + m)
    pan = 0.3 + 0.4 * ((j * 0.618) % 1)
    pingL[k0:k1] += s[:k1 - k0] * 0.05 * (1 - pan)
    pingR[k0:k1] += s[:k1 - k0] * 0.05 * pan

# ---------- shimmer, riser ----------
shim = np.zeros(n)
for f, ph in [(880, 0), (1318.5, 1.1), (1760, 2.2), (2637, 0.6)]:
    shim += np.sin(2 * np.pi * f * t + ph) * (0.5 + 0.5 * np.sin(2 * np.pi * (4.6 + ph * .3) * t + ph))
shim *= smooth(5.5, 12.4, t) * (1 - smooth(12.5, 14.5, t)) * 0.006

noise = rng.standard_normal(n)
riser = bp(noise, 300, 6000) * (smooth(9.0, 12.5, t) ** 2.4) * (1 - smooth(12.5, 12.9, t)) * 0.07

# ---------- boom at the logo ----------
tb = np.clip(t - 12.5, 0, None)
act = (t >= 12.5).astype(float)
f_sweep = 30 + 42 * np.exp(-tb / 0.55)
phase = 2 * np.pi * np.cumsum(f_sweep) / sr
boom = np.sin(phase) * np.exp(-tb / 2.1) * act * 0.55
boom += np.sin(2 * np.pi * 96 * tb) * np.exp(-tb / 0.22) * act * 0.25
air = lp(noise, 900) * np.exp(-tb / 1.5) * act * 0.16
bloom = (lp(noise, 5200) * np.exp(-tb / 2.6) * act) * 0.035

# ---------- clock ticks (tension) ----------
ticks = np.zeros(n)
for k in range(1, 12):
    k0 = int(k * 1.0 * sr)
    m = int(sr * 0.012)
    c = bp(rng.standard_normal(m), 1500, 4500) * np.exp(-np.arange(m) / (sr * 0.003))
    ticks[k0:k0 + m] += c * 0.12 * (1 - smooth(9.5, 12.4, np.array([k * 1.0]))[0])

# ---------- reverb ----------
irn = int(sr * 3.4)
ti = np.arange(irn) / sr
ir = [lp(rng.standard_normal(irn), 6000) * np.exp(-ti / 0.85) for _ in range(2)]
ir = [x / np.sqrt(np.sum(x * x)) for x in ir]


def wet(x, which):
    return fftconvolve(x, ir[which])[:n]


dryL = pad * 0.55 + arpL + pingL + shim * .5 + boom + ticks
dryR = pad * 0.55 + arpR + pingR + shim * .5 + boom + ticks
sendL = pad + arpL + pingL + shim + riser + air + bloom
sendR = pad + arpR + pingR + shim + riser * .9 + air * .9 + bloom
L = dryL + riser * .35 + air * .5 + wet(sendL, 0) * 1.4
R = dryR + riser * .30 + air * .5 + wet(sendR, 1) * 1.4

# ---------- master ----------
fade_in = smooth(0.0, 1.8, t)
fade_out = 1 - smooth(17.6, 20.0, t)
env = fade_in * fade_out
L *= env
R *= env
mx = max(np.abs(L).max(), np.abs(R).max())
L = np.tanh(L / mx * 1.25) / np.tanh(1.25) * 0.89
R = np.tanh(R / mx * 1.25) / np.tanh(1.25) * 0.89
out = np.stack([L, R], 1)
wavfile.write(r'D:\ownus\brag-output-2026-10-05-interstellar\composition\assets\music\score.wav', sr, (out * 32767).astype(np.int16))
print('rms', float(np.sqrt((out ** 2).mean())), 'peak', float(np.abs(out).max()))
