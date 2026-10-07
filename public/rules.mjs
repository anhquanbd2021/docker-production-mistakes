// Dockerfile Doctor — rule engine for the 10 production mistakes.
// Pure ES module: imported by the browser UI, the CLI, and node:test.

export function parseDockerfile(text) {
  const instructions = [];
  const lines = String(text).split(/\r?\n/);
  let buffer = '';
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!buffer && (trimmed === '' || trimmed.startsWith('#'))) continue;
    if (!buffer) startLine = i + 1;
    buffer += (buffer ? '\n' : '') + raw;
    if (/\\\s*$/.test(raw)) continue;
    const match = buffer.trim().match(/^([A-Za-z]+)\s*([\s\S]*)$/);
    if (match) {
      instructions.push({ instr: match[1].toUpperCase(), args: match[2].trim(), line: startLine });
    }
    buffer = '';
  }
  return instructions;
}

function fromImages(instructions) {
  return instructions
    .filter(i => i.instr === 'FROM')
    .map(i => {
      const args = i.args.replace(/^(--\w+=\S+\s+)+/, '').trim();
      const ref = args.split(/\s+AS\s+|\s+as\s+/i)[0].trim();
      return { ref, line: i.line };
    });
}

function imageRef(ref) {
  if (ref.includes('@')) return { name: ref.split('@')[0], tag: 'digest' };
  const lastSlash = ref.lastIndexOf('/');
  const lastColon = ref.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return { name: ref.slice(0, lastColon), tag: ref.slice(lastColon + 1) };
  }
  return { name: ref, tag: null };
}

const FULL_OS_BASE = /^(node|python|ubuntu|debian|golang|ruby|php|openjdk|maven|gradle|centos|fedora|amazonlinux|mcr\.microsoft\.com\/dotnet\/sdk|eclipse-temurin)$/i;
const SLIM_HINT = /slim|alpine|distroless|nanoserver|jre|runtime|chainguard|scratch|bookworm-slim/i;
const SECRET_PATH = /(^|\/|\s)(\.env\S*|secrets?\b|credentials?\b|id_rsa|id_dsa|[^/\s]*\.(pem|key|p12|pfx|jks)|\.npmrc|\.netrc|kubeconfig)/i;
const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;
const DEP_INSTALL = /\b(npm|yarn|pnpm|pip|pip3|pipenv|poetry|apt-get|apt|apk|go|mvn|gradle|bundle|gem|cargo|composer|nuget|dotnet)\b[^|\n;]*\b(install|ci|add|download|restore|update|package|get)\b/i;
const BUILD_STEP = /\b(gcc|g\+\+|make|cmake|tsc|webpack|esbuild|rollup|vite|go\s+build|mvn\s+package|gradle(w)?\s+(build|assemble)|npm\s+run\s+build|pip\s+wheel|cargo\s+build|composer\s+install|dotnet\s+publish)\b/i;
const DAEMON_CHAIN = /&|\bsupervisord\b|\bcrond?\b|\bphp-fpm\b|\bnginx\b.*\b(node|php|python|gunicorn|uwsgi)\b|\bservice\s+\w+\s+start\b/i;

function copyArgs(args) {
  // returns { srcs, dest } for COPY/ADD args, dropping --flags
  const parts = args.split(/\s+/).filter(p => !p.startsWith('--'));
  return { srcs: parts.slice(0, -1), dest: parts[parts.length - 1] || '' };
}

export const CHECKS = [
  { id: 'dockerignore', num: 1, title: 'No .dockerignore',
    why: 'Without it, `COPY . .` can sweep .git, .env, node_modules and CI credentials into the image.',
    fix: 'Add a .dockerignore next to the Dockerfile: .git, .env*, node_modules, coverage, secrets.' },
  { id: 'layer-caching', num: 2, title: 'Ignoring layer caching',
    why: '`COPY . .` before dependency install invalidates the cache on every code edit — every build re-downloads packages.',
    fix: 'Copy dependency manifests first, install, then copy source. Put cheap-to-invalidate layers last.' },
  { id: 'bloated-image', num: 3, title: 'Bloated images',
    why: 'Full-OS bases ship shells, compilers and hundreds of unused binaries — slower deploys, more CVEs, a ready-made toolkit for intruders.',
    fix: 'Use a -slim, alpine or distroless base that contains only what the app needs to run.' },
  { id: 'single-stage', num: 4, title: 'Skipping multi-stage builds',
    why: 'Compilers and dev dependencies installed in a single stage end up in the shipped image forever.',
    fix: 'Build in a `builder` stage; copy only artifacts into a slim final stage with COPY --from=builder.' },
  { id: 'secret-layers', num: 5, title: 'Secrets in image layers',
    why: 'A secret copied into a layer survives `RUN rm` — layers are additive; `docker history` or a pull recovers it in seconds.',
    fix: 'Use --mount=type=secret for builds, env vars or mounted files at runtime, a secrets manager for anything serious — then rotate.' },
  { id: 'latest-tag', num: 6, title: '`latest` in production',
    why: '`latest` is a pointer that moves: two hosts pull "the same" image and run different versions; rollback becomes guesswork.',
    fix: 'Pin base images to a version or @sha256: digest; tag your own images with an immutable git SHA.' },
  { id: 'root-user', num: 7, title: 'Running as root',
    why: 'Root in the container turns one app bug into a root shell — and one escape into root on the host.',
    fix: 'Add a USER directive in the final stage (or --user / runAsNonRoot at runtime).' },
  { id: 'many-processes', num: 8, title: 'One container, many processes',
    why: 'Docker tracks PID 1 only; helper daemons die silently and get killed mid-write when the app exits.',
    fix: 'One concern per container: cron becomes a scheduled job, workers get their own deployment, logs go to stdout.' },
  { id: 'healthcheck', num: 9, title: 'No health checks',
    why: '"Process running" is not "service working" — a deadlocked app keeps receiving traffic and no restart is triggered.',
    fix: 'Add HEALTHCHECK (or liveness/readiness probes) that verifies real behavior, and wire something that acts on it.' },
  { id: 'resource-limits', num: 10, title: 'No resource limits',
    why: 'One runaway container can consume the whole host; the OOM killer does not have to pick the leaker.',
    fix: 'Set --memory/--cpus or compose mem_limit/cpus per container — a host outage becomes one restart.' },
];

// opts: { hasDockerignore: boolean|undefined, hasLimits: boolean|undefined }
export function scanDockerfile(text, opts = {}) {
  const ins = parseDockerfile(text);
  const froms = fromImages(ins);
  const first = froms[0];
  const findings = [];

  const report = (id, status, lines = [], detail = '') =>
    findings.push({ ...CHECKS.find(c => c.id === id), status, lines, detail });

  // 1. .dockerignore — not visible inside a Dockerfile; caller supplies evidence
  if (opts.hasDockerignore === undefined) {
    report('dockerignore', 'info', [], 'Not detectable from the Dockerfile — confirm a .dockerignore sits in the build context root.');
  } else {
    report('dockerignore', opts.hasDockerignore ? 'pass' : 'fail', [],
      opts.hasDockerignore ? 'Context file exclusions are declared.' : 'No .dockerignore provided — COPY . . sweeps everything in the context.');
  }

  // 2. Layer caching: whole-context COPY before dependency install
  const copyAll = ins.find(i => (i.instr === 'COPY' || i.instr === 'ADD') && copyArgs(i.args).srcs.some(s => s === '.' || s === './'));
  const depInstall = ins.find(i => i.instr === 'RUN' && DEP_INSTALL.test(i.args));
  if (copyAll && depInstall && copyAll.line < depInstall.line) {
    report('layer-caching', 'fail', [copyAll.line, depInstall.line],
      `\`COPY . .\` at line ${copyAll.line} runs before the dependency install at line ${depInstall.line} — every code edit busts the cache.`);
  } else if (depInstall) {
    report('layer-caching', 'pass', [depInstall.line], 'Dependency install happens before whole-context copy — cache survives code edits.');
  } else {
    report('layer-caching', 'info', [], 'No dependency install detected — ordering is unverifiable.');
  }

  // 3. Bloated base image
  const baseRef = first && imageRef(first.ref);
  if (baseRef && FULL_OS_BASE.test(baseRef.name.split('/').pop()) && !(baseRef.tag && SLIM_HINT.test(baseRef.tag))) {
    report('bloated-image', 'warn', [first.line], `Base \`${first.ref}\` ships a full OS toolchain.`);
  } else if (baseRef) {
    report('bloated-image', 'pass', [first.line], `Base \`${first.ref}\` is a reduced-footprint image.`);
  } else {
    report('bloated-image', 'info', [], 'No FROM instruction found.');
  }

  // 4. Multi-stage builds
  const multiStage = froms.length > 1 || ins.some(i => (i.instr === 'COPY' || i.instr === 'ADD') && /--from=/.test(i.args));
  const buildsInStage = ins.some(i => i.instr === 'RUN' && BUILD_STEP.test(i.args));
  if (multiStage) {
    report('single-stage', 'pass', froms.map(f => f.line), `${froms.length} stages — build tooling stays in the builder.`);
  } else if (buildsInStage) {
    const line = ins.find(i => i.instr === 'RUN' && BUILD_STEP.test(i.args)).line;
    report('single-stage', 'fail', [line], `Build tooling runs at line ${line} in the only stage — it ships to production.`);
  } else {
    report('single-stage', 'warn', [], 'Single stage and no build step detected — fine for interpreted apps, revisit if compilation appears.');
  }

  // 5. Secrets in layers
  const secretLines = [];
  const copied = new Set();
  for (const i of ins) {
    if (i.instr === 'COPY' || i.instr === 'ADD') {
      for (const src of copyArgs(i.args).srcs) {
        if (SECRET_PATH.test(src)) secretLines.push(i.line);
        copied.add(src.replace(/^\.\//, ''));
      }
    }
    if ((i.instr === 'ENV' || i.instr === 'ARG') && SECRET_NAME.test(i.args) && /=/.test(i.args)) {
      secretLines.push(i.line);
    }
    if (i.instr === 'RUN' && /\brm\b/.test(i.args)) {
      const masked = [...copied].filter(f => SECRET_PATH.test(f) && i.args.includes(f));
      if (masked.length) secretLines.push(i.line);
    }
  }
  if (secretLines.length) {
    const unique = [...new Set(secretLines)];
    report('secret-layers', 'fail', unique,
      `Sensitive material at line${unique.length > 1 ? 's' : ''} ${unique.join(', ')} — rm only masks it in a later layer.`);
  } else {
    report('secret-layers', 'pass', [], 'No secrets copied, embedded, or assigned in layers.');
  }

  // 6. latest / unpinned
  const unpinned = froms.filter(f => { const { tag } = imageRef(f.ref); return tag === null || tag === 'latest'; });
  if (unpinned.length) {
    report('latest-tag', 'fail', unpinned.map(f => f.line),
      unpinned.map(f => `\`${f.ref}\` at line ${f.line} has ${imageRef(f.ref).tag === null ? 'no tag (implicit latest)' : 'the moving latest tag'}`).join('; ') + '.');
  } else if (froms.length) {
    report('latest-tag', 'pass', froms.map(f => f.line), 'Every base image is pinned to a version or digest.');
  } else {
    report('latest-tag', 'info', [], 'No FROM instruction found.');
  }

  // 7. root user
  const users = ins.filter(i => i.instr === 'USER');
  const lastUser = users[users.length - 1];
  if (!lastUser) {
    report('root-user', 'fail', [], 'No USER instruction — the container runs as root by default.');
  } else if (/^(root|0)(:|$|\s)/.test(lastUser.args)) {
    report('root-user', 'fail', [lastUser.line], `\`USER ${lastUser.args}\` at line ${lastUser.line} still grants root.`);
  } else {
    report('root-user', 'pass', [lastUser.line], `Final stage runs as \`${lastUser.args}\`.`);
  }

  // 8. many processes
  const cmd = ins.filter(i => i.instr === 'CMD' || i.instr === 'ENTRYPOINT');
  const daemon = cmd.find(i => DAEMON_CHAIN.test(i.args));
  if (daemon) {
    report('many-processes', 'fail', [daemon.line],
      `\`${daemon.instr}\` at line ${daemon.line} chains daemons/background jobs — Docker only tracks PID 1.`);
  } else if (cmd.length) {
    report('many-processes', 'pass', [cmd[cmd.length - 1].line], 'Single foreground process in the entrypoint.');
  } else {
    report('many-processes', 'warn', [], 'No CMD/ENTRYPOINT — whatever runs it must still be a single foreground process.');
  }

  // 9. healthcheck
  const health = ins.find(i => i.instr === 'HEALTHCHECK');
  if (health) {
    report('healthcheck', 'pass', [health.line], 'HEALTHCHECK defined — ensure the platform restarts on failure.');
  } else {
    report('healthcheck', 'warn', [], 'No HEALTHCHECK — acceptable only if an orchestrator defines liveness/readiness probes.');
  }

  // 10. resource limits — runtime concern, not in Dockerfile
  if (opts.hasLimits === undefined) {
    report('resource-limits', 'info', [], 'Not in the Dockerfile — confirm --memory/--cpus or compose mem_limit/cpus at deploy time.');
  } else {
    report('resource-limits', opts.hasLimits ? 'pass' : 'fail', [],
      opts.hasLimits ? 'Runtime ceilings declared.' : 'No memory/CPU limits — one leak can take the whole host.');
  }

  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  findings.sort((a, b) => a.num - b.num);
  const score = {
    fail: findings.filter(f => f.status === 'fail').length,
    warn: findings.filter(f => f.status === 'warn').length,
    info: findings.filter(f => f.status === 'info').length,
    pass: findings.filter(f => f.status === 'pass').length,
  };
  return { findings, score, worst: findings.reduce((w, f) => Math.min(w, order[f.status]), 3) };
}
