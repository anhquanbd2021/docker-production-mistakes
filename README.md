# Dockerfile Doctor — companion demo

Interactive lab for the article *10 Docker Mistakes That Only Bite You in
Production*. Score any Dockerfile against the ten checks, then open two
simulators that show *why* the invisible parts fail: a layer stack that keeps
"deleted" secrets, and a build context that sweeps them in.

Zero dependencies — Node 20+ only. The rule engine, layer simulator, and
.dockerignore matcher are plain ES modules shared by the browser UI, the CLI,
and the test suite.

## Three labs

| Lab | What it proves |
|---|---|
| **Scanner** | Paste a Dockerfile → 10 verdicts (fail / warn / info / pass) with the offending lines and the fix for each. Checks 1 and 10 live outside the Dockerfile, so toggles supply that evidence. |
| **Layer lab** | Replays `COPY`/`RUN rm` into a layer stack: the running container sees a clean filesystem, while `docker history` / an image pull still recovers the secret from its adding layer. |
| **Context lab** | A `.dockerignore` matcher (globs, `**`, `!` negation, directory prefixes) splits a realistic repo checkout into swept vs. excluded — edit the file and watch `.env` and `.git/` drop out. |

## Run it

```text
npm start       # serve the lab on :3000
npm test        # rules + layer sim + context matcher + server
npm run scan    # side-by-side report on examples/
npm run check   # both
```

## Examples

- `examples/vulnerable/` — builds and runs fine locally; scores 8 fails and 2
  warnings. `.env` is an obviously fake fixture.
- `examples/fixed/` — the same app hardened: pinned `node:22-alpine`,
  multi-stage, `USER node`, `HEALTHCHECK`, `.dockerignore`, limits declared at
  deploy time.

## Honest limits

- Static rules catch patterns, not intentions — a clean scan is not a
  guarantee, only a checklist pass.
- Checks 1 (`.dockerignore`) and 10 (resource limits) cannot be inferred from
  Dockerfile text; the lab asks for that evidence explicitly.
- The `.dockerignore` matcher covers the common syntax, not every edge of
  moby/patternmatcher.
- The layer simulator models file add/remove — not squashing, registry
  compression, or BuildKit internals.

This is an educational demo, not production infrastructure.
