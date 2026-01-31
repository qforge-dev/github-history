import { createFileRoute } from "@tanstack/react-router"
import { issueHistoryService } from "@/lib/issue-history-service"
import { parseRepoPath } from "@/lib/repo-parser"
import { parseMetricsParam } from "@/lib/metrics"

function createErrorSvg(message: string): string {
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="400" viewBox="0 0 900 400">
  <rect width="900" height="400" fill="#ffffff" rx="8" ry="8" stroke="#e5e7eb" stroke-width="1"/>
  <text x="450" y="190" text-anchor="middle" fill="#dc2626" font-size="16" font-weight="600" font-family="system-ui, sans-serif">Error</text>
  <text x="450" y="220" text-anchor="middle" fill="#374151" font-size="14" font-family="system-ui, sans-serif">${escapedMessage}</text>
 </svg>`
}

function extractReposParam(url: URL): string | null {
  const allRepos = url.searchParams.getAll("repos")
  if (allRepos.length > 1) {
    return allRepos.join("&")
  }

  const direct = url.searchParams.get("repos")
  if (direct && direct.includes("&")) {
    return direct
  }

  const rawQuery = url.search.replace(/^\?/, "")
  if (!rawQuery) {
    return direct
  }

  const parts = rawQuery.split("&")
  const reposSegments: string[] = []
  let collecting = false

  for (const part of parts) {
    if (part.startsWith("repos=")) {
      collecting = true
      reposSegments.push(part.slice("repos=".length))
      continue
    }

    if (!collecting) {
      continue
    }

    if (
      part.startsWith("logScale=") ||
      part.startsWith("alignTimelines=") ||
      part.startsWith("metrics=") ||
      part.startsWith("showClosed=")
    ) {
      break
    }

    if (part.includes("=")) {
      break
    }

    reposSegments.push(part)
  }

  return reposSegments.length > 0 ? reposSegments.join("&") : direct
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

function parseMonthParam(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(0, parsed)
}

export const Route = createFileRoute("/api/svg")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const reposParam = extractReposParam(url)
        const logScale = url.searchParams.get("logScale") === "true"
        const alignTimelines = url.searchParams.get("alignTimelines") === "true"
        const metrics = parseMetricsParam(url.searchParams)
        const startDate = parseDateParam(url.searchParams.get("startDate"))
        const endDate = parseDateParam(url.searchParams.get("endDate"))
        const monthStart = parseMonthParam(url.searchParams.get("monthStart"))
        const monthEnd = parseMonthParam(url.searchParams.get("monthEnd"))

        if (!reposParam) {
          return new Response(createErrorSvg("Missing repos query parameter"), {
            status: 400,
            headers: {
              "Content-Type": "image/svg+xml",
            },
          })
        }

        const decoded = decodeURIComponent(reposParam)
        const { repos, error } = parseRepoPath(decoded, 5)

        if (error) {
          return new Response(createErrorSvg(error), {
            status: 400,
            headers: {
              "Content-Type": "image/svg+xml",
            },
          })
        }

        try {
          const svg = await issueHistoryService.getMultiRepoIssueHistorySVG(repos, {
            logScale,
            alignTimelines,
            metrics,
            startDate,
            endDate,
            monthStart,
            monthEnd,
          })

          return new Response(svg, {
            status: 200,
            headers: {
              "Content-Type": "image/svg+xml",
            },
          })
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred"

          return new Response(createErrorSvg(errorMessage), {
            status: 500,
            headers: {
              "Content-Type": "image/svg+xml",
            },
          })
        }
      },
    },
  },
})
