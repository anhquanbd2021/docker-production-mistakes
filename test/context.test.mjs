import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseDockerignore, isIgnored, sweepContext } from '../public/context.mjs';
import { REPO_FILES, FIXED_DOCKERIGNORE } from '../public/examples.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('embedded .dockerignore matches file on disk', async () => {
  const f = await readFile(`${root}examples/fixed/.dockerignore`, 'utf8');
  assert.equal(FIXED_DOCKERIGNORE, f.replace(/\r\n/g, '\n'));
});

test('empty .dockerignore sweeps the whole repo', () => {
  const { swept } = sweepContext(REPO_FILES, '');
  assert.equal(swept.length, REPO_FILES.length);
});

test('fixed .dockerignore keeps secrets and junk out', () => {
  const { swept, ignored } = sweepContext(REPO_FILES, FIXED_DOCKERIGNORE);
  for (const f of swept) {
    assert.ok(!/^\.git\//.test(f) && !/^\.env/.test(f) && !/^node_modules\//.test(f), f);
  }
  assert.ok(ignored.includes('.env'));
  assert.ok(ignored.includes('.git/config'));
  assert.ok(swept.includes('src/index.js'));
  assert.ok(swept.includes('package.json'));
});

test('plain directory names exclude their contents', () => {
  const rules = parseDockerignore('node_modules');
  assert.ok(isIgnored('node_modules/express/index.js', rules));
  assert.ok(!isIgnored('src/index.js', rules));
});

test('negation re-includes and last match wins', () => {
  const rules = parseDockerignore('.env*\n!.env.example');
  assert.ok(isIgnored('.env', rules));
  assert.ok(isIgnored('.env.local', rules));
  assert.ok(!isIgnored('.env.example', rules));
});

test('** crosses directories; * does not', () => {
  const rules = parseDockerignore('**/*.log');
  assert.ok(isIgnored('a/b/c.log', rules));
  assert.ok(!isIgnored('a/b/c.txt', rules));
  const star = parseDockerignore('*.log');
  assert.ok(isIgnored('npm-debug.log', star));
  assert.ok(!isIgnored('logs/npm-debug.log', star));
});
