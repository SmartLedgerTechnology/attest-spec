# Attestation envelope and delegated signing — normative specification

**Status:** draft 0.2 · **Package:** `@smartledger/attest` · **Vectors:** `@smartledger/attest-vectors`

This document is normative. It defines what an implementation must do to produce
attestations the rest of the estate will verify, and to verify attestations others
produced. Anything not stated here is not required.

The rationale, the survey of existing packages, and the build sequencing live in the
companion design document. Where the two disagree, this file wins.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are to be interpreted as in
RFC 2119.

---

## 1. Canonicalization

All signed bytes are produced from RFC 8785 (JSON Canonicalization Scheme).

An implementation MUST serialize directly in sorted order. It MUST NOT sort keys and
then rebuild an object: V8 orders integer-like own properties numerically ahead of
string keys regardless of insertion order, so a rebuilt object silently loses the sort.

```
input               { "10": "ten", "2": "two" }
sort-then-rebuild   {"2":"two","10":"ten"}      ✗ non-conformant
RFC 8785            {"10":"ten","2":"two"}      ✓
```

Within a single implementation the non-conformant form is merely
deterministic-but-nonstandard, and no forgery follows from it. Across implementations
it is a verification failure: a conformant verifier in any other language computes a
different digest and rejects a valid signature.

Requirements:

- Object keys MUST be sorted by UTF-16 code unit.
- Array order MUST be preserved.
- Finite numbers MUST serialize as ECMAScript `Number::toString`.
- Non-finite numbers MUST be rejected, not coerced.
- `undefined` members MUST be omitted from objects; `undefined` array elements MUST
  serialize as `null`.
- Circular references MUST throw.

An implementation MUST pass every case in `vectors/canonical.json`. The reference
implementation is `reference/jcs.mjs`.

### 1.1 Payload conventions

- Money MUST be carried as integer minor units, or as a fixed-decimal string. Never as
  a float.
- Computed ratios MUST be rounded before signing, so float tails such as
  `0.30000000000000004` never reach a signed payload.

---

## 2. The envelope

```jsonc
{
  "v": "vg-attest/2",          // REQUIRED. Schema version.
  "type": "Grade",             // REQUIRED. See §4.

  "payload":    { },           // REQUIRED. Opaque to this layer.
  "references": [              // REQUIRED for types that name them in §4.
    { "type": "Capture", "face": "front", "hash": "sha256:…" }
  ],

  "signatures": [ ],           // See §3.
  "anchor":     { }            // notaryhash Certificate, once anchored.
}
```

An envelope without `v` is a pre-v2 record. Verifiers MUST handle it per §7.2 rather
than rejecting it.

### 2.1 Signing input

Every signature over an envelope is a signature over these bytes:

```
signingInput = SHA-256( JCS(payload) ‖ 0x00 ‖ JCS(references) ‖ 0x00 ‖ JCS(context) )
context      = { v, type }
```

`signatures` and `anchor` are excluded. Consequences an implementation MUST preserve:

- **Countersignable.** A party may append a signature later without re-serializing the
  envelope; existing signatures remain valid.
- **Order-independent.** Verifiers MUST NOT depend on the order of `signatures`.
- **Domain-separated.** A signature over a `Grade` cannot be replayed as a signature
  over a `GradeOverride` with byte-identical claims.

`references` MUST be treated as an array, so its order is part of the signed bytes.
When absent it is the empty array, which still participates in the digest.

The `0x00` separators are required. Without them, two different `(payload, references)`
pairs could produce one digest. `0x00` cannot occur in canonical JSON output.

An implementation MUST pass every case in `vectors/signing-input.json`.

---

## 3. Signatures

```jsonc
{
  "role":     "kiosk",                        // REQUIRED. §5.
  "did":      "did:smartledger:02a1…",        // REQUIRED.
  "cert":     "eyJhbGciOiJFUzI1Nksi…",        // REQUIRED except role=legacy.
  "suite":    "bsv-ecdsa-secp256k1",          // REQUIRED.
  "mode":     "auto",                         // REQUIRED. "auto" | "manual".
  "signedAt": "2026-08-27T14:02:12Z",         // REQUIRED. Advisory only.
  "presence": { },                            // REQUIRED iff mode = "manual".
  "sig":      "…"                             // REQUIRED.
}
```

`signedAt` is advisory. The authoritative time is the block height of the anchor (§6).

### 3.1 Suites

| Envelope type   | Suites                                    |
|-----------------|-------------------------------------------|
| `Capture`       | `bsv-ecdsa-secp256k1`                     |
| `Grade`         | `bsv-ecdsa-secp256k1` + `ml-dsa-65`       |
| `GradeOverride` | `bsv-ecdsa-secp256k1` + `ml-dsa-65`       |
| `Issue`         | `bsv-ecdsa-secp256k1`                     |

ML-DSA-65 signatures are ~3.3 KB. They belong in the off-chain envelope. Only the
`signingInput` digest goes on chain.

---

## 4. Envelope types and required signatures

| Type            | kiosk    | grader   | human      | company    | References required     |
|-----------------|----------|----------|------------|------------|-------------------------|
| `Capture`       | REQUIRED | —        | —          | —          | none                    |
| `Grade`         | see note | REQUIRED | —          | —          | `Capture` × both faces  |
| `GradeOverride` | —        | —        | REQUIRED (manual) | —   | `Grade`                 |
| `Issue`         | REQUIRED | —        | —          | —          | `Grade` or `GradeOverride` |
| `CertIssue`     | —        | —        | —          | REQUIRED (manual) | none             |
| `Revocation`    | —        | —        | —          | REQUIRED (manual) | `CertIssue`      |

**Note on `Grade`/kiosk:** REQUIRED from the first station provisioned with a hardware
key; OPTIONAL before that. The assurance tier (§7) records which case applied, so the
distinction is visible rather than hidden.

A `Grade`'s referenced capture hashes MUST appear in a kiosk-signed `Capture` envelope
anchored at or before the `Grade`'s own anchor. A grade whose hashes match no such
capture is detectably derived from images that never came off a scanner.

Both faces MUST be referenced.

---

## 5. Roles and certificates

| Role      | Asserts                                                    | DID method       |
|-----------|------------------------------------------------------------|------------------|
| `root`    | this franchise CA is part of the network                    | `did:web`        |
| `company` | this kiosk / engine / grader operates under my franchise    | `did:web`        |
| `kiosk`   | these scans came off this station at this time              | `did:smartledger`|
| `grader`  | this grade came from this engine at this model version      | `did:smartledger`|
| `human`   | I reviewed this and stand behind the override               | `did:smartledger`|

Certificates are W3C Verifiable Credentials in JWT form (`ES256K`), chaining
`root → company → {kiosk, grader, human}`. Chains deeper than two levels MUST be
rejected.

Verifiers MUST pass an explicit `allowedAlgs` and MUST NOT trust `header.alg`.

An envelope in which a `root` or `company` key signs a `Capture`, `Grade`,
`GradeOverride` or `Issue` MUST be rejected, even if the signature is cryptographically
valid. The company key is a CA; it never appears in the per-card path, so revoking a
franchisee never invalidates cards.

### 5.1 Capabilities

```jsonc
"capabilities": {
  "attest:capture":        { "mode": "auto" },
  "attest:grade":          { "mode": "auto", "modelVersion": "…", "rubric": "1.4.0" },
  "attest:grade.override": { "mode": "manual", "requiresPresence": true },
  "attest:issue":          { "mode": "auto", "maxPerDay": 500 }
}
```

`mode` is a property of a capability, not of a key: one key MAY hold both `auto` and
`manual` capabilities.

- A `manual` signature MUST carry a `presence` object naming the factor and the time it
  was satisfied. Default freshness SHOULD be 15 minutes.
- A verifier MUST reject `mode:"manual"` against a capability declared `auto`, and
  `mode:"auto"` against one declared `manual`.

### 5.2 Constraints

```jsonc
"constraints": {
  "requiresCosign": [
    { "when": "payload.grade.score >= 9.5", "role": "human", "mode": "manual" }
  ]
}
```

The predicate language MUST be total and side-effect free: comparison operators over
dotted paths into the payload, and nothing else. No regular expressions, no arithmetic,
no function calls. A verifier that cannot evaluate a constraint MUST return
`indeterminate`.

---

## 6. Validity at height

Authorization MUST be evaluated at the block height at which the attestation was
anchored, never at the verifier's current height. Otherwise revoking a franchisee
retroactively destroys every honest card they produced.

Certificate issuance and revocation are themselves envelopes (`CertIssue`,
`Revocation`), anchored like any other.

```
validFrom(C)  = anchorHeight( CertIssue(C) )
validTo(C)    = min( C.credentialSubject.validToHeight,
                     anchorHeight( Revocation(C) )  if revoked )

validAt(C, H) = validFrom(C) ≤ H ≤ validTo(C)

authorized(E) = H := anchorHeight(E)
                ∀ C ∈ chain(E) : validAt(C, H)
              ∧ chain(E) terminates at a pinned root
              ∧ capabilities(E.role) permits E.type in E.mode
```

`validFrom` is derived, not asserted, which avoids stating a start height inside a
document whose anchor height is not yet known.

Heights MUST be obtained from header-verified SPV proofs. An implementation MUST NOT
trust a service's assertion of a height without the proof backing it.

An envelope whose anchor is unmined has no height. Verifiers MUST return `unconfirmed`
and MUST NOT substitute the current tip height.

---

## 7. Verification

### 7.1 The verifier contract

- MUST hold no private key and require no authentication to read.
- MUST be a pure function of `(envelope, chain data, pinned roots)`.
- MUST NOT consult any operator-controlled database to reach a verdict.
- MUST fail closed: any unevaluable condition yields `indeterminate`.
- Pinned roots MUST be published with the height at which each was first anchored.

```jsonc
{
  "verdict":    "valid" | "invalid" | "unconfirmed" | "indeterminate",
  "assurance":  "capture-bound" | "signed-multi" | "legacy-single-key",
  "height":     838900,
  "chain":      [ { "role": "kiosk", "did": "…", "validAtHeight": true } ],
  "references": { "captures": "matched" },
  "reasons":    [ ]
}
```

### 7.2 Assurance tiers

| Tier                | Condition                                                       |
|---------------------|-----------------------------------------------------------------|
| `capture-bound`     | v ≥ 2, kiosk + grader signatures, references matched to anchored captures |
| `signed-multi`      | v ≥ 2, valid chain, no matching anchored capture                |
| `legacy-single-key` | no `v` field                                                    |

An envelope with no `v` field MUST be verified against the pinned legacy key **and the
legacy canonicalization**, and if the signature holds returned as `valid` with
`assurance: "legacy-single-key"`. It MUST NOT be returned `invalid` merely for lacking
fields that did not exist when it was signed.

The tiers MUST be published as part of the public verifier documentation.

---

## 8. Conformance

An implementation is conformant when it reproduces every case in `vectors/`.

```
node runner.mjs --canonical      <module>
node runner.mjs --signing-input  <module>
```

- Every package that produces or consumes signed bytes MUST run the vectors in CI.
- Vectors MUST be additive. Changing an existing case's expected output is a
  wire-format change and MUST come with an envelope version bump.
- The `canonical` set MUST be published with the public verifier documentation, so a
  third-party implementer in another language can prove conformance without access to
  our source.

Legacy canonicalization MUST remain reachable for verification of pre-v2 records, and
MUST NOT be reachable from any path that produces a new signature.
