# Repository Guide for Agents

## What this app is
This repository powers github-history.com, a small web app that generates issue-history charts for one or more GitHub repositories. Users enter owner/repo pairs, the server fetches issue counts over time via the GitHub GraphQL API, caches snapshots in Postgres, and renders an SVG chart that can be embedded elsewhere.

## What it does
- Builds an issue-history timeline (open and closed counts) per repo.
- Supports comparing up to 5 repositories in one chart.
- Returns SVG charts from API routes and renders them in the UI.
- Caches historical snapshots in Postgres to avoid refetching.

## Stack
- Runtime: Bun
- Frontend: React 19 + TanStack Start + TanStack Router (file-based)
- Styling: Tailwind CSS + shadcn/ui primitives
- Server/API: TanStack Start server handlers
- Data: GitHub GraphQL API
- Database: Postgres with Drizzle ORM (migrations in `drizzle/`)
- Build: Vite + Nitro

## Key paths
- UI entry: `src/routes/index.tsx`
- API routes: `src/routes/api/*`
- Chart generation: `src/lib/svg-chart.ts`
- Issue history orchestration: `src/lib/issue-history-service.ts`
- GitHub GraphQL client: `src/lib/github-graphql.ts`
- Cache layer: `src/lib/cache.ts`
- DB schema: `src/db/schema.ts`
- Routing: `src/routes/*` (file-based)

## How to run it
- Install deps: `bun install`
- Dev server: `bun --bun run dev` (Vite on port 3000)
- Tests: `bun --bun run test`
- Build: `bun --bun run build`

## Database and migrations
- Generate migrations: `bun --bun run db:generate`
- Apply migrations: `bun --bun run db:migrate`
- Studio: `bun --bun run db:studio`

## Environment
See `.env.example` for required values. At minimum you need:
- `GITHUB_TOKEN` (GitHub GraphQL API access)
- `DATABASE_URL` (Postgres connection string)

Chart resolution and sampling are tuned with:
`BINARY_SEARCH_THRESHOLD`, `BINARY_SEARCH_MAX_INTERVAL`, `BINARY_SEARCH_MIN_INTERVAL`, `CHART_TARGET_POINTS`.

## How to code in it
- Add UI routes under `src/routes/` (TanStack Start file routing).
- Add API endpoints under `src/routes/api/` using server handlers.
- Prefer adding data access and GitHub calls in `src/lib/` and keep routes thin.
- Use `IssueHistoryService` for fetching, caching, and chart generation.
- Use Tailwind utility classes and existing shadcn/ui components in `src/components/ui/`.

## What to use
- Need GitHub data: `src/lib/github-graphql.ts`
- Need cached snapshots: `src/lib/cache.ts`
- Need chart SVGs: `src/lib/svg-chart.ts` via `IssueHistoryService`
- Need new DB fields: update `src/db/schema.ts` and run drizzle migrations
