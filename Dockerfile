# --- Build stage: compile React frontend ---
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage: minimal Node + SQLite ---
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache python3 make g++ && \
    addgroup -S ptx && adduser -S ptx -G ptx

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY --from=builder /app/dist ./dist
COPY server ./server
COPY scripts ./scripts

RUN mkdir -p /data && chown -R ptx:ptx /data /app
USER ptx

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/ptx.db
EXPOSE 8080

# Sonde de sante : 'docker ps' affiche (healthy), et le reverse proxy attend que l'app reponde avant de demarrer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/api/health" >/dev/null || exit 1

ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]
