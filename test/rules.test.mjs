import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseDockerfile, scanDockerfile } from '../public/rules.mjs';
import { VULNERABLE_DOCKERFILE, FIXED_DOCKERFILE } from '../public/examples.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const finding = (result, id) => result.findings.find(f => f.id === id);

test('parseDockerfile joins continuations and skips comments', () => {
  const ins = parseDockerfile('# c\nFROM node\nRUN a \\\n  && b\n\nUSER node\n');
  assert.equal(ins.length, 3);
  assert.equal(ins[1].instr, 'RUN');
  assert.equal(ins[1].line, 3);
});

test('embedded examples match files on disk', async () => {
  const norm = s => s.replace(/\r\n/g, '\n');
  const v = await readFile(`${root}examples/vulnerable/Dockerfile`, 'utf8');
  const f = await readFile(`${root}examples/fixed/Dockerfile`, 'utf8');
  assert.equal(VULNERABLE_DOCKERFILE, norm(v));
  assert.equal(FIXED_DOCKERFILE, norm(f));
});

test('vulnerable example fails the runtime checks', () => {
  const r = scanDockerfile(VULNERABLE_DOCKERFILE, { hasDockerignore: false, hasLimits: false });
  for (const id of ['dockerignore', 'layer-caching', 'single-stage', 'secret-layers', 'latest-tag', 'root-user', 'many-processes', 'resource-limits']) {
    assert.equal(finding(r, id).status, 'fail', id);
  }
  for (const id of ['bloated-image', 'healthcheck']) {
    assert.equal(finding(r, id).status, 'warn', id);
  }
});

test('fixed example passes every check', () => {
  const r = scanDockerfile(FIXED_DOCKERFILE, { hasDockerignore: true, hasLimits: true });
  for (const f of r.findings) assert.equal(f.status, 'pass', f.id);
});

test('implicit latest is flagged the same as explicit latest', () => {
  const r = scanDockerfile('FROM node\nUSER node\n');
  assert.equal(finding(r, 'latest-tag').status, 'fail');
  const r2 = scanDockerfile('FROM node:latest\nUSER node\n');
  assert.equal(finding(r2, 'latest-tag').status, 'fail');
});

test('rm of a copied secret is flagged, not forgiven', () => {
  const r = scanDockerfile('FROM scratch\nCOPY .env .\nRUN rm .env\nUSER nobody\n');
  const f = finding(r, 'secret-layers');
  assert.equal(f.status, 'fail');
  assert.ok(f.lines.includes(3), 'rm line is part of the evidence');
});

test('ENV with a secret literal fails; ARG without a value does not', () => {
  const bad = scanDockerfile('FROM scratch\nENV API_KEY=abc\nUSER nobody\n');
  assert.equal(finding(bad, 'secret-layers').status, 'fail');
  const ok = scanDockerfile('FROM scratch\nARG TOKEN\nUSER nobody\n');
  assert.equal(finding(ok, 'secret-layers').status, 'pass');
});

test('manifest-then-install ordering passes the caching check', () => {
  const df = 'FROM node:22-alpine\nCOPY package.json .\nRUN npm ci\nCOPY src ./src\nUSER node\n';
  const r = scanDockerfile(df);
  assert.equal(finding(r, 'layer-caching').status, 'pass');
});

test('daemon-chained CMD fails; single process passes', () => {
  const bad = scanDockerfile('FROM alpine\nCMD cron & node a.js\nUSER nobody\n');
  assert.equal(finding(bad, 'many-processes').status, 'fail');
  const ok = scanDockerfile('FROM alpine\nCMD ["node","a.js"]\nUSER nobody\n');
  assert.equal(finding(ok, 'many-processes').status, 'pass');
});

test('checks 1 and 10 report info when evidence is not supplied', () => {
  const r = scanDockerfile(FIXED_DOCKERFILE);
  assert.equal(finding(r, 'dockerignore').status, 'info');
  assert.equal(finding(r, 'resource-limits').status, 'info');
});
