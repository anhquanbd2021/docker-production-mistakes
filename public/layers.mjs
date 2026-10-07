// Layer simulator — proves `RUN rm` never erases an earlier layer.
// A "layer" records what it adds; the container sees the merged result,
// while anyone pulling the image can still open each layer individually.

import { parseDockerfile } from './rules.mjs';

function copyArgs(args) {
  const parts = args.split(/\s+/).filter(p => !p.startsWith('--'));
  return { srcs: parts.slice(0, -1), dest: parts[parts.length - 1] || '' };
}

// contextFiles: optional list used to expand `COPY . .` into real names
export function simulateLayers(dockerfileText, contextFiles = []) {
  const instructions = parseDockerfile(dockerfileText);
  const layers = [];
  for (const i of instructions) {
    const layer = { line: i.line, instr: i.instr, summary: i.args.split('\n')[0].slice(0, 60), adds: [], removes: [] };
    if (i.instr === 'COPY' || i.instr === 'ADD') {
      const { srcs } = copyArgs(i.args);
      for (const src of srcs) {
        if (src === '.' || src === './') {
          layer.adds.push(...(contextFiles.length ? contextFiles : ['<entire build context>']));
        } else {
          layer.adds.push(src.replace(/^\.\//, ''));
        }
      }
    }
    if (i.instr === 'RUN') {
      for (const m of i.args.matchAll(/\brm\s+(?:-[a-zA-Z]+\s+)*([^\s;&|]+)/g)) {
        layer.removes.push(m[1].replace(/^\.\//, '').replace(/^\/+/, '').split('/').pop());
      }
    }
    if (i.instr === 'FROM' && layers.length) {
      // new stage — keep going; stages share the diagram but are marked
      layer.stageStart = true;
    }
    layers.push(layer);
  }
  return layers;
}

// What the running container sees: every add minus every later remove.
export function containerView(layers) {
  const present = new Set();
  for (const layer of layers) {
    for (const f of layer.adds) present.add(f.split('/').pop());
    for (const f of layer.removes) present.delete(f.split('/').pop());
  }
  return [...present].sort();
}

// What `docker history` / an image pull can recover: files that were added
// in one layer and "removed" in a later one still exist in the adding layer.
export function recoverableFiles(layers) {
  const addsAt = new Map(); // basename -> layer index
  const removed = [];
  layers.forEach((layer, idx) => {
    for (const f of layer.removes) {
      const base = f.split('/').pop();
      if (addsAt.has(base)) removed.push({ file: base, addedLayer: addsAt.get(base), removedLayer: idx });
    }
    for (const f of layer.adds) addsAt.set(f.split('/').pop(), idx);
  });
  return removed;
}
