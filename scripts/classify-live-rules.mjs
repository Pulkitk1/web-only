// Classifies a saved copy of the Firestore rules (for example the text copied from the Firebase Console) as one of the known rule sets.
// Read-only: it reads local files only and never contacts Firebase.
//
//   node scripts/classify-live-rules.mjs "D:\path\to\saved-live-rules.rules"
//
// Matching ignores a byte-order mark, CRLF versus LF, trailing spaces and trailing blank lines (a Console copy often differs only there).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();

/** The known rule sets (the original is the one-line wildcard, kept as a test fixture). */
const KNOWN = [
  ['ORIGINAL (the one-line owner-only wildcard that was in production before Part A)', 'tests/rules/production-observed.rules'],
  ['PART A (wallet integrity, firebase/firestore.rules)', 'firebase/firestore.rules'],
  ['PART B on the original rules (firebase/rules/part-b.rules, not a candidate)', 'firebase/rules/part-b.rules'],
  ['COMBINED (Part A + Part B, firebase/rules/combined.rules)', 'firebase/rules/combined.rules'],
].map(([label, rel]) => ({ label, rel, hash: sha(normalize(readFileSync(join(root, rel), 'utf8'))) }));

export function classify(text) {
  const norm = normalize(text);
  const hash = sha(norm);
  const exact = KNOWN.find((k) => k.hash === hash);
  const code = norm.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const evidence = {
    lines: norm.split('\n').length,
    wildcardCatchAll: /\{(document|rest)=\*\*\}/.test(code),
    partA_entryShape: code.includes('entryShape'),
    partA_profileCreateOk: code.includes('profileCreateOk'),
    partB_validHabit: code.includes('validHabit'),
    feedbackRule: code.includes('match /feedback'),
  };
  let verdict;
  if (exact) verdict = `EXACT MATCH: ${exact.label}`;
  else if (evidence.partA_entryShape && evidence.partB_validHabit) verdict = 'LOOKS LIKE the combined rules but is NOT identical (edited or a different version)';
  else if (evidence.partA_entryShape) verdict = 'LOOKS LIKE Part A but is NOT identical (edited or a different version)';
  else if (evidence.wildcardCatchAll && evidence.lines <= 3) verdict = 'LOOKS LIKE the original wildcard but is NOT identical';
  else verdict = 'UNKNOWN: not one of the known rule sets';
  return { verdict, normalizedSha256: hash, evidence, known: KNOWN.map((k) => ({ set: k.label, normalizedSha256: k.hash })) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const file = process.argv[2];
  if (!file || !existsSync(file)) {
    console.error('Usage: node scripts/classify-live-rules.mjs <path to a saved copy of the rules>');
    process.exit(2);
  }
  const r = classify(readFileSync(file, 'utf8'));
  console.log(`File:     ${file}`);
  console.log(`Verdict:  ${r.verdict}`);
  console.log(`Normalized SHA-256: ${r.normalizedSha256}`);
  console.log('Evidence:', JSON.stringify(r.evidence));
  console.log('Known sets (normalized hashes):');
  for (const k of r.known) console.log(`  ${k.normalizedSha256}  ${k.set}`);
  process.exit(r.verdict.startsWith('EXACT') ? 0 : 1);
}
