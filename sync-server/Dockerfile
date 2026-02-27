FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN set -eux; \
  npm config set registry https://registry.npmjs.org/; \
  npm config set fetch-retries 6; \
  npm config set fetch-retry-factor 2; \
  npm config set fetch-retry-mintimeout 10000; \
  npm config set fetch-retry-maxtimeout 120000; \
  npm config set prefer-offline true; \
  attempt=1; \
  until npm ci --no-audit --no-fund; do \
    if [ "$attempt" -ge 4 ]; then \
      exit 1; \
    fi; \
    sleep "$((attempt * 5))"; \
    attempt="$((attempt + 1))"; \
  done

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 8787
CMD ["node", "dist/index.js"]
