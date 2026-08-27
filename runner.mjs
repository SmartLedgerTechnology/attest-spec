#!/usr/bin/env node
/**
 * Conformance runner. Point it at an implementation and it tells you whether
 * that implementation can be trusted to produce bytes the rest of the estate
 * will verify.
 *
 *   node runner.mjs --canonical ./reference/jcs.mjs
 *   node runner.mjs --canonical ../smartledger-bsv/lib/util/jcs.js --export stringify
 *   node runner.mjs --signing-input ./reference/signing-input.mjs
 *
 * The module must export a function. Pass --export to name it; otherwise the
 * runner tries `canonicalize`, `stringify`, then the default export.
 *
 * Exit code is 0 only if every case passes, so this drops straight into CI.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = ['canonicalize', 'stringify', 'signingInputHex', 'default'];

function parseArgs(argv) {
  const out = { set: null, module: null, exportName: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--canonical') { out.set = 'canonical'; out.module = argv[++i]; }
    else if (a === '--signing-input') { out.set = 'signing-input'; out.module = argv[++i]; }
    else if (a === '--export') { out.exportName = argv[++i]; }
    else if (a === '--help' || a === '-h') { out.help = true; }
    else { out.unknown = a; }
  }
  return out;
}

function usage() {
  console.log(`conformance runner

  node runner.mjs --canonical <module> [--export name]
  node runner.mjs --signing-input <module> [--export name]

The module must export a function taking one value and returning, respectively,
the canonical JSON string or the lowercase hex signing-input digest.`);
}

async function loadFn(modulePath, exportName) {
  const url = pathToFileURL(resolve(process.cwd(), modulePath)).href;
  let mod;
  try {
    mod = await import(url);
  } catch (err) {
    throw new Error(`could not import ${modulePath}\n  ${err.message}`);
  }
  if (exportName) {
    const fn = mod[exportName];
    if (typeof fn !== 'function') {
      throw new Error(`${modulePath} has no exported function named "${exportName}"\n  exports: ${Object.keys(mod).join(', ') || '(none)'}`);
    }
    return fn;
  }
  for (const name of CANDIDATES) {
    if (typeof mod[name] === 'function') return mod[name];
  }
  throw new Error(
    `${modulePath} exports no recognised function. Pass --export with one of: ${Object.keys(mod).join(', ') || '(none)'}`
  );
}

function loadVectors(set) {
  const file = join(HERE, 'vectors', `${set}.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function subject(set, testCase) {
  return set === 'canonical' ? testCase.input : testCase.envelope;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.set || !args.module) { usage(); process.exit(args.help ? 0 : 2); }

  const fn = await loadFn(args.module, args.exportName);
  const { cases, vectorSet } = loadVectors(args.set);

  let passed = 0;
  const failures = [];

  for (const c of cases) {
    let actual;
    try {
      actual = fn(subject(args.set, c));
    } catch (err) {
      failures.push({ name: c.name, note: c.note, expected: c.expected, actual: `threw: ${err.message}` });
      continue;
    }
    if (actual === c.expected) passed++;
    else failures.push({ name: c.name, note: c.note, expected: c.expected, actual: String(actual) });
  }

  console.log(`${vectorSet}: ${passed}/${cases.length} passed  (${args.module})\n`);

  for (const f of failures) {
    console.log(`FAIL  ${f.name}`);
    console.log(`      ${f.note}`);
    console.log(`      expected  ${f.expected}`);
    console.log(`      actual    ${f.actual}\n`);
  }

  if (failures.length) {
    console.log(`${failures.length} failing. An implementation that cannot reproduce these vectors will`);
    console.log(`produce signatures the rest of the estate rejects, and reject signatures it should accept.`);
    process.exit(1);
  }
  console.log('conformant.');
}

main().catch((err) => { console.error(err.message); process.exit(2); });
