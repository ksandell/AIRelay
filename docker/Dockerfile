FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Dev image: includes devDependencies (dotenv, vitest, etc.) for `node --watch`.
FROM node:22-alpine AS dev
WORKDIR /app
ENV NODE_ENV=development
ENV TZ=UTC
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/
RUN mkdir -p /data/logs
EXPOSE 3000
CMD ["node", "--watch", "src/index.js"]

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=UTC
ENV NODE_OPTIONS="--max-http-header-size=32768"
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config/
COPY package.json ./
RUN mkdir -p /data/logs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "src/index.js"]
