# paper-runner — Node 20 + pnpm + tsx; runs apps/paper-runner/src/main.ts
# Build context = repo root. Build with:
#   docker buildx build --platform linux/amd64 -f apps/paper-runner/Dockerfile -t paper-runner:smoke .

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/usr/local/share/pnpm \
    PATH=$PNPM_HOME:$PATH \
    NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json /app/
COPY tsconfig.base.json /app/
COPY packages /app/packages
COPY apps /app/apps
RUN pnpm install --filter @forex-bot/paper-runner... --frozen-lockfile

FROM base AS final
WORKDIR /app
COPY --from=deps /app /app
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1
ENTRYPOINT ["pnpm", "exec", "tsx", "apps/paper-runner/src/main.ts"]
