FROM oven/bun:1.2 AS build

WORKDIR /app
COPY package.json bun.lock ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/api-contract/package.json packages/api-contract/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/app-access/package.json packages/app-access/package.json
COPY packages/auth-client/package.json packages/auth-client/package.json
COPY packages/design-system/package.json packages/design-system/package.json
RUN bun install --frozen-lockfile

COPY . .
RUN bun run check

FROM oven/bun:1.2 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4335
COPY --from=build /app /app
EXPOSE 4335
CMD ["bun", "run", "start"]
