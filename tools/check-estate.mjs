#!/usr/bin/env node
/**
 * Run the conformance vectors against every canonicalizer in the estate.
 *
 *   node tools/check-estate.mjs                 # assumes sibling checkouts
 *   node tools/check-estate.mjs --root ~/src    # or point at where they live
 *
 * The vectors are the contract; this is the sweep that says who honours it. It
 * exists because the answer changed under us once already: the conformant
 * implementations were the unreachable ones, and three separate packages
 * reimplemented the non-conformant form because that was the one they could see.
 *
 * Implementations are named rather than discovered. A canonicalizer that nobody
 * thought to list is exactly the one that drifts, so adding a package here is part
 * of adopting the vectors, not an afterthought.
 *
 * Exit code is 0 only if every implementation marked `mustPass` is conformant.
 * Missing checkouts are reported and skipped, never treated as passing.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOS = dirname(resolve(HERE, '..'));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const root = resolve(arg('--root', REPOS));

/**
 * `load` returns a canonicalize function, or throws with a reason the operator can
 * act on. `mustPass` marks the ones a red build should block: an implementation
 * kept deliberately non-conformant is recorded here with mustPass:false and an
 * `expect` note, so it stays visible instead of quietly dropping off the list.
 */
const IMPLEMENTATIONS = [
  {
    name: '@smartledger/bsv — lib/util/jcs.js (public from 9.2.0)',
    path: 'smartledger-bsv/lib/util/jcs.js',
    mustPass: true,
    load: (p) => {
      const JCS = createRequire(import.meta.url)(p);
      return (v) => JCS.stringify(v);
    },
  },
  {
    name: '@smartledger/bsv — LTP.Claim.canonicalize(claim, JCS)',
    path: 'smartledger-bsv/lib/ltp/claim.js',
    mustPass: true,
    load: (p) => {
      const Claim = createRequire(import.meta.url)(p);
      return (v) => Claim.canonicalize(v, Claim.CANONICALIZATION.JCS);
    },
  },
  {
    name: '@smartledger/bsv — LTP.Claim.canonicalize(claim, LEGACY)',
    path: 'smartledger-bsv/lib/ltp/claim.js',
    mustPass: false,
    expect: 'non-conformant by design; the 9.x default, flips in 10.0.0',
    load: (p) => {
      const Claim = createRequire(import.meta.url)(p);
      return (v) => Claim.canonicalize(v, Claim.CANONICALIZATION.LEGACY);
    },
  },
  {
    name: '@smartledger/envelope — src/jcs.ts (built)',
    path: 'lumenkeys/packages/envelope/dist/esm/jcs.js',
    mustPass: true,
    hint: 'run `npm run build` in packages/envelope',
    load: async (p) => (await import(pathToFileURL(p).href)).canonicalize,
  },
  {
    name: 'notaryhash — src/canonical/jcs.ts (source, not built)',
    path: 'notaryhash2026/src/canonical/jcs.ts',
    mustPass: false,
    expect: 'TypeScript source; check it via its own suite until a build is present',
    load: () => { throw new Error('TypeScript source cannot be imported directly'); },
  },
];

/**
 * Implementations that are not part of the published estate.
 *
 * Kept out of the list above so this file stays useful to anyone implementing the
 * spec, and loaded from `.estate.local.json` when present so an operator can sweep
 * their own unpublished services without that inventory living here. Shape:
 *
 *   { "implementations": [ { "name": …, "path": …, "mustPass": false,
 *                            "expect": …, "export": "canonicalize" } ] }
 */
const LOCAL_MANIFEST = join(HERE, '..', '.estate.local.json');
if (existsSync(LOCAL_MANIFEST)) {
  for (const entry of JSON.parse(readFileSync(LOCAL_MANIFEST, 'utf8')).implementations ?? []) {
    IMPLEMENTATIONS.push({
      ...entry,
      load: (p) => {
        const mod = createRequire(import.meta.url)(p);
        return entry.export ? mod[entry.export] : mod;
      },
    });
  }
}

const vectors = JSON.parse(readFileSync(join(HERE, '..', 'vectors', 'canonical.json'), 'utf8'));

function score(fn) {
  let pass = 0;
  const failed = [];
  for (const c of vectors.cases) {
    let actual;
    try {
      actual = fn(c.input);
    } catch (err) {
      failed.push(`${c.name}: threw ${err.message}`);
      continue;
    }
    if (actual === c.expected) pass++;
    else failed.push(c.name);
  }
  return { pass, total: vectors.cases.length, failed };
}

const results = [];

for (const impl of IMPLEMENTATIONS) {
  const full = join(root, impl.path);
  if (!existsSync(full)) {
    results.push({ impl, status: 'missing', detail: impl.hint || full });
    continue;
  }
  let fn;
  try {
    fn = await impl.load(full);
  } catch (err) {
    results.push({ impl, status: 'unloadable', detail: err.message });
    continue;
  }
  results.push({ impl, status: 'scored', ...score(fn) });
}

const width = Math.max(...IMPLEMENTATIONS.map((i) => i.name.length));
let blocking = 0;

console.log(`conformance sweep — ${vectors.cases.length} canonical vectors, root ${root}\n`);

for (const r of results) {
  const name = r.impl.name.padEnd(width);
  if (r.status !== 'scored') {
    console.log(`  ${r.status.toUpperCase().padEnd(10)} ${name}  ${r.detail}`);
    if (r.impl.mustPass) blocking++;
    continue;
  }
  const conformant = r.pass === r.total;
  const mark = conformant ? 'PASS' : 'FAIL';
  const note = conformant ? '' : `  (${r.impl.expect || r.failed.slice(0, 2).join(', ')})`;
  console.log(`  ${mark.padEnd(10)} ${name}  ${r.pass}/${r.total}${note}`);
  if (!conformant && r.impl.mustPass) blocking++;
}

console.log('');
if (blocking) {
  console.log(`${blocking} implementation(s) that must be conformant are not.`);
  console.log('An implementation that cannot reproduce these vectors produces signatures');
  console.log('the rest of the estate rejects, and rejects signatures it should accept.');
  process.exit(1);
}
console.log('every implementation that must be conformant is.');
