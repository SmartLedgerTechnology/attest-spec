import { writeFileSync } from 'node:fs';
import { signingInputHex } from '../reference/signing-input.mjs';

const grade = {
  v: 'vg-attest/2',
  type: 'Grade',
  payload: {
    asset: { cardNumber: '10', setNumber: '2' },
    grade: { score: 9.5, rubric: '1.4.0' },
    uidCommitment: '9f2c', saltId: 's-1',
    createdAt: '2026-08-27T14:02:11Z',
  },
  references: [
    { type: 'Capture', face: 'front', hash: 'sha256:aa' },
    { type: 'Capture', face: 'back', hash: 'sha256:bb' },
  ],
};

const cases = [
  ['grade-two-captures', 'Canonical Grade envelope with both faces referenced.', grade],

  ['signatures-and-anchor-excluded',
   'Same envelope carrying signatures and an anchor. MUST produce the identical digest as grade-two-captures — this is what makes later countersignature possible.',
   { ...grade,
     signatures: [{ role: 'kiosk', did: 'did:smartledger:02a1', sig: 'zz', mode: 'auto' }],
     anchor: { certificate: { payloadHash: 'ff' } } }],

  ['reference-order-is-significant',
   'References are an array, so front/back order is part of the signed bytes. Differs from grade-two-captures.',
   { ...grade, references: [grade.references[1], grade.references[0]] }],

  ['domain-separation-grade-vs-override',
   'Byte-identical payload and references, different type. MUST differ from grade-two-captures, or a Grade signature could be replayed as an override.',
   { ...grade, type: 'GradeOverride' }],

  ['domain-separation-version',
   'Byte-identical payload and references, different envelope version. MUST differ.',
   { ...grade, v: 'vg-attest/3' }],

  ['capture-no-references',
   'A Capture envelope references nothing; the empty array still participates in the digest.',
   { v: 'vg-attest/2', type: 'Capture',
     payload: { stationId: 'VG-KIOSK-0007', face: 'front', mediaHash: 'sha256:aa', capturedAt: '2026-08-27T14:02:09Z' } }],

  ['payload-key-order-irrelevant',
   'Same payload with keys supplied in a different source order. MUST equal grade-two-captures — the whole point of canonicalizing.',
   { type: 'Grade', v: 'vg-attest/2',
     references: grade.references,
     payload: {
       createdAt: '2026-08-27T14:02:11Z', saltId: 's-1', uidCommitment: '9f2c',
       grade: { rubric: '1.4.0', score: 9.5 },
       asset: { setNumber: '2', cardNumber: '10' },
     } }],
];

const built = cases.map(([name, note, envelope]) => ({
  name, note, envelope, expected: signingInputHex(envelope),
}));

const byName = Object.fromEntries(built.map(c => [c.name, c.expected]));
const base = byName['grade-two-captures'];

console.log('base digest: ' + base + '\n');
for (const c of built) {
  const rel = c.expected === base ? 'EQUAL to base' : 'differs';
  console.log(`${c.expected.slice(0, 16)}…  ${rel.padEnd(13)}  ${c.name}`);
}

// Assertions the vector set exists to enforce.
const must = [
  ['signatures/anchor excluded', byName['signatures-and-anchor-excluded'] === base],
  ['payload key order irrelevant', byName['payload-key-order-irrelevant'] === base],
  ['reference order significant', byName['reference-order-is-significant'] !== base],
  ['type domain-separated', byName['domain-separation-grade-vs-override'] !== base],
  ['version domain-separated', byName['domain-separation-version'] !== base],
];
console.log('');
let ok = true;
for (const [label, pass] of must) { if (!pass) ok = false; console.log((pass ? 'PASS  ' : 'FAIL  ') + label); }

writeFileSync(new URL('../vectors/signing-input.json', import.meta.url),
  JSON.stringify({
    vectorSet: 'signing-input', spec: 'SPEC.md §6.1', version: 1,
    note: 'expected is the lowercase hex SHA-256 of JCS(payload) || 0x00 || JCS(references) || 0x00 || JCS({v,type}). Envelopes carry signatures/anchor in some cases deliberately; they must not affect the digest.',
    cases: built,
  }, null, 2) + '\n');

console.log(ok ? '\nwrote vectors/signing-input.json' : '\nNOT WRITTEN — invariants failed');
process.exit(ok ? 0 : 1);
