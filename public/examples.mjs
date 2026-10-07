// Example fixtures — kept in sync with examples/ on disk (asserted by tests).

export const VULNERABLE_DOCKERFILE = `FROM node:latest
WORKDIR /app
COPY . .
COPY .env .env
RUN apt-get update && apt-get install -y gcc make
RUN npm install
RUN rm .env
ENV DB_PASSWORD=prod-secret-123
CMD cron & node src/index.js
`;

export const FIXED_DOCKERFILE = `# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
USER node
HEALTHCHECK --interval=30s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/index.js"]
`;

export const FIXED_DOCKERIGNORE = `.git
.env*
node_modules
coverage
*.log
Dockerfile
docker-compose*.yaml
deploy-secrets.yaml
`;

// Mock repository used by the context lab — a plausible Node service checkout.
export const REPO_FILES = [
  '.git/HEAD', '.git/config', '.git/hooks/pre-commit.sample', '.gitignore',
  '.env', '.env.local',
  'node_modules/express/index.js', 'node_modules/.package-lock.json',
  'Dockerfile', 'docker-compose.yaml', 'deploy-secrets.yaml',
  'package.json', 'package-lock.json', 'npm-debug.log',
  'src/index.js', 'src/routes.js', 'src/db.js',
  'test/app.test.js', 'coverage/lcov.info', 'README.md',
];

export const PRESETS = [
  {
    id: 'vulnerable',
    title: 'Vulnerable example (8 fails · 2 warnings)',
    dockerfile: VULNERABLE_DOCKERFILE,
    dockerignore: '',
    hasDockerignore: false,
    hasLimits: false,
    note: 'Everything that passes on localhost — and fails in production.',
  },
  {
    id: 'fixed',
    title: 'Hardened example',
    dockerfile: FIXED_DOCKERFILE,
    dockerignore: FIXED_DOCKERIGNORE,
    hasDockerignore: true,
    hasLimits: true,
    note: 'Same app: pinned, multi-stage, non-root, health-checked — with limits set at deploy time.',
  },
];
