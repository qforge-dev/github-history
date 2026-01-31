const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const MAX_DATES_PER_BATCH = 25;
let githubRequestCount = 0;

interface RepositoryInfo {
  createdAt: Date;
  totalIssues: number;
}

interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

interface GraphQLResponse<T> {
  data: T | null;
  errors: Array<{ message: string; type: string | null }> | null;
}

interface RepositoryQueryResponse {
  repository: {
    createdAt: string;
    issues: {
      totalCount: number;
    };
  } | null;
}

interface RateLimitQueryResponse {
  rateLimit: {
    remaining: number;
    resetAt: string;
  };
}

interface SearchCountResponse {
  issueCount: number;
}

type IssueCountsQueryResponse = Record<string, SearchCountResponse>;

class GitHubGraphQLClient {
  private token: string;

  constructor(token: string | null = null) {
    const resolvedToken = token ?? process.env.GITHUB_TOKEN;
    if (!resolvedToken) {
      throw new Error("GitHub token is required. Set GITHUB_TOKEN environment variable or pass token to constructor.");
    }
    this.token = resolvedToken;
  }

  async getRepositoryInfo(owner: string, name: string): Promise<RepositoryInfo> {
    const query = buildRepositoryInfoQuery(owner, name);
    const response = await this.executeQuery<RepositoryQueryResponse>(query);

    if (!response.data?.repository) {
      throw new Error(`Repository not found: ${owner}/${name}`);
    }

    return {
      createdAt: new Date(response.data.repository.createdAt),
      totalIssues: response.data.repository.issues.totalCount,
    };
  }

  async getIssueCountsAtDates(owner: string, name: string, dates: Date[]): Promise<Map<string, number>> {
    if (dates.length === 0) {
      return new Map();
    }

    if (dates.length > MAX_DATES_PER_BATCH) {
      throw new Error(`Maximum ${MAX_DATES_PER_BATCH} dates allowed per batch. Received: ${dates.length}`);
    }

    const query = buildIssueCountsQuery(owner, name, dates);
    const response = await this.executeQuery<IssueCountsQueryResponse>(query);

    if (!response.data) {
      throw new Error("Failed to fetch issue counts");
    }

    const results = new Map<string, number>();

    for (const date of dates) {
      const isoDate = formatDateToISO(date);
      const alias = dateToAlias(isoDate);
      const searchResult = response.data[alias];

      if (searchResult !== undefined) {
        results.set(isoDate, searchResult.issueCount);
      }
    }

    return results;
  }

  async getRateLimitInfo(): Promise<RateLimitInfo> {
    const query = buildRateLimitQuery();
    const response = await this.executeQuery<RateLimitQueryResponse>(query);

    if (!response.data?.rateLimit) {
      throw new Error("Failed to fetch rate limit information");
    }

    return {
      remaining: response.data.rateLimit.remaining,
      resetAt: new Date(response.data.rateLimit.resetAt),
    };
  }

  private async executeQuery<T>(query: string): Promise<GraphQLResponse<T>> {
    githubRequestCount += 1;
    console.info(`[GitHub] Request #${githubRequestCount}`);
    const response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as GraphQLResponse<T>;

    if (result.errors && result.errors.length > 0) {
      const errorMessages = result.errors.map(e => e.message).join(", ");
      const isRateLimited = result.errors.some(e => e.type === "RATE_LIMITED");

      if (isRateLimited) {
        throw new Error(`GitHub API rate limit exceeded: ${errorMessages}`);
      }

      throw new Error(`GitHub GraphQL error: ${errorMessages}`);
    }

    return result;
  }
}

function buildRepositoryInfoQuery(owner: string, name: string): string {
  return `
    query {
      repository(owner: "${escapeGraphQLString(owner)}", name: "${escapeGraphQLString(name)}") {
        createdAt
        issues {
          totalCount
        }
      }
    }
  `;
}

function buildIssueCountsQuery(owner: string, name: string, dates: Date[]): string {
  const searchQueries = dates.map(date => {
    const isoDate = formatDateToISO(date);
    const alias = dateToAlias(isoDate);
    const searchQuery = `repo:${escapeGraphQLString(owner)}/${escapeGraphQLString(name)} is:issue created:<${isoDate}`;

    return `${alias}: search(query: "${escapeGraphQLString(searchQuery)}", type: ISSUE, first: 0) {
      issueCount
    }`;
  });

  return `
    query {
      ${searchQueries.join("\n      ")}
    }
  `;
}

function buildRateLimitQuery(): string {
  return `
    query {
      rateLimit {
        remaining
        resetAt
      }
    }
  `;
}

function dateToAlias(isoDate: string): string {
  return `d_${isoDate.replace(/-/g, "_")}`;
}

function formatDateToISO(date: Date): string {
  return date.toISOString().split("T")[0];
}

function escapeGraphQLString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export { GitHubGraphQLClient };
export type { RepositoryInfo, RateLimitInfo };
