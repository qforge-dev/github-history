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
  series: string
}

export function RepoComparisonPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const copyTimeoutRef = useRef<number | null>(null)

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
  const [logScale, setLogScale] = useState(false)
  const [alignTimelines, setAlignTimelines] = useState(false)
  const [showClosed, setShowClosed] = useState(false)
  const [copiedAction, setCopiedAction] = useState<"svg" | "embed" | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    date: "",
    count: "",
    repo: "",
    series: "",
  })

  const repoKey = useMemo(() => repos.map((repo) => repo.fullName).join("&"), [repos])
  const chartPath = normalizedPath ?? rawPath
  const chartUrl = useMemo(() => {
    if (!chartPath) {
      return "https://github-history.com/"
    }

    const safePath = encodeURI(chartPath)
    return `https://github-history.com/${safePath}`
  }, [chartPath])
  const svgUrl = useMemo(() => {
    if (!repoKey) {
      return "https://github-history.com/api/svg"
    }

    const params = new URLSearchParams({ repos: repoKey })
    if (logScale) {
      params.set("logScale", "true")
    }
    if (alignTimelines && repos.length > 1) {
      params.set("alignTimelines", "true")
    }
    if (showClosed) {
      params.set("showClosed", "true")
    }

    return `https://github-history.com/api/svg?${params.toString()}`
  }, [alignTimelines, logScale, repoKey, repos.length, showClosed])
  const embedSnippet = useMemo(() => {
    return `## Issue History\n\n[![Issue History Chart](${svgUrl})](${chartUrl})`
  }, [chartUrl, svgUrl])

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (normalizedPath && normalizedPath !== rawPath) {
      navigate({ to: `/${normalizedPath}`, replace: true })
    }
  }, [navigate, normalizedPath, rawPath])

  useEffect(() => {
    if (repos.length < 2 && alignTimelines) {
      setAlignTimelines(false)
    }
  }, [alignTimelines, repos.length])

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
        const params = new URLSearchParams({ repos: repoKey })
        if (logScale) {
          params.set("logScale", "true")
        }
        if (alignTimelines && repos.length > 1) {
          params.set("alignTimelines", "true")
        }
        if (showClosed) {
          params.set("showClosed", "true")
        }

        const response = await fetch(`/api/chart?${params.toString()}`)
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
  }, [alignTimelines, error, logScale, repoKey, repos.length, showClosed])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container || !svgContent) return

    function handleMouseOver(event: MouseEvent) {
      const target = event.target as Element
      if (target.classList.contains("data-point")) {
        const date = target.getAttribute("data-date") || ""
        const count = target.getAttribute("data-count") || ""
        const repo = target.getAttribute("data-repo") || ""
        const series = target.getAttribute("data-series") || ""
        setTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          date,
          count,
          repo,
          series,
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

  function resetCopyState() {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current)
    }

    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedAction(null)
    }, 1500)
  }

  async function handleCopySvgUrl() {
    try {
      await navigator.clipboard.writeText(svgUrl)
      setCopiedAction("svg")
      resetCopyState()
    } catch {
      setCopiedAction(null)
    }
  }

  async function handleCopyEmbedSnippet() {
    try {
      await navigator.clipboard.writeText(embedSnippet)
      setCopiedAction("embed")
      resetCopyState()
    } catch {
      setCopiedAction(null)
    }
  }

  function extractSvgSize(svg: string): { width: number; height: number } {
    const widthMatch = svg.match(/width="([\d.]+)"/)
    const heightMatch = svg.match(/height="([\d.]+)"/)
    if (widthMatch && heightMatch) {
      return {
        width: Number.parseFloat(widthMatch[1]),
        height: Number.parseFloat(heightMatch[1]),
      }
    }

    const viewBoxMatch = svg.match(/viewBox="([\d.\s]+)"/)
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].trim().split(/\s+/)
      if (parts.length === 4) {
        return {
          width: Number.parseFloat(parts[2]),
          height: Number.parseFloat(parts[3]),
        }
      }
    }

    return { width: 900, height: 600 }
  }

  async function handleDownloadPng() {
    if (!svgContent || isDownloading) {
      return
    }

    setIsDownloading(true)

    try {
      const { width, height } = extractSvgSize(svgContent)
      const svgBlob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" })
      const url = URL.createObjectURL(svgBlob)

      const image = new Image()
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext("2d")
      if (!ctx) {
        URL.revokeObjectURL(url)
        return
      }

      await new Promise<void>((resolve, reject) => {
        image.onload = () => {
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(image, 0, 0, width, height)
          resolve()
        }
        image.onerror = () => reject(new Error("Failed to load svg"))
        image.src = url
      })

      URL.revokeObjectURL(url)

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      )

      if (!pngBlob) {
        return
      }

      const downloadUrl = URL.createObjectURL(pngBlob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = "issue-history.png"
      link.click()
      URL.revokeObjectURL(downloadUrl)
    } finally {
      setIsDownloading(false)
    }
  }

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
          <p className="text-gray-400">Issues Over Time</p>
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

        <div className="flex flex-wrap justify-center gap-4 mb-6 text-gray-300">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={logScale}
              onChange={(event) => setLogScale(event.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
            Log Scale
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(event) => setShowClosed(event.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
            Show Closed
          </label>
          {repos.length > 1 && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={alignTimelines}
                onChange={(event) => setAlignTimelines(event.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
              Align Timelines
            </label>
          )}
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
          <div className="space-y-6">
            <div
              ref={chartContainerRef}
              className="bg-white rounded-lg shadow-lg overflow-hidden"
              dangerouslySetInnerHTML={{ __html: svgContent }}
            />
            <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Share & Embed</h2>
                  <p className="text-sm text-slate-400">
                    Copy a link, download a PNG, or embed the SVG.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopySvgUrl}
                    className="bg-slate-700 text-white hover:bg-slate-600"
                  >
                    {copiedAction === "svg" ? "Copied" : "Copy SVG"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownloadPng}
                    className="bg-slate-700 text-white hover:bg-slate-600"
                  >
                    {isDownloading ? "Preparing PNG" : "Download PNG"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCopyEmbedSnippet}
                    className="bg-slate-700 text-white hover:bg-slate-600"
                  >
                    {copiedAction === "embed" ? "Copied" : "Copy Embed Snippet"}
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">Embed snippet</div>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-200">
                  {embedSnippet}
                </pre>
              </div>
            </div>
          </div>
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
            {tooltip.series && (
              <div className="text-gray-300">{tooltip.series}</div>
            )}
            <div className="text-gray-300">{tooltip.date}</div>
            <div className="text-cyan-400">{tooltip.count} issues</div>
          </div>
        )}
      </div>
    </div>
  )
}
