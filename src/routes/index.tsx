import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export const Route = createFileRoute("/")({ component: HomePage })

function parseRepoInput(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const fullUrlPattern = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/?$/
  const fullUrlMatch = trimmed.match(fullUrlPattern)

  if (fullUrlMatch) {
    return { owner: fullUrlMatch[1], repo: fullUrlMatch[2] }
  }

  const shortPattern = /^([^/]+)\/([^/]+)$/
  const shortMatch = trimmed.match(shortPattern)

  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] }
  }

  return null
}

function HomePage() {
  const navigate = useNavigate()
  const [repoInput, setRepoInput] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setErrorMessage(null)

    const parsed = parseRepoInput(repoInput)

    if (!parsed) {
      setErrorMessage("Please enter a valid GitHub repository (e.g., facebook/react)")
      return
    }

    navigate({ to: "/$owner/$repo", params: { owner: parsed.owner, repo: parsed.repo } })
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRepoInput(event.target.value)
    if (errorMessage) {
      setErrorMessage(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <section className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10"></div>
        <div className="relative max-w-2xl mx-auto">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">
            GitHub Issue History
          </h1>
          <p className="text-lg text-gray-300 mb-8">
            Track open issue counts over time for any GitHub repository
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex gap-3">
              <Input
                type="text"
                value={repoInput}
                onChange={handleInputChange}
                placeholder="facebook/react or https://github.com/facebook/react"
                className="flex-1 bg-slate-800 border-slate-600 text-white placeholder:text-slate-400"
              />
              <Button type="submit" className="bg-cyan-500 hover:bg-cyan-600 text-white px-6">
                View Chart
              </Button>
            </div>

            {errorMessage && (
              <p className="text-red-400 text-sm text-left">{errorMessage}</p>
            )}
          </form>

          <div className="mt-8 text-gray-400 text-sm">
            <p>Examples:</p>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {["facebook/react", "microsoft/vscode", "vercel/next.js"].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setRepoInput(example)}
                  className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-gray-300 transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
