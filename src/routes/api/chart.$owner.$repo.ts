import { createFileRoute } from "@tanstack/react-router"
import { issueHistoryService } from "@/lib/issue-history-service"

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

export const Route = createFileRoute("/api/chart/$owner/$repo")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { owner, repo } = params

        if (!owner || !repo) {
          return new Response(createErrorSvg("Missing owner or repo parameter"), {
            status: 400,
            headers: {
              "Content-Type": "image/svg+xml",
            },
          })
        }

        try {
          const svg = await issueHistoryService.getIssueHistorySVG(owner, repo)

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
