import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { parseRepoPath } from "@/lib/repo-parser"

export const Route = createFileRoute("/$")({ component: RepoComparisonPage })

interface TooltipState {
  visible: boolean
  x: number
  y: number
  date: string
  count: string
  repo: string
}

export function RepoComparisonPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const chartContainerRef = useRef<HTMLDivElement>(null)

  const rawPath = useMemo(() => {
    const cleaned = location.pathname.replace(/^\/+/, "")
    return decodeURIComponent(cleaned)
  }, [location.pathname])

  const { repos, error, normalizedPath } = useMemo(
    () => parseRepoPath(rawPath, 5),
    [rawPath]
  )

  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    date: "",
    count: "",
    repo: "",
  })

  const repoKey = useMemo(() => repos.map((repo) => repo.fullName).join("&"), [repos])

  useEffect(() => {
    if (normalizedPath && normalizedPath !== rawPath) {
      navigate({ to: `/${normalizedPath}`, replace: true })
    }
  }, [navigate, normalizedPath, rawPath])

  useEffect(() => {
    async function fetchChart() {
      if (error) {
        setErrorMessage(error)
        setSvgContent(null)
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setErrorMessage(null)
      setSvgContent(null)

      try {
        const response = await fetch(`/api/chart?repos=${encodeURIComponent(repoKey)}`)
        const text = await response.text()

        if (!response.ok) {
          setErrorMessage("Failed to load comparison chart")
          setSvgContent(text)
        } else {
          setSvgContent(text)
        }
      } catch (fetchError) {
        const message =
          fetchError instanceof Error ? fetchError.message : "Failed to fetch chart"
        setErrorMessage(message)
      } finally {
        setIsLoading(false)
      }
    }

    if (repoKey) {
      fetchChart()
    }
  }, [error, repoKey])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container || !svgContent) return

    function handleMouseOver(event: MouseEvent) {
      const target = event.target as Element
      if (target.classList.contains("data-point")) {
        const date = target.getAttribute("data-date") || ""
        const count = target.getAttribute("data-count") || ""
        const repo = target.getAttribute("data-repo") || ""
        setTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          date,
          count,
          repo,
        })
      }
    }

    function handleMouseMove(event: MouseEvent) {
      const target = event.target as Element
      if (target.classList.contains("data-point")) {
        setTooltip((prev) => ({
          ...prev,
          x: event.clientX,
          y: event.clientY,
        }))
      }
    }

    function handleMouseOut(event: MouseEvent) {
      const target = event.target as Element
      if (target.classList.contains("data-point")) {
        setTooltip((prev) => ({ ...prev, visible: false }))
      }
    }

    container.addEventListener("mouseover", handleMouseOver)
    container.addEventListener("mousemove", handleMouseMove)
    container.addEventListener("mouseout", handleMouseOut)

    return () => {
      container.removeEventListener("mouseover", handleMouseOver)
      container.removeEventListener("mousemove", handleMouseMove)
      container.removeEventListener("mouseout", handleMouseOut)
    }
  }, [svgContent])

  const title =
    repos.length > 1
      ? "Issue History Comparison"
      : repos[0]?.fullName ?? "Issue History"

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Link to="/">
            <Button variant="ghost" className="text-gray-400 hover:text-white">
              Back to Home
            </Button>
          </Link>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
          <p className="text-gray-400">Open Issues Over Time</p>
        </div>

        {repos.length > 1 && (
          <div className="flex flex-wrap justify-center gap-3 mb-6">
            {repos.map((repo) => (
              <a
                key={repo.fullName}
                href={`https://github.com/${repo.fullName}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1 rounded-full text-sm bg-slate-700 text-gray-200 hover:bg-slate-600 transition-colors"
              >
                {repo.fullName}
              </a>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex justify-center items-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
              <p className="text-gray-400">Loading chart data...</p>
            </div>
          </div>
        )}

        {errorMessage && !isLoading && (
          <div className="text-center py-8">
            <p className="text-red-400 mb-4">{errorMessage}</p>
          </div>
        )}

        {svgContent && !isLoading && (
          <div
            ref={chartContainerRef}
            className="bg-white rounded-lg shadow-lg overflow-hidden"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}

        {tooltip.visible && (
          <div
            className="fixed pointer-events-none z-50 bg-slate-800 text-white px-3 py-2 rounded shadow-lg text-sm"
            style={{
              left: tooltip.x + 15,
              top: tooltip.y - 10,
            }}
          >
            <div className="font-medium">{tooltip.repo}</div>
            <div className="text-gray-300">{tooltip.date}</div>
            <div className="text-cyan-400">{tooltip.count} open issues</div>
          </div>
        )}
      </div>
    </div>
  )
}
