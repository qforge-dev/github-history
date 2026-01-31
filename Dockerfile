FROM oven/bun:1.2.2 AS build

WORKDIR /app

COPY bun.lock package.json ./

RUN bun install --frozen-lockfile
COPY . .

RUN bun --bun run build

FROM oven/bun:1.2.2 AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV MIGRATE_ON_START=true

COPY --from=build /app/.output ./.output
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src/db ./src/db
COPY docker/entrypoint.sh ./entrypoint.sh

RUN chmod +x ./entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
