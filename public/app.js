import { scanDockerfile } from '/rules.mjs';
import { simulateLayers, containerView, recoverableFiles } from '/layers.mjs';
import { sweepContext } from '/context.mjs';
import { PRESETS, REPO_FILES } from '/examples.mjs';

const $ = id => document.getElementById(id);

for (const preset of PRESETS) {
  const option = document.createElement('option');
  option.value = preset.id;
  option.textContent = preset.title;
  $('preset').append(option);
}

const requested = new URLSearchParams(location.search).get('example');
if (PRESETS.some(p => p.id === requested)) $('preset').value = requested;

function loadPreset() {
  const p = PRESETS.find(x => x.id === $('preset').value);
  $('dockerfile').value = p.dockerfile;
  $('dockerignore').value = p.dockerignore;
  $('has-dockerignore').checked = p.hasDockerignore;
  $('has-limits').checked = p.hasLimits;
  history.replaceState(null, '', `/?example=${p.id}`);
  runAll();
}
$('preset').addEventListener('change', loadPreset);

function paintResults({ findings, score }) {
  $('score').textContent = `${score.fail} fail · ${score.warn} warn · ${score.pass} pass`;
  $('score').className = `badge ${score.fail ? 'danger' : score.warn ? 'warn' : 'success'}`;
  $('results').replaceChildren(...findings.map(f => {
    const li = document.createElement('li');
    li.className = `result ${f.status}`;
    const head = document.createElement('div');
    head.className = 'result-head';
    const badge = document.createElement('span');
    badge.className = `badge ${f.status}`;
    badge.textContent = f.status.toUpperCase();
    const title = document.createElement('strong');
    title.textContent = `${f.num}. ${f.title}`;
    head.append(badge, title);
    const body = document.createElement('p');
    body.textContent = f.detail || f.why;
    const fix = document.createElement('p');
    fix.className = 'fix';
    fix.textContent = `Fix: ${f.fix}`;
    li.append(head, body, fix);
    return li;
  }));
}

function paintLayers(text) {
  const layers = simulateLayers(text, REPO_FILES);
  $('layer-stack').replaceChildren(...layers.map((l, i) => {
    const li = document.createElement('li');
    li.className = l.removes.length ? 'layer danger-layer' : 'layer';
    const head = document.createElement('div');
    const num = document.createElement('strong');
    num.textContent = `L${i + 1} `;
    const code = document.createElement('code');
    code.textContent = `${l.instr} ${l.summary}`;
    head.append(num, code);
    li.append(head);
    if (l.adds.length) {
      const p = document.createElement('p');
      p.textContent = `+ ${l.adds.length > 6 ? `${l.adds.length} files` : l.adds.join(', ')}`;
      li.append(p);
    }
    if (l.removes.length) {
      const p = document.createElement('p');
      p.className = 'danger-text';
      p.textContent = `− removes ${l.removes.join(', ')} (masks only — the adding layer keeps it)`;
      li.append(p);
    }
    return li;
  }));
  const view = containerView(layers);
  const recovered = recoverableFiles(layers);
  $('container-view').textContent = view.length
    ? view.filter(f => f !== 'Dockerfile').slice(0, 12).join('\n') + (view.length > 12 ? `\n… ${view.length - 12} more` : '')
    : '(empty)';
  $('pull-view').textContent = recovered.length
    ? recovered.map(r => `"${r.file}" — deleted in L${r.removedLayer + 1}, still inside L${r.addedLayer + 1}`).join('\n')
    : 'nothing deleted-after-copy — no masked files';
}

function paintContext() {
  const { swept } = sweepContext(REPO_FILES, $('dockerignore').value);
  $('sweep-count').textContent = `${swept.length} of ${REPO_FILES.length} swept`;
  $('sweep-count').className = `badge ${swept.some(f => /env|secret|\.git\//i.test(f)) ? 'danger' : 'success'}`;
  $('file-list').replaceChildren(...REPO_FILES.map(f => {
    const li = document.createElement('li');
    const isSwept = swept.includes(f);
    const sensitive = /\.env|secret|\.git\//i.test(f);
    li.className = isSwept ? (sensitive ? 'file swept-sensitive' : 'file swept') : 'file ignored';
    li.textContent = `${f} ${isSwept ? '→ into the build' : '— excluded'}`;
    return li;
  }));
}

function runAll() {
  const opts = { hasDockerignore: $('has-dockerignore').checked, hasLimits: $('has-limits').checked };
  paintResults(scanDockerfile($('dockerfile').value, opts));
  paintLayers($('dockerfile').value);
  paintContext();
}

$('scan').addEventListener('click', runAll);
$('dockerfile').addEventListener('input', runAll);
$('dockerignore').addEventListener('input', () => {
  $('has-dockerignore').checked = $('dockerignore').value.trim().length > 0;
  runAll();
});
$('has-dockerignore').addEventListener('change', runAll);
$('has-limits').addEventListener('change', runAll);

loadPreset();
