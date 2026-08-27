import { writeFileSync } from 'node:fs';
import { canonicalize, canonicalizeLegacySortRebuild as legacy }
  from '../reference/jcs.mjs';

const cases = [
  ["integer-like-keys-reorder",
   "The load-bearing case. Sort-then-rebuild loses the sort; direct serialization keeps it.",
   { "10": "ten", "2": "two", "b": 1, "a": 2 }],

  ["integer-like-keys-nested",
   "Same defect one level down, where it is easier to miss in review.",
   { "set": { "10": "x", "9": "y", "1": "z" }, "name": "n" }],

  ["vg-set-map-keyed-by-card-number",
   "How this reaches Verified Grades in practice: any map keyed by card number, set number, slot index or year.",
   { "setId": "base-1999", "cards": { "10": { "grade": 9.5 }, "2": { "grade": 8 }, "1": { "grade": 10 } } }],

  ["array-order-preserved",
   "Array order is meaningful and is never sorted.",
   { "z": [3, 1, 2], "a": 1 }],

  ["key-sort-is-code-unit-not-locale",
   "UTF-16 code unit order, so uppercase sorts before underscore, which sorts before lowercase. A locale-aware sort fails this.",
   { "a": 1, "A": 2, "b": 3, "B": 4, "_": 5 }],

  ["empty-containers",
   "Empty object, empty array and empty string are all representable and distinct.",
   { "o": {}, "a": [], "s": "" }],

  ["numbers-ecmascript-tostring",
   "JCS mandates ECMAScript Number::toString: 1.0 emits as 1, negative zero as 0, 1e21 as 1e+21.",
   { "a": 1, "b": -0.5, "c": 1e21, "d": 0, "e": 1.0, "f": -0 }],

  ["nested-mixed",
   "Objects inside arrays inside objects; each object sorted, each array left alone.",
   { "b": [{ "y": 1, "x": 2 }, [1, { "n": null }]], "a": { "d": true, "c": false } }],

  ["unicode-and-escapes",
   "Minimal escaping, non-ASCII emitted literally, astral characters intact.",
   { "tab": "a\tb", "quote": "a\"b", "emoji": "\u{1F0CF}", "ae": "ä", "z": "z" }],

  ["numeric-string-values-are-not-keys",
   "Guards against an over-eager fix: the defect is about keys, so numeric string VALUES must not be touched.",
   { "a": "10", "b": "2" }],

  ["vg-grade-payload-shape",
   "A realistic Grade payload, to pin the shape the envelope actually carries.",
   { "uidCommitment": "9f2c", "saltId": "s-1",
     "grade": { "score": 9.5, "rubric": "1.4.0" },
     "createdAt": "2026-08-27T14:02:11Z",
     "asset": { "cardNumber": "10", "setNumber": "2" } }],
];

const built = cases.map(([name, note, input]) => {
  const expected = canonicalize(input);
  const legacyDiffers = legacy(input) !== expected;
  return { name, note, input, expected, legacyDiffers };
});

for (const c of built) {
  console.log((c.legacyDiffers ? 'DIFF  ' : 'same  ') + c.name);
  console.log('      ' + c.expected);
}
console.log('\ncases: ' + built.length + '   differ from legacy: ' + built.filter(c => c.legacyDiffers).length);

writeFileSync(
  new URL('../vectors/canonical.json', import.meta.url),
  JSON.stringify({
    vectorSet: 'canonical',
    spec: 'RFC 8785 (JSON Canonicalization Scheme)',
    version: 1,
    note: 'expected is the exact canonical JSON string. legacyDiffers records whether the non-conformant sort-then-rebuild form produces different bytes for this input; it is documentation, not a requirement.',
    cases: built,
  }, null, 2) + '\n'
);
console.log('\nwrote vectors/canonical.json');
