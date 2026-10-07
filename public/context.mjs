// Build-context simulator — a minimal .dockerignore matcher.
// Semantics mirrored from moby/patternmatcher: `*` `?` globs, `**` crosses
// directories, leading `/` anchors to context root, a plain name that matches
// a directory excludes its contents, `!` re-includes, last match wins.

function globToRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        // `**` — crosses directory boundaries
        if (pattern[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return re;
}

export function parseDockerignore(text) {
  const rules = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let negate = false;
    let pat = line;
    if (pat.startsWith('!')) { negate = true; pat = pat.slice(1).trim(); }
    pat = pat.replace(/^\.\//, '').replace(/^\//, '').replace(/\/+$/, '');
    if (!pat) continue;
    const hasGlob = /[*?]/.test(pat);
    // Plain names also match everything beneath them (directory semantics).
    const body = hasGlob ? globToRegex(pat) : `${pat.replace(/[.+^${}()|[\]\\]/g, '\\$&')}(?:/.*)?`;
    rules.push({ pattern: line, negate, re: new RegExp(`^${body}$`) });
  }
  return rules;
}

export function isIgnored(path, rules) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.re.test(path)) ignored = !rule.negate;
  }
  return ignored;
}

// Which files does `COPY . .` actually sweep into the build context?
export function sweepContext(files, dockerignoreText) {
  const rules = parseDockerignore(dockerignoreText);
  const swept = [];
  const ignored = [];
  for (const file of files) {
    (isIgnored(file, rules) ? ignored : swept).push(file);
  }
  return { swept, ignored, rules: rules.map(r => r.pattern) };
}
