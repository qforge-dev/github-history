import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Github, Twitter } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  normalizeMetrics,
  parseMetricsParam,
  serializeMetricsParam,
  type MetricValue,
} from "@/lib/metrics";
import {
  normalizeRepoInputToPath,
  parseRepoPath,
  type RepoIdentifier,
} from "@/lib/repo-parser";

export const Route = createFileRoute("/")({ component: RepoHistoryPage });

const MAX_REPOS = 5;
const EXAMPLES = [
  "facebook/react",
  "microsoft/vscode",
  "vercel/next.js",
  "anomalyco/opencode&openclaw/openclaw",
];
const METRIC_OPTIONS: Array<{ value: MetricValue; label: string }> = [
  { value: "created", label: "Created" },
  { value: "closed", label: "Closed" },
  { value: "net", label: "Net Active" },
];

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  date: string;
  count: string;
  repo: string;
  series: string;
}

function parseRepoInput(input: string): {
  repos: RepoIdentifier[];
  error?: string;
  normalizedPath?: string;
} | null {
  const path = normalizeRepoInputToPath(input);

  if (!path) {
    return null;
  }

  return parseRepoPath(path, MAX_REPOS);
}

function buildPath(repos: RepoIdentifier[]): string {
  return repos.map((repo) => repo.fullName).join("&");
}

function parseBooleanParam(value: string | null): boolean {
  return value === "true" || value === "1";
}

function parseNumberParam(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getTodayUtc(): Date {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

function toDateInputValue(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getPresetDates(
  preset: string,
): { startDate: string; endDate: string } | null {
  const today = getTodayUtc();
  if (preset === "month") {
    const start = new Date(today.getTime());
    start.setUTCMonth(start.getUTCMonth() - 1);
    return {
      startDate: toDateInputValue(start),
      endDate: toDateInputValue(today),
    };
  }
  if (preset === "year") {
    const start = new Date(today.getTime());
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return {
      startDate: toDateInputValue(start),
      endDate: toDateInputValue(today),
    };
  }
  return null;
}

function inferDatePreset(startDate: string, endDate: string): string {
  if (!startDate && !endDate) {
    return "all";
  }
  const lastMonth = getPresetDates("month");
  if (
    lastMonth &&
    startDate === lastMonth.startDate &&
    endDate === lastMonth.endDate
  ) {
    return "month";
  }
  const lastYear = getPresetDates("year");
  if (
    lastYear &&
    startDate === lastYear.startDate &&
    endDate === lastYear.endDate
  ) {
    return "year";
  }
  return "custom";
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30;

function parseMaxMonthsFromSvg(svg: string): number | null {
  const dateRegex = /data-date="([^"]+)"/g;
  let match: RegExpExecArray | null;
  let maxMonth = 0;
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  while ((match = dateRegex.exec(svg)) !== null) {
    const value = match[1];
    const monthMatch = value.match(/^(\d+)\s+month/);
    if (monthMatch) {
      const months = Number.parseInt(monthMatch[1], 10);
      if (Number.isFinite(months)) {
        maxMonth = Math.max(maxMonth, months);
      }
      continue;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    if (!minDate || parsed.getTime() < minDate.getTime()) {
      minDate = parsed;
    }
    if (!maxDate || parsed.getTime() > maxDate.getTime()) {
      maxDate = parsed;
    }
  }

  if (maxMonth > 0) {
    return maxMonth;
  }

  if (minDate && maxDate) {
    const diffMs = maxDate.getTime() - minDate.getTime();
    return Math.max(1, Math.ceil(diffMs / MS_PER_MONTH));
  }

  return null;
}

function getSliderPercent(value: number, min: number, max: number): string {
  if (max <= min) return "50%";
  const ratio = (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, ratio));
  return `${clamped * 100}%`;
}

function normalizeSearchParams(search: unknown): URLSearchParams {
  if (typeof search === "string") {
    return new URLSearchParams(search);
  }

  if (!search || typeof search !== "object") {
    return new URLSearchParams();
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(
    search as Record<string, unknown>,
  )) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === null || item === undefined) continue;
        params.append(key, String(item));
      }
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

function applyChartParams(
  params: URLSearchParams,
  settings: {
    logScale: boolean;
    alignTimelines: boolean;
    metrics: MetricValue[];
    allowAlign: boolean;
    startDate?: string;
    endDate?: string;
    monthStart?: number;
    monthEnd?: number;
  },
): URLSearchParams {
  if (settings.logScale) {
    params.set("logScale", "true");
  } else {
    params.delete("logScale");
  }

  const metricsParam = serializeMetricsParam(settings.metrics);
  if (metricsParam) {
    params.set("metrics", metricsParam);
  } else {
    params.delete("metrics");
  }
  params.delete("showClosed");

  if (settings.alignTimelines && settings.allowAlign) {
    params.set("alignTimelines", "true");
  } else {
    params.delete("alignTimelines");
  }

  if (settings.startDate) {
    params.set("startDate", settings.startDate);
  } else {
    params.delete("startDate");
  }

  if (settings.endDate) {
    params.set("endDate", settings.endDate);
  } else {
    params.delete("endDate");
  }

  if (settings.monthStart !== undefined) {
    params.set("monthStart", String(settings.monthStart));
  } else {
    params.delete("monthStart");
  }

  if (settings.monthEnd !== undefined) {
    params.set("monthEnd", String(settings.monthEnd));
  } else {
    params.delete("monthEnd");
  }

  return params;
}

function areReposEqual(a: RepoIdentifier[], b: RepoIdentifier[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].fullName.toLowerCase() !== b[i].fullName.toLowerCase()) {
      return false;
    }
  }
  return true;
}

function mergeRepos(
  existing: RepoIdentifier[],
  incoming: RepoIdentifier[],
): RepoIdentifier[] {
  const merged: RepoIdentifier[] = [];
  const seen = new Set<string>();

  for (const repo of existing) {
    const key = repo.fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(repo);
  }

  for (const repo of incoming) {
    const key = repo.fullName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(repo);
  }

  return merged;
}

export function RepoHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  const rawPath = useMemo(() => {
    const cleaned = location.pathname.replace(/^\/+/, "");
    return decodeURIComponent(cleaned);
  }, [location.pathname]);

  const searchParams = useMemo(
    () => normalizeSearchParams(location.search),
    [location.search],
  );
  const searchSettings = useMemo(
    () => ({
      logScale: parseBooleanParam(searchParams.get("logScale")),
      alignTimelines: parseBooleanParam(searchParams.get("alignTimelines")),
      metrics: parseMetricsParam(searchParams),
    }),
    [searchParams],
  );
  const searchFilters = useMemo(
    () => ({
      startDate: searchParams.get("startDate") ?? "",
      endDate: searchParams.get("endDate") ?? "",
      monthStart: parseNumberParam(searchParams.get("monthStart")),
      monthEnd: parseNumberParam(searchParams.get("monthEnd")),
    }),
    [searchParams],
  );

  const parsedPath = useMemo(() => {
    if (!rawPath) {
      return { repos: [] as RepoIdentifier[] };
    }

    return parseRepoPath(rawPath, MAX_REPOS);
  }, [rawPath]);

  const [repos, setRepos] = useState<RepoIdentifier[]>(parsedPath.repos ?? []);
  const [repoInput, setRepoInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(searchSettings.logScale);
  const [alignTimelines, setAlignTimelines] = useState(
    searchSettings.alignTimelines,
  );
  const [metrics, setMetrics] = useState<MetricValue[]>(
    normalizeMetrics(searchSettings.metrics),
  );
  const [datePreset, setDatePreset] = useState(
    inferDatePreset(searchFilters.startDate, searchFilters.endDate),
  );
  const [startDate, setStartDate] = useState(searchFilters.startDate);
  const [endDate, setEndDate] = useState(searchFilters.endDate);
  const [monthRange, setMonthRange] = useState<[number, number] | null>(() => {
    if (searchFilters.monthStart === null && searchFilters.monthEnd === null) {
      return null;
    }
    const start = searchFilters.monthStart ?? 0;
    const end = searchFilters.monthEnd ?? start;
    return [start, end];
  });
  const [monthRangeDraft, setMonthRangeDraft] = useState<
    [number, number] | null
  >(() => {
    if (searchFilters.monthStart === null && searchFilters.monthEnd === null) {
      return null;
    }
    const start = searchFilters.monthStart ?? 0;
    const end = searchFilters.monthEnd ?? start;
    return [start, end];
  });
  const [maxMonths, setMaxMonths] = useState(48);
  const [copiedAction, setCopiedAction] = useState<"svg" | "embed" | null>(
    null,
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    date: "",
    count: "",
    repo: "",
    series: "",
  });
  const handleMetricsChange = (next: MetricValue[]) => {
    setMetrics(normalizeMetrics(next));
  };

  const repoKey = useMemo(() => buildPath(repos), [repos]);
  const chartPath = repoKey || parsedPath.normalizedPath || "";
  const effectiveFilters = useMemo(() => {
    if (alignTimelines) {
      let range = monthRange;
      if (range && range[0] === 0 && range[1] === maxMonths) {
        range = null;
      }
      return {
        startDate: "",
        endDate: "",
        monthStart: range?.[0],
        monthEnd: range?.[1],
      };
    }

    return {
      startDate: startDate || "",
      endDate: endDate || "",
      monthStart: undefined,
      monthEnd: undefined,
    };
  }, [alignTimelines, endDate, maxMonths, monthRange, startDate]);
  const chartQuery = useMemo(() => {
    const params = applyChartParams(new URLSearchParams(), {
      logScale,
      alignTimelines,
      metrics,
      allowAlign: repos.length > 1,
      startDate: effectiveFilters.startDate,
      endDate: effectiveFilters.endDate,
      monthStart: effectiveFilters.monthStart,
      monthEnd: effectiveFilters.monthEnd,
    });
    const queryString = params.toString();
    return queryString ? `?${queryString}` : "";
  }, [
    alignTimelines,
    effectiveFilters.endDate,
    effectiveFilters.monthEnd,
    effectiveFilters.monthStart,
    effectiveFilters.startDate,
    logScale,
    repos.length,
    metrics,
  ]);

  const chartUrl = useMemo(() => {
    if (!chartPath) {
      return "https://github-history.com/";
    }

    const safePath = encodeURI(chartPath);
    return `https://github-history.com/${safePath}${chartQuery}`;
  }, [chartPath, chartQuery]);
  const svgUrl = useMemo(() => {
    if (!repoKey) {
      return "https://github-history.com/api/svg";
    }

    const params = applyChartParams(new URLSearchParams({ repos: repoKey }), {
      logScale,
      alignTimelines,
      metrics,
      allowAlign: repos.length > 1,
      startDate: effectiveFilters.startDate,
      endDate: effectiveFilters.endDate,
      monthStart: effectiveFilters.monthStart,
      monthEnd: effectiveFilters.monthEnd,
    });

    return `https://github-history.com/api/svg?${params.toString()}`;
  }, [
    alignTimelines,
    effectiveFilters.endDate,
    effectiveFilters.monthEnd,
    effectiveFilters.monthStart,
    effectiveFilters.startDate,
    logScale,
    repoKey,
    repos.length,
    metrics,
  ]);
  const embedSnippet = useMemo(() => {
    return `## Issue History\n\n[![Issue History Chart](${svgUrl})](${chartUrl})`;
  }, [chartUrl, svgUrl]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (parsedPath.normalizedPath && parsedPath.normalizedPath !== rawPath) {
      navigate({ to: `/${parsedPath.normalizedPath}`, replace: true });
    }
  }, [navigate, parsedPath.normalizedPath, rawPath]);

  useEffect(() => {
    setLogScale(searchSettings.logScale);
    setAlignTimelines(searchSettings.alignTimelines);
    setMetrics(normalizeMetrics(searchSettings.metrics));
  }, [
    searchSettings.alignTimelines,
    searchSettings.logScale,
    searchSettings.metrics,
  ]);

  useEffect(() => {
    setStartDate(searchFilters.startDate);
    setEndDate(searchFilters.endDate);
    setDatePreset(
      inferDatePreset(searchFilters.startDate, searchFilters.endDate),
    );
    if (searchFilters.monthStart === null && searchFilters.monthEnd === null) {
      setMonthRange(null);
      setMonthRangeDraft(null);
    } else {
      const start = searchFilters.monthStart ?? 0;
      const end = searchFilters.monthEnd ?? start;
      setMonthRange([start, end]);
      setMonthRangeDraft([start, end]);
    }
  }, [
    searchFilters.endDate,
    searchFilters.monthEnd,
    searchFilters.monthStart,
    searchFilters.startDate,
  ]);

  useEffect(() => {
    if (!parsedPath.repos) {
      return;
    }

    setRepos((prev) =>
      areReposEqual(prev, parsedPath.repos) ? prev : parsedPath.repos,
    );
  }, [parsedPath.repos]);

  useEffect(() => {
    const nextPath = buildPath(repos);
    if (nextPath === (parsedPath.normalizedPath ?? rawPath)) {
      return;
    }

    const search = searchParams.toString();
    const nextUrl = `${nextPath ? `/${nextPath}` : "/"}${search ? `?${search}` : ""}`;
    navigate({ to: nextUrl, replace: true });
  }, [navigate, parsedPath.normalizedPath, rawPath, repos, searchParams]);

  useEffect(() => {
    const currentParams = normalizeSearchParams(location.search);
    const nextParams = applyChartParams(new URLSearchParams(currentParams), {
      logScale,
      alignTimelines,
      metrics,
      allowAlign: repos.length > 1,
      startDate: effectiveFilters.startDate,
      endDate: effectiveFilters.endDate,
      monthStart: effectiveFilters.monthStart,
      monthEnd: effectiveFilters.monthEnd,
    });

    const currentSearch = currentParams.toString();
    const nextSearch = nextParams.toString();

    if (currentSearch === nextSearch) {
      return;
    }

    const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ""}`;
    navigate({ to: nextUrl, replace: true });
  }, [
    alignTimelines,
    effectiveFilters.endDate,
    effectiveFilters.monthEnd,
    effectiveFilters.monthStart,
    effectiveFilters.startDate,
    location.pathname,
    location.search,
    logScale,
    navigate,
    repos.length,
    metrics,
  ]);

  useEffect(() => {
    if (repos.length < 2 && alignTimelines) {
      setAlignTimelines(false);
    }
  }, [alignTimelines, repos.length]);

  useEffect(() => {
    async function fetchChart() {
      if (parsedPath.error) {
        setErrorMessage(parsedPath.error);
        setSvgContent(null);
        setIsLoading(false);
        return;
      }

      if (!repoKey) {
        setSvgContent(null);
        setIsLoading(false);
        setErrorMessage(null);
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const params = applyChartParams(
          new URLSearchParams({ repos: repoKey }),
          {
            logScale,
            alignTimelines,
            metrics,
            allowAlign: repos.length > 1,
            startDate: effectiveFilters.startDate,
            endDate: effectiveFilters.endDate,
            monthStart: effectiveFilters.monthStart,
            monthEnd: effectiveFilters.monthEnd,
          },
        );

        const response = await fetch(`/api/chart?${params.toString()}`);
        const text = await response.text();

        if (!response.ok) {
          setErrorMessage("Failed to load comparison chart");
          setSvgContent(text);
        } else {
          setSvgContent(text);
        }
      } catch (fetchError) {
        const message =
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to fetch chart";
        setErrorMessage(message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchChart();
  }, [
    alignTimelines,
    effectiveFilters.endDate,
    effectiveFilters.monthEnd,
    effectiveFilters.monthStart,
    effectiveFilters.startDate,
    logScale,
    parsedPath.error,
    repoKey,
    repos.length,
    metrics,
  ]);

  useEffect(() => {
    if (!svgContent) return;
    if (
      alignTimelines &&
      (effectiveFilters.monthStart !== undefined ||
        effectiveFilters.monthEnd !== undefined)
    ) {
      return;
    }
    const nextMax = parseMaxMonthsFromSvg(svgContent);
    if (nextMax !== null && nextMax !== maxMonths) {
      setMaxMonths(nextMax);
    }
  }, [
    alignTimelines,
    effectiveFilters.monthEnd,
    effectiveFilters.monthStart,
    maxMonths,
    svgContent,
  ]);

  useEffect(() => {
    if (!monthRange) return;
    const [start, end] = monthRange;
    const clampedStart = Math.max(0, Math.min(start, maxMonths));
    const clampedEnd = Math.max(clampedStart, Math.min(end, maxMonths));
    if (clampedStart !== start || clampedEnd !== end) {
      setMonthRange([clampedStart, clampedEnd]);
    }
  }, [maxMonths, monthRange]);

  useEffect(() => {
    if (!monthRangeDraft) return;
    const [start, end] = monthRangeDraft;
    const clampedStart = Math.max(0, Math.min(start, maxMonths));
    const clampedEnd = Math.max(clampedStart, Math.min(end, maxMonths));
    if (clampedStart !== start || clampedEnd !== end) {
      setMonthRangeDraft([clampedStart, clampedEnd]);
    }
  }, [maxMonths, monthRangeDraft]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || !svgContent) return;

    function handleMouseOver(event: MouseEvent) {
      const target = event.target as Element;
      if (target.classList.contains("data-point")) {
        const date = target.getAttribute("data-date") || "";
        const count = target.getAttribute("data-count") || "";
        const repo = target.getAttribute("data-repo") || "";
        const series = target.getAttribute("data-series") || "";
        setTooltip({
          visible: true,
          x: event.clientX,
          y: event.clientY,
          date,
          count,
          repo,
          series,
        });
      }
    }

    function handleMouseMove(event: MouseEvent) {
      const target = event.target as Element;
      if (target.classList.contains("data-point")) {
        setTooltip((prev) => ({
          ...prev,
          x: event.clientX,
          y: event.clientY,
        }));
      }
    }

    function handleMouseOut(event: MouseEvent) {
      const target = event.target as Element;
      if (target.classList.contains("data-point")) {
        setTooltip((prev) => ({ ...prev, visible: false }));
      }
    }

    function handleMouseLeave() {
      setTooltip((prev) => ({ ...prev, visible: false }));
    }

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseout", handleMouseOut);
    container.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseout", handleMouseOut);
      container.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [svgContent]);

  function handleDatePresetChange(value: string) {
    setDatePreset(value);
    if (value === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }
    if (value === "custom") {
      return;
    }
    const preset = getPresetDates(value);
    if (preset) {
      setStartDate(preset.startDate);
      setEndDate(preset.endDate);
    }
  }

  function handleStartDateChange(event: React.ChangeEvent<HTMLInputElement>) {
    setStartDate(event.target.value);
    if (datePreset !== "custom") {
      setDatePreset("custom");
    }
  }

  function handleEndDateChange(event: React.ChangeEvent<HTMLInputElement>) {
    setEndDate(event.target.value);
    if (datePreset !== "custom") {
      setDatePreset("custom");
    }
  }

  function handleMonthRangeCommit(value: number[]) {
    if (value.length < 2) return;
    const [start, end] = value as [number, number];
    setMonthRange([start, end]);
    setMonthRangeDraft([start, end]);
  }

  function handleMonthRangeChange(value: number[]) {
    if (value.length < 2) return;
    const [start, end] = value as [number, number];
    setMonthRangeDraft([start, end]);
  }

  function resetCopyState() {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }

    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedAction(null);
    }, 1500);
  }

  async function handleCopySvgUrl() {
    try {
      await navigator.clipboard.writeText(svgUrl);
      setCopiedAction("svg");
      resetCopyState();
    } catch {
      setCopiedAction(null);
    }
  }

  async function handleCopyEmbedSnippet() {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopiedAction("embed");
      resetCopyState();
    } catch {
      setCopiedAction(null);
    }
  }

  function extractSvgSize(svg: string): { width: number; height: number } {
    const widthMatch = svg.match(/width="([\d.]+)"/);
    const heightMatch = svg.match(/height="([\d.]+)"/);
    if (widthMatch && heightMatch) {
      return {
        width: Number.parseFloat(widthMatch[1]),
        height: Number.parseFloat(heightMatch[1]),
      };
    }

    const viewBoxMatch = svg.match(/viewBox="([\d.\s]+)"/);
    if (viewBoxMatch) {
      const parts = viewBoxMatch[1].trim().split(/\s+/);
      if (parts.length === 4) {
        return {
          width: Number.parseFloat(parts[2]),
          height: Number.parseFloat(parts[3]),
        };
      }
    }

    return { width: 900, height: 600 };
  }

  async function handleDownloadPng() {
    if (!svgContent || isDownloading) {
      return;
    }

    setIsDownloading(true);

    try {
      const { width, height } = extractSvgSize(svgContent);
      const svgBlob = new Blob([svgContent], {
        type: "image/svg+xml;charset=utf-8",
      });
      const url = URL.createObjectURL(svgBlob);

      const image = new Image();
      const canvas = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }

      await new Promise<void>((resolve, reject) => {
        image.onload = () => {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          resolve();
        };
        image.onerror = () => reject(new Error("Failed to load svg"));
        image.src = url;
      });

      URL.revokeObjectURL(url);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );

      if (!pngBlob) {
        return;
      }

      const downloadUrl = URL.createObjectURL(pngBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "issue-history.png";
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } finally {
      setIsDownloading(false);
    }
  }

  function handleAddRepos(event: React.FormEvent) {
    event.preventDefault();
    setInputError(null);

    const parsed = parseRepoInput(repoInput);

    if (!parsed) {
      setInputError("Enter a GitHub repository to add.");
      return;
    }

    if (parsed.error) {
      setInputError(parsed.error);
      return;
    }

    const merged = mergeRepos(repos, parsed.repos);

    if (merged.length > MAX_REPOS) {
      setInputError(`Please compare ${MAX_REPOS} repositories or fewer.`);
      return;
    }

    setRepos(merged);
    setRepoInput("");
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    setRepoInput(event.target.value);
    if (inputError) {
      setInputError(null);
    }
  }

  function handleRemoveRepo(target: RepoIdentifier) {
    setRepos((current) =>
      current.filter(
        (repo) => repo.fullName.toLowerCase() !== target.fullName.toLowerCase(),
      ),
    );
  }

  function handleAddExample(example: string) {
    const parsed = parseRepoInput(example);
    if (!parsed || parsed.error) {
      return;
    }

    const merged = mergeRepos(repos, parsed.repos);
    if (merged.length > MAX_REPOS) {
      setInputError(`Please compare ${MAX_REPOS} repositories or fewer.`);
      return;
    }

    setInputError(null);
    setRepos(merged);
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-3 py-4 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-center justify-between gap-4 text-left">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-black">
              <span className="text-lg">📈</span>
              <span className="lowercase">github-history.com</span>
            </div>
            <h1 className="text-lg font-semibold text-black sm:text-xl">
              Track repository data over time
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://twitter.com/michalwarda"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Twitter"
              className="rounded-full p-2 text-black transition-opacity hover:opacity-70"
            >
              <Twitter className="h-5 w-5" />
            </a>
            <a
              href="https://github.com/qforge-dev/github-history"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="rounded-full p-2 text-black transition-opacity hover:opacity-70"
            >
              <Github className="h-5 w-5" />
            </a>
          </div>
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

        {isLoading && repoKey && !svgContent && (
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
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-4 text-sm text-black">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={logScale}
                    onChange={(event) => setLogScale(event.target.checked)}
                    className="h-4 w-4 accent-black"
                  />
                  Log Scale
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-black/70">Metrics</span>
                  <MultiSelect
                    options={METRIC_OPTIONS}
                    value={metrics}
                    onValueChange={handleMetricsChange}
                    placeholder="Metrics"
                    className="min-w-[170px]"
                    triggerClassName="border-black bg-white text-black"
                  />
                </div>
                {repos.length > 1 && (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={alignTimelines}
                      onChange={(event) =>
                        setAlignTimelines(event.target.checked)
                      }
                      className="h-4 w-4 accent-black"
                    />
                    Align Timelines
                  </label>
                )}
              </div>
              <div className="relative flex  min-w-[260px] flex-1 items-center">
                <div
                  className={`absolute inset-0 flex flex-wrap items-center gap-2 ${alignTimelines ? "pointer-events-none opacity-0" : "opacity-100"}`}
                  aria-hidden={alignTimelines}
                >
                  <div className="flex items-center gap-2">
                    <Select
                      value={datePreset}
                      onValueChange={handleDatePresetChange}
                    >
                      <SelectTrigger className="w-[150px] border-black bg-white text-black">
                        <SelectValue placeholder="Date range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All time</SelectItem>
                        <SelectItem value="month">Last month</SelectItem>
                        <SelectItem value="year">Last year</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {datePreset === "custom" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="date"
                        value={startDate}
                        onChange={handleStartDateChange}
                        className="!h-9 w-[150px] border-black bg-white text-black"
                      />
                      <span className="text-black/60">to</span>
                      <Input
                        type="date"
                        value={endDate}
                        onChange={handleEndDateChange}
                        className="!h-9 w-[150px] border-black bg-white text-black"
                      />
                    </div>
                  )}
                </div>
                <div
                  className={`absolute inset-0 flex min-w-[240px] flex-1 flex-col justify-center gap-2 ${alignTimelines ? "opacity-100" : "pointer-events-none opacity-0"}`}
                  aria-hidden={!alignTimelines}
                >
                  <Slider
                    key={`${monthRange?.[0] ?? 0}-${monthRange?.[1] ?? maxMonths}-${maxMonths}`}
                    defaultValue={monthRange ?? [0, maxMonths]}
                    min={0}
                    max={maxMonths}
                    step={1}
                    onValueChange={handleMonthRangeChange}
                    onValueCommit={handleMonthRangeCommit}
                    className="w-full"
                  />
                  <div className="relative h-4 w-full text-xs text-black/70">
                    <span
                      className="absolute top-0"
                      style={{
                        left: getSliderPercent(
                          monthRangeDraft?.[0] ?? 0,
                          0,
                          maxMonths,
                        ),
                        transform: "translateX(-50%)",
                      }}
                    >
                      {monthRangeDraft?.[0] ?? 0}
                    </span>
                    <span
                      className="absolute top-0"
                      style={{
                        left: getSliderPercent(
                          monthRangeDraft?.[1] ?? maxMonths,
                          0,
                          maxMonths,
                        ),
                        transform: "translateX(-50%)",
                      }}
                    >
                      {monthRangeDraft?.[1] ?? maxMonths}
                    </span>
                  </div>
                </div>
                <div className="invisible flex w-full flex-wrap items-center gap-2">
                  <Input className="!h-9 w-[150px]" />
                </div>
              </div>
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
                  <h2 className="text-lg font-semibold text-black">
                    Share & Embed
                  </h2>
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
  );
}
