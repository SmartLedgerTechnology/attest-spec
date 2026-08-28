# Attestation envelope and delegated signing — normative specification

**Status:** draft 0.3 · **Package:** `@smartledger/attest` · **Vectors:** `@smartledger/attest-vectors`

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
    { "type": "Capture", "face": "front", "hash": "sha256:…",
      "ref": { "txid": "…", "vout": 0 } }        // SHOULD, per §8.5
  ],

  "retrieval":  { },           // REQUIRED. How to obtain this envelope — §8.1.
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

`signatures`, `anchor` and `retrieval` are excluded — the digest covers `payload`,
`references` and `context`, and nothing else. Consequences an implementation MUST
preserve:

- **Countersignable.** A party may append a signature later without re-serializing the
  envelope; existing signatures remain valid.
- **Order-independent.** Verifiers MUST NOT depend on the order of `signatures`.
- **Domain-separated.** A signature over a `Grade` cannot be replayed as a signature
  over a `GradeOverride` with byte-identical claims.

`references` MUST be treated as an array, so its order is part of the signed bytes.
When absent it is the empty array, which still participates in the digest.

The `0x00` separators are required. Without them, two different `(payload, references)`
pairs could produce one digest. `0x00` cannot occur in canonical JSON output.

`retrieval` is outside the digest deliberately. Where an envelope can be obtained may
legitimately change over its life — a `hosted` URL moves, a `held` envelope is later
inscribed — and none of that alters what was attested. Leaving it unsigned also costs
nothing: a forged declaration cannot produce a false verdict, because §8.4 requires a
verifier to report the profile it actually used rather than the one it was told.

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

ML-DSA-65 signatures are ~3.3 KB. They belong in the envelope rather than the anchor;
only the `signingInput` digest is anchored. Where the envelope itself lives is a
separate question with its own requirements — see §8.

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
- MUST NOT consult any operator-controlled database to reach a verdict, and MUST
  recompute `signingInput` over any envelope it retrieves before using it (§8.3).
- MUST fail closed: any unevaluable condition yields `indeterminate`.
- Pinned roots MUST be published with the height at which each was first anchored.

```jsonc
{
  "verdict":    "valid" | "invalid" | "unconfirmed" | "indeterminate",
  "assurance":  "capture-bound" | "signed-multi" | "legacy-single-key",
  "retrieval":  "inscribed" | "hosted" | "held" | "unavailable",   // §8.4
  "binding":    "checked" | "unchecked" | "absent",                // §8.7
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

## 8. Envelope retrieval

A verdict requires the envelope. §7.1 makes the *verification* independent of the
issuer and says nothing about **obtaining** the document, which left the guarantee
nominal: a verifier may not consult an operator-controlled database to reach a
verdict, yet could be unable to get the envelope without one.

This section closes that. It was raised against a real case — a graded trading card
is a bearer instrument, and the holder who taps its chip in five years must be able
to verify it whether or not the issuer still exists.

Serving that case takes four things, and each of the last three was found missing
after the one before it was written: the envelope must be *obtainable* (§8.1–8.2),
what arrives must be *checked* (§8.3), the holder must be able to *find* it starting
from the thing they hold (§8.6), and it must be *bound* to that thing rather than to
some other (§8.7). A deployment missing any one of them has a guarantee that reads
well and does not hold.

All four together still yield only integrity. Authenticity comes from the certificate
chain of §5, and §8.8 is explicit about that, because a chain that traverses cleanly
is persuasive in a way that has nothing to do with whether it is signed.

### 8.1 The anchored digest is not enough

An anchor proves a document existed and was authorized. It does not produce the
document. Any deployment where the envelope is reachable only from the issuer has
authorization that survives the issuer and content that does not, which for a
transferable item is the same as no guarantee at all.

Every envelope MUST therefore declare **how** it can be retrieved:

```jsonc
"retrieval": { "profile": "inscribed" }                          // §8.2
"retrieval": { "profile": "hosted", "ref": "https://…" }
"retrieval": { "profile": "held" }
```

`profile` is REQUIRED. `ref` is REQUIRED for `hosted`, and MUST be absent for
`inscribed` and `held`.

An earlier draft required `ref` on every profile. For `inscribed` that is
**unsatisfiable**: the locator is the envelope's own outpoint, which cannot be known
until the envelope is inscribed, and writing it in changes the bytes and therefore the
txid. There is no fixed point.

It would also be useless if it existed. A self-locator can only be read by someone who
already holds the envelope, so it can never bootstrap retrieval. For `inscribed` the
locator that does the work is always in whatever pointed you here — the referring
envelope (§8.5), or the thing itself (§8.6). An envelope declares its profile; other
documents say where it is.

Where a locator does appear, an outpoint is carried as a **structured pair**, not a
string. Earlier drafts wrote `<txid>o<index>` — a separator this document invented.
Measured against a real inscription on the two gateways serving BSV ordinals today:

```
<txid>_0    gorillapool 200    ordfs 200
<txid>o0    gorillapool 500    ordfs 400     ← the form this spec used to specify
<txid>:0    gorillapool 500    ordfs 200
```

The invented form fails on both. Since §8.5 exists so the capture chain is
traversable from chain data alone, a locator that errors on every gateway defeats
the section entirely.

Rather than pin a separator, carry the parts. Implementations then need no locator
parser and cannot silently disagree about one. When a string is required — building
a gateway URL — `<txid>_<vout>` is the form both current gateways accept, but that
is a rendering detail, not part of the format.

### 8.2 Profiles

| Profile | Located by | `ref` in this envelope | The envelope is obtainable | Suitable for |
| --- | --- | --- | --- | --- |
| `inscribed` | an outpoint, held by the referrer | absent (§8.1) | by anyone, from any chain gateway, permanently | bearer instruments |
| `hosted` | a URL | REQUIRED | while the issuer serves it | records with a custodian |
| `held` | out of band | absent | by whoever was given a copy | private attestations |

`inscribed` means the envelope is written to the chain at its own outpoint. This is
not a contradiction of §3.1: *off-chain* there distinguishes the envelope from the
**anchor**, not from the chain. The digest anchors exactly as specified; the envelope
sits separately and is fetched by anyone.

Implementations SHOULD use `inscribed` where the attested item can change hands. At
~5–6 KB an envelope with an ML-DSA-65 signature costs roughly 600 satoshis at 100
sat/KB, which is small against the value of an item whose provenance is the reason
it has value. A 16,916-byte document has been inscribed and served from two
independent gateways for 859 satoshis — though that was paid at 50 sat/KB, so the
like-for-like figure at 100 is roughly 1,700. The envelope estimate above is the one
to plan against; the inscription is cited as evidence that this works in practice, not
as a price comparison.

An inscribed envelope SHOULD be written to its own satoshi rather than re-inscribed
onto the satoshi carrying the attested item. Correctness does not depend on this —
outpoints are immutable, so a locator stays valid either way — but a satoshi with
several inscriptions has no canonical rendering: a wallet showing the origin and one
showing the current tip both display something defensible, and neither is wrong. An
envelope added as a further inscription can become the tip, so a generic wallet would
render it where a holder expects the item. This has been observed on a backfill of 808
cards. It costs nothing to avoid at mint and is not correctable afterwards.

Inscription MUST NOT be mandatory. The payload is opaque to this layer (§2) and may
be confidential — an inventory manifest, a ballot, a medical attestation. Publishing
it permanently and irrevocably is the right default for a public grade and the wrong
one for most other things, and a specification that forces it would be unusable by
the products this one is meant to serve. `hosted` and `held` remain conformant; what
changes is what a verifier may claim about them (§8.4).

### 8.3 Retrieved bytes MUST be checked

A verifier MUST recompute `signingInput` over the retrieved envelope and compare it
to the anchored digest **before** using any part of it, whatever the profile.

This is not belt-and-braces. Delivered bytes are not necessarily stored bytes: a CDN,
a proxy, a gateway, or a compressing intermediary can alter a response in transit
without any party acting maliciously. Retrieval over HTTP has been observed returning
bytes that differ from what was inscribed. An unchecked fetch reintroduces exactly the
trust in an operator that §7.1 removes.

A mismatch MUST yield `indeterminate`, never `invalid` — the envelope may be intact at
its source and wrong only in this copy.

**Where there is no anchor.** `anchor` is present once anchored (§2), so an envelope
may legitimately have none — a `held` attestation that was never submitted, or one
whose anchor is still unmined. There is then no anchored digest, and the requirement
above has no referent: it is unsatisfiable rather than unsatisfied. A verifier MUST
NOT treat that as a mismatch.

Integrity is not lost in that case, only shifted. `signingInput` is computed from the
retrieved bytes, so a payload altered in transit changes it and every signature over
it fails — signature verification does the work the digest comparison would have done.
What is lost is time: §6 cannot produce a height, so `authorized()` is undefined.

An unanchored envelope therefore yields `unconfirmed`, with a reason distinguishing it
from an anchor that is merely unmined. Its signatures MAY still be reported as valid;
its authorization MUST NOT be.

### 8.4 Retrieval affects what a verdict may claim

The tiers in §7.2 describe how strongly an attestation is signed. They say nothing
about whether it can still be read, and for a transferable item that is the binding
property. A verdict therefore carries retrieval alongside assurance:

```jsonc
"retrieval": "inscribed" | "hosted" | "held" | "unavailable"
```

- A verifier MUST report the profile it actually used, not the one declared.
- **Discovery counts.** A retrieval that required an operator-controlled step at any
  point — finding the envelope, not only fetching it — is `hosted`, whatever the
  declaration says and wherever the bytes finally came from. An envelope inscribed on
  chain but locatable only through the issuer's resolver is `hosted`: the dependency
  on the issuer is unchanged by where the bytes live.

An **operator-controlled step** is one requiring a *response* from the operator.

Data already in the holder's possession is not operator-controlled, whatever its
format: bytes on a chip, a serial printed on the item, a QR code. What matters is
whether a chain-resolvable identity can be recovered from it **without dereferencing
anything**. The test is mechanical — take the network away, leave the holder only
what they physically have, and see whether an outpoint falls out.

Format does not decide this, and conflating the two loses the distinction §8 exists
to make:

| On the tag | Network-off | Profile it supports |
| --- | --- | --- |
| `https://issuer.example/twin/<txid>_<vout>` | outpoint recoverable | `inscribed` |
| `https://issuer.example/twin/<opaque-id>` | nothing recoverable | `hosted` |

The first is a URL and is self-sufficient; the second is a URL and is not. They have
completely different survival properties, and a verdict that cannot separate them is
not reporting anything useful.

This does not weaken the rule, because §8.4's first clause still governs: a verifier
reports the profile **it used**. A verifier that parses the outpoint and fetches from
a gateway used `inscribed`. One that dereferenced the issuer's URL used `hosted`,
even though the outpoint was sitting in the string it dereferenced. So a deployment
whose resolver does the work in practice will see `hosted` verdicts despite a
self-sufficient tag — which is the intended pressure, and the reason blessing this
format does not invite tags that merely look self-sufficient.

> **Tag payloads are usually permanent.** A builder that falls back to a
> non-chain-resolvable identifier when the outpoint is unavailable — `outpoint ?? id`
> — produces tags that can never be resolved without the issuer, and chips are
> commonly locked after writing. Such a fallback SHOULD fail the issuance instead. In
> the deployment that prompted this clause the fallback existed and never fired: all
> 816 issued tags carry an outpoint, and none carries a bare internal identifier. That
> was luck rather than design, and it is the kind of luck worth removing.
- `capture-bound` combined with `hosted` is an honest and useful verdict. It says the
  grade is bound to a physical capture *and* that reading it later depends on the
  issuer. A marketplace pricing durability needs both halves.
- An envelope that cannot be retrieved yields `indeterminate` with
  `retrieval: "unavailable"`, never `invalid`. Absence of a document is not evidence
  against it.

### 8.5 References SHOULD carry locators

Where a referenced envelope (§2, §4) is `inscribed`, its `EnvelopeReference` SHOULD
carry the outpoint as well as the hash:

```jsonc
{ "type": "Capture", "face": "front", "hash": "sha256:…",
  "ref": { "txid": "…", "vout": 0 } }
```

The hash remains the binding commitment; the locator is a convenience. With it, the
capture-binding chain of §4 is traversable from chain data alone, so a verifier can
confirm that a grade's captures exist and match without asking any service to resolve
them. Without it, the binding is still sound but checking it needs an index.

**The locator is inside the signed bytes, so it constrains when you may sign.**
`references` is part of `signingInput` (§2.1). A locator therefore cannot be attached
after signing: a referencing envelope MUST NOT be signed until its referents are
inscribed and their outpoints known.

This is worth stating because the natural implementation gets it backwards. Signing a
grade when the grade is produced and attaching locators later is the obvious order,
and it silently yields envelopes whose signatures do not verify — the two
`signingInput` values differ, and nothing complains until a verifier says so. The
working order is: capture, inscribe the captures, *then* sign the grade, then inscribe
it.

It costs nothing, because §4 already requires captures to be anchored at or before
the grade that references them. The constraint composes with an ordering that was
mandatory anyway.

*Why the locator is signed rather than left outside.* Excluding it would remove the
constraint, and a tampered locator would be caught by §8.3's hash check regardless —
so this was a real choice, not an oversight. It is signed because the alternative buys
an ordering freedom that §4 forecloses anyway, while costing a change to `signingInput`
semantics and therefore an envelope version bump (§9). Keeping it signed also means a
verifier that trusts the locator before fetching is trusting something the issuer
committed to, which is a smaller leap.

### 8.6 Reaching the envelope from the attested thing

§8.5 gives locators from one envelope to another. That is not enough for the case
§8 exists to serve. A holder does not begin with an envelope; they begin with the
thing in their hand — a slab, a document, a device — and need a path from it to the
envelope about it.

Nothing above provided one, and §8.2's own-satoshi recommendation removed the
mechanism an implementer would otherwise have fallen into: inscribing the envelope
onto the item's own satoshi made discovery implicit, by walking the lineage. That
approach has the rendering hazard §8.2 describes, so the recommendation stands — but
it withdrew an unstated discovery path without supplying one.

**Where an attestation concerns a transferable thing, the path from that thing to its
envelope MUST be followable by the holder without the issuer, or the deployment MUST
NOT claim the `inscribed` profile.** By §8.4 it is `hosted`, and honestly so: an
envelope on chain that can only be found by asking the issuer leaves the holder as
dependent as one stored on the issuer's disk.

"Without the issuer" is as §8.4 defines it: no *response* from the issuer is needed.
A locator the holder already physically has satisfies this whatever its format, so a
chip carrying an issuer URL with the outpoint embedded in it qualifies, and one
carrying an opaque identifier does not.

This specification does not define what a thing is, so it does not define the
mechanism. What it requires is that the mechanism exist and not route through the
issuer.

*Non-normative.* The ordering that makes this work without any index or new primitive
is to **inscribe the envelope first, then create the item carrying the envelope's
outpoint**. The obvious ordering is blocked by a forward reference — an item cannot
cite an envelope that does not exist, and an envelope's txid depends on its own
content — and that disappears when the item is the later of the two. The item then
carries `{ txid, vout }`, the same structure as §8.5, and the holder needs nothing
but the chain. It composes with §4: captures inscribed first, the grade referencing
them, the item referencing the grade.

### 8.7 The envelope MUST bind to the thing

A pointer from a thing to an envelope is not authenticated by existing. Whoever
creates the thing chooses what it points at, and can point it at somebody else's
valid envelope.

Consider a forged item citing the outpoint of a genuine, correctly signed, properly
anchored envelope describing a *different* item. Every check in this specification
passes: the signatures verify, the chain is authorized at height, the retrieval is
`inscribed`. The verdict would be `valid` and entirely wrong.

The payload MUST therefore carry a binding to the thing it describes that the holder
can check against the thing itself — a commitment to a serial number, a chip UID, a
physical measurement. `uid_commitment` in the Verified Grades payload is one: the
holder reads the tag and recomputes it.

This does not make the payload legible to this layer. §2 keeps it opaque, and that
still holds: the requirement is that a binding be present and that the verifier say
whether it was checked. What form it takes, and how it is checked against the thing,
belong to the application — which is the only party that knows what the thing is.

A verifier MUST report whether it checked that binding:

```jsonc
"binding": "checked" | "unchecked" | "absent"
```

`unchecked` is the correct and expected answer for a remote verifier, which does not
have the thing in front of it — a marketplace can confirm the envelope is genuine and
authorized while being unable to confirm it describes the item in the listing, and
should say so rather than imply otherwise. `absent` means the payload carries no
binding at all, and a verdict of `valid` alongside it claims far less than it appears
to: that some authorized envelope exists, not that it is about this thing.

### 8.8 What retrieval does not give you

Everything in §8 concerns integrity and reachability. None of it establishes
**authenticity**, and the distinction is easy to lose because a fully traversable
chain feels conclusive.

A verifier can start from one outpoint, walk item → grade → captures → images, and
hash-check every body against the commitment that pointed at it. That proves the
documents are the ones committed to and that nobody altered them in transit. It says
nothing about who made them. A DID is a hash, so a public key is not recoverable from
it; without the certificate chain of §5 there is no key to check a signature against.

This has been demonstrated rather than argued. A six-inscription chain built with the
reference implementation and walked from a single outpoint passed 18 of 18 integrity
checks and verified zero signatures, because the envelopes carried no certificates.
That is the exact shape of the gap: every hash checks, and a verifier still cannot
tell you who produced any of it.

An implementation that walks the chain and reports success without §5 is reporting
that the bytes are intact — a real property, and not the one a holder is asking about.
Verdicts MUST NOT present integrity as authenticity: a chain that traverses cleanly
with no verifiable certificate is `indeterminate`, not `valid`.

---

## 9. Conformance

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
