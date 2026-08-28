# attest-spec

Normative specification and conformance vectors for SmartLedger's multi-party
attestation envelope — the format a kiosk, a grading engine, a human grader and a
franchise company each sign into, and that any third party can verify years later
without asking us anything.

- [`SPEC.md`](./SPEC.md) — the normative document
- [`vectors/`](./vectors) — machine-checkable conformance cases
- [`reference/`](./reference) — the tie-breaking reference implementation
- `runner.mjs` — checks any implementation against the vectors
- `tools/check-estate.mjs` — sweeps every canonicalizer in the estate at once

Zero dependencies, by design. Every package in the estate depends on this one, so it
can depend on none of them.

## Why this exists

A signature is only meaningful over bytes both parties can reproduce. When this
repository was created the estate shipped five canonicalizers, three of them
non-conformant, and the disagreement was silent: valid-looking signatures that a
conformant verifier in another language rejects.

Worse was the inversion. The two correct implementations were the two nobody could
reach, so several packages independently reimplemented the broken form — it was the
one they could see.

```
npm run check:estate
```

| Implementation | Then | Now | Notes |
|---|---|---|---|
| `@smartledger/bsv/jcs` | 11/11, private | **11/11, published** | public from 9.2.0, on npm |
| `LTP.Claim.canonicalize(…, JCS)` | did not exist | **11/11** | opt-in; becomes the default in 10.0.0 |
| `LTP.Claim.canonicalize(…, LEGACY)` | 8/11, the only option | 8/11, opt-in | non-conformant by design, kept so existing claim hashes still reproduce |
| `@smartledger/envelope` | **2/11** | **11/11, published** | v2.0.0 on npm; v1 envelopes still verify byte for byte |
| an internal signing service | 8/11 | 8/11, pinned | migration gated on conditions recorded in that repo |
| `notaryhash/src/canonical/jcs.ts` | conformant | conformant | TypeScript source; checked by its own suite |

Verified against the published tarballs, not the working tree — `@smartledger/bsv@9.2.0`
and `@smartledger/envelope@2.0.0` both score 11/11 from a clean-room install and
produce byte-identical output to each other.

`@smartledger/envelope` scored 2/11 because it signed
`JSON.stringify({ payload, meta })` with no canonicalization at all. That made a
signature depend on the insertion order of **ordinary string keys** — no exotic
input required. It survived in practice only because signing and verifying the same
object graph agree, and a JSON round-trip through V8 happens to be stable; it fails
as soon as a value is rebuilt by a different code path — read from a database,
mapped through a different shape, or produced by a non-JavaScript implementation.

The two implementations still scoring 8/11 are deliberate and marked as such: both
are reachable only by explicit opt-in, both are needed so existing hashes still
reproduce, and `check:estate` fails the build only for implementations that are
supposed to be conformant.

### Upgrade order matters

`@smartledger/envelope` v2 verifies v1 envelopes, so nothing already signed needs
re-signing. **A deployed v1 verifier cannot read a v2 envelope** — v1 has no version
switch, so it cannot be taught to. Upgrading a signing service before its verifiers
produces envelopes those verifiers reject.

Upgrade verifiers first, then signers.

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
