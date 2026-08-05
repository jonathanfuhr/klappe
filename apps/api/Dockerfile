# syntax=docker/dockerfile:1
# Ein Image für beide Server-Rollen: `api` und `worker`. Der Unterschied ist
# nur das Kommando – so ist ausgeschlossen, dass Web-Dienst und Worker mit
# unterschiedlichem Code laufen.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @klappe/shared && npm run build -w @klappe/api

FROM node:22-bookworm-slim AS runtime
# ffmpeg/ffprobe sind die eigentliche Arbeitsgrundlage der Pipeline,
# tini sorgt dafür, dass Signale bei ffmpeg-Kindprozessen ankommen.
#
# Dazu `postgresql-client-16` für die Datenbanksicherung (Phase 23): pg_dump
# und pg_restore müssen **mindestens** so neu sein wie der Server, sonst
# verweigern sie den Dienst. Debian bookworm liefert von Haus aus nur Version
# 15, der Stack fährt aber postgres:16 – deshalb der Umweg über das
# PostgreSQL-eigene Paketverzeichnis.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates curl gnupg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
     | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
  && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl gnupg && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Welcher Stand hier steckt (1.5.1). Beides kommt von aussen, weil es im
# Container nicht zu ermitteln ist: Ein .git liegt hier nicht, und die
# Dateizeit sagt nur etwas ueber das Entpacken. Fehlen sie, zeigt die
# Oberflaeche nur die Version - besser als eine geratene Angabe.
ARG KLAPPE_COMMIT=""
ARG KLAPPE_BUILT_AT=""

ENV NODE_ENV=production \
    STORAGE_DIR=/data \
    PORT=3001 \
    KLAPPE_COMMIT=${KLAPPE_COMMIT} \
    KLAPPE_BUILT_AT=${KLAPPE_BUILT_AT}

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @klappe/api --workspace @klappe/shared --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/docker/entrypoint.sh /usr/local/bin/klappe-entrypoint
RUN chmod +x /usr/local/bin/klappe-entrypoint

# Das Volume erbt beim ersten Einhängen die Rechte dieses Verzeichnisses –
# deshalb muss es schon im Image dem unprivilegierten Benutzer gehören.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3001
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/klappe-entrypoint"]
CMD ["api"]
