export interface RepoIdentifier {
  owner: string
  repo: string
  fullName: string
}

const REPO_PATTERN = /^([^/]+)\/([^/]+)$/

export function normalizeRepoInputToPath(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const hasProtocol = /^https?:\/\//i.test(trimmed)
  const looksLikeUrl = hasProtocol || /\bgithub\.com\b|\bstar-history\.com\b/i.test(trimmed)

  if (looksLikeUrl) {
    try {
      const url = new URL(hasProtocol ? trimmed : `https://${trimmed}`)
      const path = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "")
      return path || null
    } catch (error) {
      return null
    }
  }

  return trimmed.replace(/^\/+/, "").replace(/\/+$/, "")
}

export function parseRepoPath(
  rawPath: string,
  maxRepos = 5
): { repos: RepoIdentifier[]; error?: string; normalizedPath?: string } {
  const trimmed = rawPath.trim().replace(/^\/+/, "").replace(/\/+$/, "")

  if (!trimmed) {
    return { repos: [], error: "Please provide at least one repository." }
  }

  const segments = trimmed.split("&").filter((segment) => segment.trim().length > 0)

  if (segments.length === 0) {
    return { repos: [], error: "Please provide at least one repository." }
  }

  if (segments.length > maxRepos) {
    return {
      repos: [],
      error: `Please compare ${maxRepos} repositories or fewer.`,
    }
  }

  const repos: RepoIdentifier[] = []
  const seen = new Set<string>()

  for (const segment of segments) {
    const cleaned = segment.replace(/^\/+/, "").replace(/\/+$/, "")
    const match = cleaned.match(REPO_PATTERN)

    if (!match) {
      return {
        repos: [],
        error: "Each repository must look like owner/repo.",
      }
    }

    const owner = match[1]
    const repo = match[2]
    const fullName = `${owner}/${repo}`
    const dedupeKey = fullName.toLowerCase()

    if (seen.has(dedupeKey)) {
      continue
    }

    seen.add(dedupeKey)
    repos.push({ owner, repo, fullName })
  }

  if (repos.length === 0) {
    return { repos: [], error: "Please provide at least one repository." }
  }

  const normalizedPath = repos.map((repo) => repo.fullName).join("&")

  return { repos, normalizedPath }
}
