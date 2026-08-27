# attest-spec

Normative specification and conformance vectors for SmartLedger's multi-party
attestation envelope — the format a kiosk, a grading engine, a human grader and a
franchise company each sign into, and that any third party can verify years later
without asking us anything.

- [`SPEC.md`](./SPEC.md) — the normative document
- [`vectors/`](./vectors) — machine-checkable conformance cases
- [`reference/`](./reference) — the tie-breaking reference implementation
- `runner.mjs` — checks any implementation against the vectors

Zero dependencies, by design. Every package in the estate depends on this one, so it
can depend on none of them.

## Why this exists

A signature is only meaningful over bytes both parties can reproduce. We ship five
canonicalizers. Three of them disagree with the other two, and the disagreement is
silent — it produces valid-looking signatures that a conformant verifier in another
language rejects.

Running the vectors against what we currently ship:

| Implementation | Score | Reachable as |
|---|---|---|
| `bsv/lib/util/jcs.js` | **11/11** | private — not exported |
| `notaryhash/src/canonical/jcs.ts` | conformant | package-internal |
| `bsv.canonicalizeClaim` → `LTP.Claim.canonicalize` | **8/11** | **public API**, typed in `bsv.d.ts` |
| `vg-csv-sign-server/src/lib/canonical.js` | 8/11 (same form) | all VG signing |
| `@smartledger/envelope` v1.0.0 | **2/11** | published npm package |

The two correct implementations are the two nobody can reach. That inversion is the
first work item in the build order, and this repository is what proves when it's fixed.

`@smartledger/envelope` scores 2/11 because it signs
`JSON.stringify({ payload, meta })` with no canonicalization at all — key order comes
from whatever the caller or the wire produced.

## Use

```bash
npm test                                         # reference + vector self-checks

node runner.mjs --canonical ./reference/jcs.mjs
node runner.mjs --canonical ../smartledger-bsv/lib/util/jcs.js --export stringify
node runner.mjs --signing-input ./reference/signing-input.mjs
```

Exit code is 0 only when every case passes, so it drops straight into CI.

The runner takes any module exporting a single function. It looks for `canonicalize`,
`stringify`, then `signingInputHex`, then the default export; pass `--export` to name
one explicitly. For a CommonJS or non-JS implementation, write a three-line adapter
module that calls it.

## Vector sets

| Set | Fixes | Cases |
|---|---|---|
| `canonical` | value → exact RFC 8785 bytes | 11 |
| `signing-input` | envelope → SHA-256 digest per SPEC §2.1 | 7 |

Three canonical cases discriminate RFC 8785 from the sort-then-rebuild form; each is
marked `legacyDiffers: true`, and a test asserts those flags stay accurate. The
`signing-input` set pins the five properties the envelope depends on: signatures and
anchor excluded, payload key order irrelevant, reference order significant, type
domain-separated, version domain-separated.

Cases whose input has no JSON representation — non-finite numbers, `undefined`,
bigint, circular references — are specified in SPEC §1 and tested in
`test/reference.test.mjs` rather than carried in the portable JSON, so the vector files
stay loadable by any language.

### A note on reading the vector files

`input` is stored as JSON, and parsing it does not preserve the key order of the
source: V8 reorders integer-like keys on parse, which is the same behaviour the
specification exists to defend against. This is harmless — `expected` is a function of
the parsed *value*, not of any key order — and it is a useful reminder that a
conformant canonicalizer cannot depend on the order it receives.

## Adding a vector

Vectors are additive. Changing an existing case's `expected` is a wire-format change
and requires an envelope version bump (SPEC §8).

Add the case to the generator, regenerate, and check that the hand-written assertions
in `test/reference.test.mjs` still hold. Those assertions are written from RFC 8785 and
SPEC §2.1 directly rather than from the reference output, so the suite is not merely
checking the reference against itself.
