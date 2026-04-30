# Build from repository root: docker build -f services/catalog-api/Dockerfile -t catalog-api .
# Debian slim: native better-sqlite3 prebuilds are reliable vs Alpine.
FROM node:22-bookworm-slim
WORKDIR /app

COPY src/domain/product.ts ./src/domain/product.ts
COPY data ./data
COPY services/catalog-api/package.json ./services/catalog-api/
COPY services/catalog-api/tsconfig.json ./services/catalog-api/
COPY services/catalog-api/src ./services/catalog-api/src

WORKDIR /app/services/catalog-api
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV PORT=4001
ENV HOST=0.0.0.0
ENV CATALOG_DB_PATH=../../data/catalog.sqlite
ENV CATALOG_SEED_PATH=../../data/catalog.generated.5000.json

EXPOSE 4001
VOLUME ["/app/data"]
CMD ["npx", "tsx", "src/server.ts"]
