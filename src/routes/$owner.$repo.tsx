import { createFileRoute, Link } from "@tanstack/react-router"
import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/$owner/$repo")({ component: RepoChartPage })

interface TooltipState {
  visible: boolean
  x: number
  y: number
  date: string
  count: string
}

function RepoChartPage() {
  const { owner, repo } = Route.useParams()
  const [svgContent, setSvgContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    date: "",
    count: "",
  })
  const chartContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function fetchChart() {
      setIsLoading(true)
      setErrorMessage(null)
      setSvgContent(null)

      try {
        const response = await fetch(`/api/chart/${owner}/${repo}`)
        const text = await response.text()

        if (!response.ok) {
          setErrorMessage(`Failed to load chart for ${owner}/${repo}`)
          setSvgContent(text)
        } else {
          setSvgContent(text)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch chart"
        setErrorMessage(message)
      } finally {
        setIsLoading(false)
      }
    }

    fetchChart()
  }, [owner, repo])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container || !svgContent) return

    function handleMouseOver(event: MouseEvent) {
      const target = event.target as Element
      if (target.classList.contains("data-point")) {
        const date = target.getAttribute("data-date") || ""
        const count = target.getAttribute("data-count") || ""
        setTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          date,
          count,
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link to="/">
            <Button variant="ghost" className="text-gray-400 hover:text-white">
              Back to Home
            </Button>
          </Link>
        </div>

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-cyan-400 transition-colors"
            >
              {owner}/{repo}
            </a>
          </h1>
          <p className="text-gray-400">Open Issues Over Time</p>
        </div>

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
            <div className="font-medium">{tooltip.date}</div>
            <div className="text-cyan-400">{tooltip.count} open issues</div>
          </div>
        )}
      </div>
    </div>
  )
}
