#!/usr/bin/env python3
"""Checks for the chunk-boundary word handling in word_overlap."""
from __future__ import annotations

from word_overlap import RollingText, continues_pending, overlap_length, split_words


def collect(chunks: list[str]) -> str:
    """Feed chunks through a fresh RollingText and return all inserted text."""
    rolling = RollingText()
    parts = [rolling.add(chunk) for chunk in chunks]
    parts.append(rolling.flush())
    return " ".join(part for part in parts if part)


def check(name: str, actual: str, expected: str) -> bool:
    ok = actual == expected
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        print(f"      expected: {expected!r}")
        print(f"      actual:   {actual!r}")
    return ok


def main() -> int:
    results = [
        check(
            "single chunk",
            collect(["hello there friend"]),
            "hello there friend",
        ),
        check(
            "two word repeat at boundary",
            collect(["I want to write a note", "write a note about the meeting"]),
            "I want to write a note about the meeting",
        ),
        check(
            "three word repeat at boundary",
            collect(["this is the first part", "part of the second part"]),
            "this is the first part of the second part",
        ),
        check(
            "single long word repeat is dropped",
            collect(["please send the transcript", "transcript to the team"]),
            "please send the transcript to the team",
        ),
        check(
            "echo of a single short word is kept because it may be real speech",
            collect(["that is very very good", "very good indeed"]),
            "that is very very good indeed",
        ),
        check(
            "punctuation and case do not defeat matching",
            collect(["Hello, world.", "World peace."]),
            "Hello, world. peace.",
        ),
        check(
            "chunk restating a held word keeps the fuller form once",
            collect(["I was thinking about transcrip", "transcription services today"]),
            "I was thinking about transcription services today",
        ),
        check(
            "held word released when it was already complete",
            collect(["that is the plan", "we agreed today"]),
            "that is the plan we agreed today",
        ),
        check(
            "no text until flush for a one word chunk",
            collect(["alone"]),
            "alone",
        ),
        check(
            "empty and whitespace chunks are ignored",
            collect(["  ", "", "hello", "   "]),
            "hello",
        ),
        check(
            "long rolling dictation has no repeats",
            collect(
                [
                    "the quick brown fox jumps",
                    "jumps over the lazy dog",
                    "dog runs away into the woods",
                    "woods are dark and quiet now",
                ]
            ),
            "the quick brown fox jumps over the lazy dog runs away into the woods are dark and quiet now",
        ),
    ]

    assert split_words("it's a well-known fact, truly") == [
        "it's",
        "a",
        "well-known",
        "fact,",
        "truly",
    ], split_words("it's a well-known fact, truly")
    print("PASS  split_words keeps hyphenated words and trailing punctuation")

    assert overlap_length(["alpha", "beta", "transcript"], ["transcript", "delta"]) == 1
    print("PASS  overlap_length finds a one word overlap")

    assert overlap_length(["a", "b", "c"], ["c", "d"]) == 0
    print("PASS  a short single word overlap is not dropped")

    assert continues_pending("trans", "transcription")
    assert not continues_pending("the", "theremin")
    assert not continues_pending("identical", "different")
    assert not continues_pending("a", "and")
    print("PASS  continues_pending matches restatements and rejects short words")

    assert collect(["the plan", "planet is green"]) == "the planet is green"
    print("PASS  a restatement wins over the truncated first attempt")

    print()
    print(f"{sum(results)}/{len(results)} checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())