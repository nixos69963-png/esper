/**
 * Word-boundary handling for rolling transcription.
 *
 * A direct port of backend/word_overlap.py. Overlapping audio windows mean the
 * words spanning a boundary are transcribed twice; RollingText compares each
 * chunk against what came before and keeps only the new words.
 *
 * The trailing word of every chunk is held back until the next chunk arrives,
 * so a word heard only in part can be replaced by the complete version instead
 * of being inserted as a fragment.
 */

/** Longest repeat considered at a chunk boundary. */
const MAX_OVERLAP = 24;
/** A held word shorter than this is too short to be a fragment. */
const MIN_PARTIAL_LENGTH = 4;
/**
 * A single-word repeat is only dropped when the word is long enough that it is
 * unlikely the speaker genuinely said it twice in a row.
 */
const MIN_SINGLE_WORD_OVERLAP = 6;

/** Short function words are never treated as fragments. */
const STOP_WORDS = new Set(
  `a an and are as at be but by for from had has have he her hers him his i
   if in into is it its me my no not of on or our out she so than that the
   their them then there these they this to up us was we were what when which
   who will with would you your`.split(/\s+/),
);

/** Strip surrounding punctuation, keeping apostrophes inside words. */
function trimPunctuation(word: string): string {
  return word.replace(/[!"#$%&()*+,\-./:;<=>?@[\]^_`{|}~]/g, "");
}

/** Casefold a word and drop its punctuation so comparisons are stable. */
export function normalize(word: string): string {
  return trimPunctuation(word.trim()).toLowerCase();
}

/**
 * Split text into word tokens, keeping the punctuation that follows each word
 * so inserted text keeps its commas and full stops.
 */
export function splitWords(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}])*[^\s]*/gu) ?? [];
}

export function isStopWord(word: string): boolean {
  return STOP_WORDS.has(normalize(word));
}

function same(left: string, right: string): boolean {
  const key = normalize(left);
  return key.length > 0 && key === normalize(right);
}

/**
 * Count leading `incoming` words already spoken at the end of `recent`.
 */
export function overlapLength(recent: string[], incoming: string[]): number {
  const limit = Math.min(recent.length, incoming.length, MAX_OVERLAP);

  for (let size = limit; size > 1; size--) {
    const tail = recent.slice(recent.length - size);
    let matches = true;
    for (let i = 0; i < size; i++) {
      if (!same(tail[i], incoming[i])) {
        matches = false;
        break;
      }
    }
    if (matches) return size;
  }

  if (
    limit >= 1 &&
    normalize(incoming[0]).length >= MIN_SINGLE_WORD_OVERLAP &&
    same(recent[recent.length - 1], incoming[0])
  ) {
    return 1;
  }

  return 0;
}

/**
 * Report whether `word` extends the held word into a longer real word.
 *
 * Only used to drop the held fragment, never to build text, so a wrong guess
 * costs a redundant word rather than a glued one.
 */
export function continuesPending(pending: string, word: string): boolean {
  const pendingKey = normalize(pending);
  const wordKey = normalize(word);
  if (pendingKey.length < MIN_PARTIAL_LENGTH || isStopWord(pendingKey)) return false;
  return (
    wordKey.length > pendingKey.length && wordKey.startsWith(pendingKey)
  );
}

export class RollingText {
  private recent: string[] = [];
  private pending = "";

  constructor(private readonly memory: number = MAX_OVERLAP) {}

  reset(): void {
    this.recent = [];
    this.pending = "";
  }

  /** Return the words to insert for one chunk of transcript. */
  add(text: string): string {
    const words = splitWords(text);
    if (words.length === 0) return "";

    // The held word counts as already spoken, because it is always inserted
    // before the words that follow it in this chunk.
    const held = this.pending;
    let lead: string[] = [];
    let spoken = this.recent;
    let minimum = 0;

    if (held) {
      spoken = spoken.concat([held]);
      if (continuesPending(held, words[0])) {
        // This chunk heard the whole word, so the held fragment is not needed.
        this.pending = "";
      } else {
        lead = [held];
        if (same(held, words[0])) {
          // The held word was echoed, so it must not be inserted twice.
          minimum = 1;
        }
      }
    }

    const fresh = words.slice(Math.max(overlapLength(spoken, words), minimum));
    if (fresh.length === 0) {
      this.pending = "";
      return this.release(lead);
    }

    // Hold the new trailing word until the next chunk confirms it is whole.
    this.pending = fresh[fresh.length - 1];
    const parts = lead.concat(fresh.slice(0, -1));
    if (parts.length === 0) return "";

    this.remember(parts);
    return parts.join(" ");
  }

  /** Release the held trailing word, e.g. when recording stops. */
  flush(): string {
    if (!this.pending) return "";
    const held = this.pending;
    this.pending = "";
    this.remember([held]);
    return held;
  }

  private release(words: string[]): string {
    if (words.length === 0) return "";
    this.remember(words);
    return words.join(" ");
  }

  private remember(words: string[]): void {
    this.recent = this.recent.concat(words).slice(-this.memory);
  }
}