/**
 * Reference construction of the bytes every signer signs — SPEC §6.1.
 *
 *   signingInput = SHA-256( JCS(payload) ‖ 0x00 ‖ JCS(references) ‖ 0x00 ‖ JCS(context) )
 *   context      = { v, type }
 *
 * Three properties this shape is chosen for, each of which a naive
 * `sha256(JSON.stringify(envelope))` would lose:
 *
 *   Countersignable. `signatures` and `anchor` are excluded, so a human grader
 *   reviewing a card an hour later appends to the signature array without
 *   re-serializing anything, and the kiosk's existing signature still verifies.
 *
 *   Order-independent. Nothing about the signature array feeds the digest, so
 *   verifiers must not depend on signature order, and two parties signing
 *   concurrently cannot conflict.
 *
 *   Domain-separated. `context` carries the envelope version and type, so a
 *   signature over a Grade payload cannot be replayed as a signature over a
 *   GradeOverride with byte-identical claims. This is cheap now and impossible
 *   to retrofit once signatures exist in the wild.
 *
 * The 0x00 separators matter: without them, a payload ending in bytes that a
 * references array could begin with would let two different (payload,
 * references) pairs produce one digest. 0x00 cannot occur in the output of
 * canonicalize(), because JCS escapes it inside strings and never emits it
 * structurally.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './jcs.mjs';

/**
 * @param {{ v: string, type: string, payload: unknown, references?: unknown[] }} envelope
 * @returns {Buffer} 32-byte digest
 */
export function signingInput(envelope) {
  if (!envelope || typeof envelope !== 'object') {
    throw new TypeError('signingInput: envelope must be an object');
  }
  const { v, type, payload, references = [] } = envelope;

  if (typeof v !== 'string' || v.length === 0) {
    throw new TypeError('signingInput: envelope.v is required — an unversioned envelope cannot be verified later');
  }
  if (typeof type !== 'string' || type.length === 0) {
    throw new TypeError('signingInput: envelope.type is required for domain separation');
  }
  if (!Array.isArray(references)) {
    throw new TypeError('signingInput: envelope.references must be an array when present');
  }

  const SEP = Buffer.from([0x00]);
  return createHash('sha256')
    .update(Buffer.from(canonicalize(payload), 'utf8'))
    .update(SEP)
    .update(Buffer.from(canonicalize(references), 'utf8'))
    .update(SEP)
    .update(Buffer.from(canonicalize({ v, type }), 'utf8'))
    .digest();
}

/** Hex form, which is what the vectors record and what notarizeHash takes. */
export function signingInputHex(envelope) {
  return signingInput(envelope).toString('hex');
}
