import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  normalizeRepoInputToPath,
  parseRepoPath,
  type RepoIdentifier,
} from "@/lib/repo-parser"

export const Route = createFileRoute("/")({ component: RepoHistoryPage })

const MAX_REPOS = 5
const EXAMPLES = [
  "facebook/react",
  "microsoft/vscode",
  "vercel/next.js",
  "anomalyco/opencode&openclaw/openclaw",
]

interface TooltipState {
  visible: boolean
  x: number
  y: number
  date: string
  count: string
  repo: string
  series: string
}

function parseRepoInput(input: string): {
  repos: RepoIdentifier[]
  error?: string
  normalizedPath?: string
} | null {
  const path = normalizeRepoInputToPath(input)

  if (!path) {
    return null
  }

  return parseRepoPath(path, MAX_REPOS)
}

function buildPath(repos: RepoIdentifier[]): string {
  return repos.map((repo) => repo.fullName).join("&")
}

function areReposEqual(a: RepoIdentifier[], b: RepoIdentifier[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].fullName.toLowerCase() !== b[i].fullName.toLowerCase()) {
      return false
    }
  }
  return true
}

function mergeRepos(
  existing: RepoIdentifier[],
  incoming: RepoIdentifier[]
): RepoIdentifier[] {
  const merged: RepoIdentifier[] = []
  const seen = new Set<string>()

  for (const repo of existing) {
    const key = repo.fullName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(repo)
  }

  for (const repo of incoming) {
    const key = repo.fullName.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(repo)
  }

  return merged
}

export function RepoHistoryPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const copyTimeoutRef = useRef<number | null>(null)

  const rawPath = useMemo(() => {
    const cleaned = location.pathname.replace(/^\/+/, "")
    return decodeURIComponent(cleaned)
  }, [location.pathname])

  const parsedPath = useMemo(() => {
    if (!rawPath) {
      return { repos: [] as RepoIdentifier[] }
    }

    return parseRepoPath(rawPath, MAX_REPOS)
  }, [rawPath])

  const [repos, setRepos] = useState<RepoIdentifier[]>(parsedPath.repos ?? [])
  const [repoInput, setRepoInput] = useState("")
  const [inputError, setInputError] = useState<string | null>(null)
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

  const repoKey = useMemo(() => buildPath(repos), [repos])
  const chartPath = repoKey || parsedPath.normalizedPath || ""
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
    if (parsedPath.normalizedPath && parsedPath.normalizedPath !== rawPath) {
      navigate({ to: `/${parsedPath.normalizedPath}`, replace: true })
    }
  }, [navigate, parsedPath.normalizedPath, rawPath])

  useEffect(() => {
    if (!parsedPath.repos) {
      return
    }

    setRepos((prev) => (areReposEqual(prev, parsedPath.repos) ? prev : parsedPath.repos))
  }, [parsedPath.repos])

  useEffect(() => {
    const nextPath = buildPath(repos)
    if (nextPath === (parsedPath.normalizedPath ?? rawPath)) {
      return
    }

    navigate({ to: nextPath ? `/${nextPath}` : "/", replace: true })
  }, [navigate, parsedPath.normalizedPath, rawPath, repos])

  useEffect(() => {
    if (repos.length < 2 && alignTimelines) {
      setAlignTimelines(false)
    }
  }, [alignTimelines, repos.length])

  useEffect(() => {
    async function fetchChart() {
      if (parsedPath.error) {
        setErrorMessage(parsedPath.error)
        setSvgContent(null)
        setIsLoading(false)
        return
      }

      if (!repoKey) {
        setSvgContent(null)
        setIsLoading(false)
        setErrorMessage(null)
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

    fetchChart()
  }, [alignTimelines, logScale, parsedPath.error, repoKey, repos.length, showClosed])

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

    function handleMouseLeave() {
      setTooltip((prev) => ({ ...prev, visible: false }))
    }

    container.addEventListener("mouseover", handleMouseOver)
    container.addEventListener("mousemove", handleMouseMove)
    container.addEventListener("mouseout", handleMouseOut)
    container.addEventListener("mouseleave", handleMouseLeave)

    return () => {
      container.removeEventListener("mouseover", handleMouseOver)
      container.removeEventListener("mousemove", handleMouseMove)
      container.removeEventListener("mouseout", handleMouseOut)
      container.removeEventListener("mouseleave", handleMouseLeave)
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

  function handleAddRepos(event: React.FormEvent) {
    event.preventDefault()
    setInputError(null)

    const parsed = parseRepoInput(repoInput)

    if (!parsed) {
      setInputError("Enter a GitHub repository to add.")
      return
    }

    if (parsed.error) {
      setInputError(parsed.error)
      return
    }

    const merged = mergeRepos(repos, parsed.repos)

    if (merged.length > MAX_REPOS) {
      setInputError(`Please compare ${MAX_REPOS} repositories or fewer.`)
      return
    }

    setRepos(merged)
    setRepoInput("")
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRepoInput(event.target.value)
    if (inputError) {
      setInputError(null)
    }
  }

  function handleRemoveRepo(target: RepoIdentifier) {
    setRepos((current) =>
      current.filter((repo) => repo.fullName.toLowerCase() !== target.fullName.toLowerCase())
    )
  }

  function handleAddExample(example: string) {
    const parsed = parseRepoInput(example)
    if (!parsed || parsed.error) {
      return
    }

    const merged = mergeRepos(repos, parsed.repos)
    if (merged.length > MAX_REPOS) {
      setInputError(`Please compare ${MAX_REPOS} repositories or fewer.`)
      return
    }

    setInputError(null)
    setRepos(merged)
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-3 py-4 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center gap-3 text-left">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-black">
            <span className="text-lg">📈</span>
            <span className="lowercase">github-history.com</span>
          </div>
          <h1 className="text-lg font-semibold text-black sm:text-xl">
            Track repository data over time
          </h1>
        </header>

        <section className="space-y-4">
          <form onSubmit={handleAddRepos} className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                type="text"
                value={repoInput}
                onChange={handleInputChange}
                placeholder="facebook/react or https://github.com/owner/repo"
                className="!h-9 flex-1 border-black bg-white !px-4 !py-2 text-sm text-black placeholder:text-black placeholder:opacity-50"
              />
              <Button
                type="submit"
                variant="outline"
                className="!h-9 border-black !px-4 !py-2 text-sm text-black hover:bg-black hover:text-white"
              >
                View Issue History
              </Button>
            </div>

            {inputError && <p className="text-sm text-red-500">{inputError}</p>}
          </form>

          {repos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {repos.map((repo) => (
                <div
                  key={repo.fullName}
                  className="flex h-9 items-center gap-2 rounded-full border border-black bg-white px-4 py-2 text-sm text-black"
                >
                  <span>{repo.fullName}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRepo(repo)}
                    className="text-black transition-colors hover:text-red-500"
                    aria-label={`Remove ${repo.fullName}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {repos.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleAddExample(example)}
                  className="flex h-9 items-center rounded-full border border-black bg-white px-4 py-2 text-sm text-black transition-colors hover:bg-black hover:text-white"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
        </section>

        {isLoading && repoKey && (
          <div className="flex items-center justify-center py-6">
            <div className="text-center">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-b-2 border-green-500"></div>
              <p className="text-sm text-black">Loading chart data...</p>
            </div>
          </div>
        )}

        {errorMessage && !isLoading && (
          <div className="text-sm text-red-600">{errorMessage}</div>
        )}

        {svgContent && !isLoading && (
          <div className="space-y-6">
            <div className="relative z-10 flex flex-wrap justify-end gap-4 text-sm text-black sm:-mb-8">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={logScale}
                  onChange={(event) => setLogScale(event.target.checked)}
                  className="h-4 w-4 accent-black"
                />
                Log Scale
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showClosed}
                  onChange={(event) => setShowClosed(event.target.checked)}
                  className="h-4 w-4 accent-black"
                />
                Show Closed
              </label>
              {repos.length > 1 && (
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={alignTimelines}
                    onChange={(event) => setAlignTimelines(event.target.checked)}
                    className="h-4 w-4 accent-black"
                  />
                  Align Timelines
                </label>
              )}
            </div>
            <div className="w-full">
              <div
                ref={chartContainerRef}
                className="w-full [&_svg]:h-auto [&_svg]:w-full"
                dangerouslySetInnerHTML={{ __html: svgContent }}
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-black">Share & Embed</h2>
                  <p className="text-sm text-black">
                    Copy a link, download a PNG, or embed the SVG.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={handleCopySvgUrl}
                    className="!h-9 border border-black bg-white !px-4 !py-2 text-sm text-black hover:bg-black hover:text-white"
                  >
                    {copiedAction === "svg" ? "Copied" : "Copy SVG"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleDownloadPng}
                    className="!h-9 border border-black bg-white !px-4 !py-2 text-sm text-black hover:bg-black hover:text-white"
                  >
                    {isDownloading ? "Preparing PNG" : "Download PNG"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleCopyEmbedSnippet}
                    className="!h-9 border border-black bg-white !px-4 !py-2 text-sm text-black hover:bg-black hover:text-white"
                  >
                    {copiedAction === "embed" ? "Copied" : "Copy Embed Snippet"}
                  </Button>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-black">
                  Embed snippet
                </div>
                <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-white p-4 text-xs text-black">
                  {embedSnippet}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>

      {tooltip.visible && (
        <div
          className="fixed pointer-events-none z-50 rounded-md border border-black bg-black px-3 py-2 text-sm text-white"
          style={{
            left: tooltip.x + 15,
            top: tooltip.y - 10,
          }}
        >
          <div className="font-medium">{tooltip.repo}</div>
          {tooltip.series && <div className="text-white">{tooltip.series}</div>}
          <div className="text-white">{tooltip.date}</div>
          <div className="text-green-300">{tooltip.count} issues</div>
        </div>
      )}
    </div>
  )
}
