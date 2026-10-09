/**
 * Checks for the TypeScript port of backend/word_overlap.py and
 * backend/check_word_overlap.py.
 */
import { RollingText, continuesPending, overlapLength, splitWords } from "./wordOverlap.js";

let failures = 0;

function check(name: string, actual: string, expected: string): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function collect(chunks: string[]): string {
  const rolling = new RollingText();
  const parts = chunks.map((chunk) => rolling.add(chunk));
  parts.push(rolling.flush());
  return parts.filter(Boolean).join(" ");
}

function assert(condition: boolean, name: string): void {
  if (!condition) failures++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}`);
}

check("single chunk", collect(["hello there friend"]), "hello there friend");
check(
  "two word repeat at boundary",
  collect(["I want to write a note", "write a note about the meeting"]),
  "I want to write a note about the meeting",
);
check(
  "three word repeat at boundary",
  collect(["this is the first part", "part of the second part"]),
  "this is the first part of the second part",
);
check(
  "single long word repeat is dropped",
  collect(["please send the transcript", "transcript to the team"]),
  "please send the transcript to the team",
);
check(
  "echo of a single short word is kept",
  collect(["that is very very good", "very good indeed"]),
  "that is very very good indeed",
);
check(
  "punctuation and case do not defeat matching",
  collect(["Hello, world.", "World peace."]),
  "Hello, world. peace.",
);
check(
  "chunk restating a held word keeps the fuller form once",
  collect(["I was thinking about transcrip", "transcription services today"]),
  "I was thinking about transcription services today",
);
check(
  "held word released when it was already complete",
  collect(["that is the plan", "we agreed today"]),
  "that is the plan we agreed today",
);
check("no text until flush for a one word chunk", collect(["alone"]), "alone");
check("empty and whitespace chunks are ignored", collect(["  ", "", "hello", "   "]), "hello");
check(
  "long rolling dictation has no repeats",
  collect([
    "the quick brown fox jumps",
    "jumps over the lazy dog",
    "dog runs away into the woods",
    "woods are dark and quiet now",
  ]),
  "the quick brown fox jumps over the lazy dog runs away into the woods are dark and quiet now",
);

assert(
  JSON.stringify(splitWords("it's a well-known fact, truly")) ===
    JSON.stringify(["it's", "a", "well-known", "fact,", "truly"]),
  "splitWords keeps hyphenated words and trailing punctuation",
);
assert(overlapLength(["alpha", "beta", "transcript"], ["transcript", "delta"]) === 1,
  "overlapLength finds a one word overlap");
assert(overlapLength(["a", "b", "c"], ["c", "d"]) === 0,
  "a short single word overlap is not dropped");
assert(continuesPending("trans", "transcription"), "continuesPending matches a restatement");
assert(!continuesPending("the", "theremin"), "continuesPending rejects unrelated words");
assert(!continuesPending("identical", "different"), "continuesPending rejects different words");
assert(!continuesPending("a", "and"), "continuesPending rejects short function words");
assert(collect(["the plan", "planet is green"]) === "the planet is green",
  "a restatement wins over the truncated first attempt");

console.log();
console.log(failures === 0 ? "all checks passed" : `${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);