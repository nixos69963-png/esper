"""End-to-end check: overlapping audio windows plus word-level dedup.

Simulates Whisper reading a sentence through a sliding window that overlaps, and
asserts the inserted text is exactly what was spoken.
"""
import random
import sys

sys.path.insert(0, ".")
from word_overlap import RollingText

VOCAB = [
    "alpha", "beta", "gamma", "delta", "transcription", "planets",
    "meeting", "notes", "transcript", "keyboard", "monitor", "quarter",
]


def sentence(rng):
    words = []
    while len(words) < rng.randint(4, 16):
        w = rng.choice(VOCAB)
        if not words or words[-1] != w:
            words.append(w)
    return words


def windows(words, chunk_words, overlap_words):
    out = []
    step = max(1, chunk_words - overlap_words)
    i = 0
    while i < len(words):
        out.append(words[i : i + chunk_words])
        i += step
    return out


def run(config, seed):
    rng = random.Random(seed)
    words = sentence(rng)
    chunks = windows(words, config["chunk"], config["overlap"])
    emitted, previous = [], []
    rolling = RollingText()
    for chunk in chunks:
        got = rolling.add(" ".join(chunk))
        if got:
            emitted.append(got)
        previous = list(chunk)
    tail = rolling.flush()
    if tail:
        emitted.append(tail)
    return words, " ".join(emitted)


CONFIGS = [
    {"chunk": 4, "overlap": 2},
    {"chunk": 5, "overlap": 1},
    {"chunk": 6, "overlap": 3},
    {"chunk": 8, "overlap": 2},
    {"chunk": 3, "overlap": 1},
]

for config in CONFIGS:
    exact = garbled = lost = 0
    first_fail = None
    for seed in range(2000):
        words, out = run(config, seed)
        tokens = out.split()
        if tokens == words:
            exact += 1
            continue
        if any(t not in VOCAB for t in tokens):
            garbled += 1
        it = iter(words)
        if not all(w in it for w in tokens):
            lost += 1
            if first_fail is None:
                first_fail = (words, tokens)

    print(
        f"chunk={config['chunk']} overlap={config['overlap']}: "
        f"exact {exact:5}/2000  garbled {garbled:3}  lost-word {lost:3}"
    )
    if first_fail:
        print(f"    spoken    {first_fail[0]}")
        print(f"    inserted {first_fail[1]}")