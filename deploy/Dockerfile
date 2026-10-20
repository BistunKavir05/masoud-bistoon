# ساخت تصویر بیستون (API + رابط کاربری ساخته‌شده در یک تصویر).
# زمینه‌ی ساخت: ریشه‌ی مخزن →  docker build -f deploy/Dockerfile -t bistoon .
# (docker-compose این کار را خودش انجام می‌دهد.)

# ───────── مرحله‌ی ساخت: نصب همه‌ی وابستگی‌ها و ساخت بسته‌ی رابط کاربری ─────────
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build -w @bistoon/web

# ───────── مرحله‌ی اجرا: فقط وابستگی‌های تولید + کد API + رابط ساخته‌شده ─────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WEB_DIST=/app/apps/web/dist \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY packages/core packages/core
COPY apps/api apps/api
COPY db db
COPY --from=build /src/apps/web/dist apps/web/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# migrationهای پایگاه‌داده هنگام بالاآمدن سرور خودکار اجرا می‌شود.
CMD ["node", "apps/api/src/server.ts"]
