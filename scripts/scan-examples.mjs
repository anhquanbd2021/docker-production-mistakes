// Side-by-side report: scan the vulnerable and fixed example Dockerfiles.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scanDockerfile } from '../public/rules.mjs';
import { simulateLayers, containerView, recoverableFiles } from '../public/layers.mjs';
import { sweepContext } from '../public/context.mjs';
import { REPO_FILES } from '../public/examples.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const [vulnerable, fixed, dockerignore] = await Promise.all([
  readFile(`${root}examples/vulnerable/Dockerfile`, 'utf8'),
  readFile(`${root}examples/fixed/Dockerfile`, 'utf8'),
  readFile(`${root}examples/fixed/.dockerignore`, 'utf8'),
]);

const left = scanDockerfile(vulnerable, { hasDockerignore: false, hasLimits: false });
const right = scanDockerfile(fixed, { hasDockerignore: true, hasLimits: true });
const mark = { fail: 'FAIL', warn: 'warn', info: 'info', pass: ' ok ' };

console.log('Dockerfile Doctor — examples report\n');
console.log(`${'#'.padStart(3)}${'check'.padEnd(26)}${'vulnerable'.padEnd(12)}fixed`);
for (const f of left.findings) {
  const r = right.findings.find(x => x.id === f.id);
  console.log(`${String(f.num).padStart(3)}${f.title.padEnd(26)}${mark[f.status].padEnd(12)}${mark[r.status]}`);
}
console.log(`\nvulnerable: ${left.score.fail} fail · ${left.score.warn} warn | fixed: ${right.score.fail} fail · ${right.score.warn} warn`);

const layers = simulateLayers(vulnerable, REPO_FILES);
const recovered = recoverableFiles(layers);
console.log(`\nLayer lab — container sees: ${containerView(layers).filter(f => f === '.env').length ? '.env' : 'no .env'}`);
for (const r of recovered) {
  console.log(`  "${r.file}" deleted in layer ${r.removedLayer + 1} still recoverable from layer ${r.addedLayer + 1}`);
}

const sweep = sweepContext(REPO_FILES, '');
const sealed = sweepContext(REPO_FILES, dockerignore);
console.log(`\nContext lab — COPY . . sweeps ${sweep.swept.length} files without .dockerignore, ${sealed.swept.length} with it`);
console.log(`  secrets swept without: ${sweep.swept.filter(f => /env|secret/i.test(f)).join(', ') || 'none'}`);
console.log(`  secrets swept with:    ${sealed.swept.filter(f => /env|secret/i.test(f)).join(', ') || 'none'}`);
