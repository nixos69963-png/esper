#!/usr/bin/env python3
"""Word-boundary handling for rolling transcription.

Whisper reads overlapping audio windows, so the words spanning a boundary are
transcribed twice. RollingText compares each chunk against what came before and
inserts only the words that are new, which keeps dictation free of repeats.

The trailing word of every chunk is held back until the next chunk arrives, so a
word Whisper heard only in part can be replaced by the complete version instead
of being typed as a fragment.
"""
from __future__ import annotations

import re
import string

# Longest repeat considered at a chunk boundary.
MAX_OVERLAP = 24
# A held word shorter than this is too short to be a fragment worth joining.
MIN_PARTIAL_LENGTH = 4
# A single-word repeat is only dropped when the word is long enough that it is
# unlikely the speaker genuinely said it twice in a row.
MIN_SINGLE_WORD_OVERLAP = 6

# Short function words are never treated as fragments, since a short word
# followed by another word is ordinary speech rather than a cut word.
_STOP_WORDS = frozenset(
    """
    a an and are as at be but by for from had has have he her hers him his i
    if in into is it its me my no not of on or our out she so than that the
    their them then there these they this to up us was we were what when which
    who will with would you your
    """.split()
)

_TRIM = str.maketrans("", "", string.punctuation.replace("'", ""))
# A word with any trailing punctuation, so inserted text keeps its commas.
_TOKEN = re.compile(r"[^\W_]+(?:['\u2019-][^\W_]+)*[^\w\s]*")


def normalize(word: str) -> str:
    """Casefold a word and drop its punctuation so comparisons are stable."""
    return word.strip().translate(_TRIM).casefold()


def split_words(text: str) -> list[str]:
    """Split text into word tokens, keeping the punctuation that follows."""
    return _TOKEN.findall(text)


def is_stop_word(word: str) -> bool:
    return normalize(word) in _STOP_WORDS


def _same(left: str, right: str) -> bool:
    left_key = normalize(left)
    return bool(left_key) and left_key == normalize(right)


def overlap_length(recent: list[str], incoming: list[str]) -> int:
    """Count leading `incoming` words already spoken at the end of `recent`."""
    limit = min(len(recent), len(incoming), MAX_OVERLAP)
    for size in range(limit, 1, -1):
        tail = recent[len(recent) - size :]
        if all(_same(tail[index], incoming[index]) for index in range(size)):
            return size
    if (
        limit >= 1
        and len(normalize(incoming[0])) >= MIN_SINGLE_WORD_OVERLAP
        and _same(recent[-1], incoming[0])
    ):
        return 1
    return 0


def continues_pending(pending: str, word: str) -> bool:
    """Report whether `word` extends the held word into a longer real word.

    Only used to drop the held fragment, never to build text. This is safe
    because a wrong guess only costs a redundant word, not a glued one, and
    because the audio overlap normally prevents fragments at all.
    """
    pending_key = normalize(pending)
    word_key = normalize(word)
    if len(pending_key) < MIN_PARTIAL_LENGTH or is_stop_word(pending_key):
        return False
    return len(word_key) > len(pending_key) and word_key.startswith(pending_key)


class RollingText:
    """Turns a stream of chunk transcripts into non-repeating insertions.

    The final word of every chunk is held back until the next chunk arrives.
    Holding it lets a word cut in half be repaired, and it is only released
    once the following chunk proves it was a whole word.
    """

    def __init__(self, memory: int = MAX_OVERLAP) -> None:
        self.memory = memory
        self.recent_words: list[str] = []
        self.pending_word: str = ""

    def reset(self) -> None:
        self.recent_words = []
        self.pending_word = ""

    def add(self, text: str) -> str:
        """Return the words to insert for one chunk of transcript."""
        words = split_words(text)
        if not words:
            return ""

        # The held word counts as already spoken, because it is always inserted
        # before the words that follow it in this chunk.
        held = self.pending_word
        lead: list[str] = []
        spoken = self.recent_words
        minimum = 0

        if held:
            spoken = spoken + [held]
            if continues_pending(held, words[0]):
                # This chunk heard the whole word, so the held fragment is not
                # needed and the complete word below takes its place.
                self.pending_word = ""
            else:
                lead = [held]
                if _same(held, words[0]):
                    # The held word was echoed, so it must not be inserted twice.
                    minimum = 1

        fresh = words[max(overlap_length(spoken, words), minimum) :]
        if not fresh:
            self.pending_word = ""
            return self._release(lead)

        # Hold the new trailing word until the next chunk confirms it is whole.
        self.pending_word = fresh[-1]
        parts = lead + fresh[:-1]
        if not parts:
            return ""

        self._remember_many(parts)
        return " ".join(parts)

    def _release(self, words: list[str]) -> str:
        if not words:
            return ""
        self._remember_many(words)
        return " ".join(words)

    def flush(self) -> str:
        """Release the held trailing word, e.g. when recording stops."""
        if not self.pending_word:
            return ""
        held = self.pending_word
        self.pending_word = ""
        self._remember(held)
        return held

    def _remember(self, word: str) -> None:
        self.recent_words.append(word)
        self.recent_words = self.recent_words[-self.memory :]

    def _remember_many(self, words: list[str]) -> None:
        self.recent_words.extend(words)
        self.recent_words = self.recent_words[-self.memory :]