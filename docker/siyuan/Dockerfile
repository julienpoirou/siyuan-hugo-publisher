FROM node:20-alpine AS builder

WORKDIR /build

COPY package.json tsconfig.json ./
RUN npm install

COPY src/ ./src/
COPY plugin.json ./
COPY i18n/ ./i18n/

RUN npx esbuild src/index.ts \
      --bundle \
      --outfile=dist/index.js \
      --format=cjs \
      --platform=node \
      --target=es2020 \
      --minify \
      --external:siyuan \
      --external:electron \
      --external:fs \
      --external:path \
      --external:crypto \
      --external:os \
    && cp plugin.json dist/ \
    && cp src/README.md dist/README.md \
    && cp src/logo.png dist/icon.png \
    && cp src/preview.png dist/preview.png \
    && cp -r i18n dist/

FROM b3log/siyuan:latest

COPY --from=builder /build/dist/ /opt/plugin-dist/
COPY docker/siyuan/entrypoint.sh /entrypoint.sh
RUN apk add --no-cache jq \
    && chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
