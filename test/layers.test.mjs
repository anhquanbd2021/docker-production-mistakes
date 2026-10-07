import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateLayers, containerView, recoverableFiles } from '../public/layers.mjs';
import { VULNERABLE_DOCKERFILE, REPO_FILES } from '../public/examples.mjs';

test('container view excludes the removed file', () => {
  const layers = simulateLayers(VULNERABLE_DOCKERFILE, REPO_FILES);
  assert.ok(!containerView(layers).includes('.env'));
});

test('a deleted secret is still recoverable from its adding layer', () => {
  const layers = simulateLayers(VULNERABLE_DOCKERFILE, REPO_FILES);
  const hits = recoverableFiles(layers).filter(r => r.file === '.env');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].addedLayer < hits[0].removedLayer);
});

test('COPY . . expands to the whole build context', () => {
  const layers = simulateLayers(VULNERABLE_DOCKERFILE, REPO_FILES);
  const copyAll = layers.find(l => l.summary.startsWith('. .'));
  assert.ok(copyAll.adds.includes('.env'));
  assert.ok(copyAll.adds.includes('.git/config'));
});

test('nothing is recoverable when no file is copied then removed', () => {
  const layers = simulateLayers('FROM scratch\nCOPY app.js .\nUSER nobody\n');
  assert.equal(recoverableFiles(layers).length, 0);
});
