/**
 * RFC 8785 (JSON Canonicalization Scheme) — normative reference implementation.
 *
 * This file is the tie-breaker. When an implementation and a vector disagree,
 * the vector is right; when a reader and the vector disagree, this code shows why.
 * It has no dependencies so that it can be read end to end in one sitting.
 *
 * The one subtlety worth stating up front, because getting it wrong is the
 * default outcome: you must SERIALIZE in sorted order, never sort keys and then
 * rebuild an object. V8 orders integer-like own properties numerically ahead of
 * string keys regardless of insertion order, so a rebuilt object silently loses
 * the sort:
 *
 *     sort-then-rebuild   {"2":"two","10":"ten"}
 *     RFC 8785            {"10":"ten","2":"two"}
 *
 * Within one implementation that is merely deterministic-but-nonstandard, and no
 * forgery follows from it. Across implementations it is a verification failure: a
 * conformant verifier in any other language computes a different hash and rejects
 * a valid signature.
 */

/** Sort by UTF-16 code unit, as RFC 8785 requires. */
function compareCodeUnits(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Serialize a value to its RFC 8785 canonical JSON form.
 *
 * @param {unknown} value
 * @returns {string} canonical JSON
 * @throws {TypeError} on non-finite numbers, bigint, circular references, or
 *                     values with no JSON representation
 */
export function canonicalize(value) {
  return serialize(value, new Set());
}

function serialize(value, seen) {
  if (value === null) return 'null';

  const t = typeof value;

  // JSON.stringify is used for these on purpose. For finite numbers it emits
  // ECMAScript Number::toString, which is exactly what JCS mandates, and since
  // ES2019 it emits well-formed output for lone surrogates. Both are easy to get
  // subtly wrong by hand.
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`canonicalize: non-finite number ${value} has no JSON representation`);
    }
    return JSON.stringify(value);
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);

  if (t === 'bigint') {
    throw new TypeError('canonicalize: bigint has no JSON representation; carry it as a string');
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new TypeError(`canonicalize: ${t} is not serializable at the top level`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('canonicalize: circular reference');
    seen.add(value);
    // Array order is meaningful and is preserved. Holes and undefined members
    // serialize as null, matching JSON.stringify.
    const out = '[' + value.map((v) => (isDroppable(v) ? 'null' : serialize(v, seen))).join(',') + ']';
    seen.delete(value);
    return out;
  }

  if (t === 'object') {
    if (seen.has(value)) throw new TypeError('canonicalize: circular reference');
    seen.add(value);
    const keys = Object.keys(value)
      .filter((k) => !isDroppable(value[k]))
      .sort(compareCodeUnits);
    const out =
      '{' +
      keys.map((k) => JSON.stringify(k) + ':' + serialize(value[k], seen)).join(',') +
      '}';
    seen.delete(value);
    return out;
  }

  throw new TypeError(`canonicalize: unsupported type ${t}`);
}

/** Object members with these values are omitted, matching JSON.stringify. */
function isDroppable(v) {
  return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

/**
 * The non-conformant form, kept ONLY so that legacy signatures can still be
 * verified and so the conformance suite can assert that it differs. It must
 * never be reachable from a code path that produces a NEW signature.
 *
 * @deprecated verification of pre-v2 records only
 */
export function canonicalizeLegacySortRebuild(value) {
  return JSON.stringify(sortRebuild(value));
}

function sortRebuild(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortRebuild);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = sortRebuild(value[k]);
  return out;
}
