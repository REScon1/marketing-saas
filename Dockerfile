# Jedna služba: API server + sestavený web + publikační worker v procesu.
FROM node:22-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @ms/web build
ENV NODE_ENV=production WORKER_IN_PROCESS=true TRUST_PROXY=true
EXPOSE 3001
# Migrace při každém startu; ukázková data jen pokud je povolí ALLOW_DEMO_SEED=1 (a jen jednou).
CMD ["sh", "-c", "pnpm --filter @ms/api migrate && (pnpm --filter @ms/api seed || echo 'seed přeskočen') && pnpm --filter @ms/api start"]
