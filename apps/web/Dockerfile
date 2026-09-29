# syntax=docker/dockerfile:1
# Web-Oberfläche (SvelteKit, adapter-node). Build-Kontext ist das Repository-Wurzelverzeichnis:
#   docker build -f apps/web/Dockerfile -t objektakte-web .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @objektakte/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @objektakte/web build \
 && pnpm --filter @objektakte/web deploy --prod --legacy /out \
 && cp -r apps/web/build /out/

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 BODY_SIZE_LIMIT=80M
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "build"]
