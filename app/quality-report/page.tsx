"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Nav from "@/components/Nav";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";
import type { ProductSummary } from "@/lib/types";
import { runNonAiChecks, type QualityIssue, type CheckId } from "@/lib/content-quality-checks";

interface ContentRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  productTypePt: string;
  summary: string;
  wctBullets: [string, string, string, string];
  pfBullets: [string, string, string, string];
  pfIcons: [string, string, string, string];
}

interface FlaggedProduct {
  productId: string;
  title: string;
  handle: string;
  imageUrl: string | null;
  productTypePt: string;
  issues: QualityIssue[];
}

type Phase = "idle" | "loading" | "done" | "error";

const CHECK_META: Record<string, { label: string; color: string }> = {
  "wear-language":      { label: "Wear language",      color: "bg-amber-100 text-amber-800" },
  "occasion-missing-pf":{ label: "Occasion not in PF", color: "bg-red-100 text-red-700" },
  "missing-bullets":    { label: "Missing bullets",    color: "bg-red-100 text-red-700" },
  "duplicate-icons":    { label: "Duplicate icons",    color: "bg-amber-100 text-amber-800" },
  "boring-summary":     { label: "AI summary",         color: "bg-amber-100 text-amber-800" },
  "context-mismatch":   { label: "Context mismatch",   color: "bg-amber-100 text-amber-800" },
};

const ALL_CHECK_IDS: CheckId[] = [
  "missing-bullets",
  "occasion-missing-pf",
  "wear-language",
  "duplicate-icons",
  "boring-summary",
  "context-mismatch",
];

function numericId(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

function formatCost(count: number): string {
  const low  = count * 0.0005;
  const high = count * 0.0015;
  if (high < 0.01) return "< $0.01";
  return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
}

export default function QualityReportPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [stageLabel, setStageLabel] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [flagged, setFlagged] = useState<FlaggedProduct[]>([]);
  const [checkedTotal, setCheckedTotal] = useState(0);
  const [filterCheckId, setFilterCheckId] = useState<string>("all");
  const [aiError, setAiError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latestFlaggedRef = useRef<FlaggedProduct[]>([]);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("complete");
  const [reviewedFilter, setReviewedFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [bestseller, setBestseller] = useState(false);
  const [christmas, setChristmas] = useState(false);
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>(PRODUCT_TAXONOMY);
  const [productCount, setProductCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  useEffect(() => {
    fetch("/api/taxonomy")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.taxonomy) setTaxonomy(d.taxonomy); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/quality-report/saved")
      .then((r) => r.ok ? r.json() : null)
      .then((json) => {
        const data = json?.report;
        if (!data?.flagged || !data?.timestamp) return;
        setFlagged(data.flagged);
        latestFlaggedRef.current = data.flagged;
        setCheckedTotal(data.checkedTotal ?? 0);
        setLastRunAt(data.timestamp);
        if (data.filters) {
          setSearch(data.filters.search ?? "");
          const saved = data.filters.statusFilter;
          setStatusFilter(saved === "partial" || saved === "complete" ? saved : "complete");
          setReviewedFilter(data.filters.reviewedFilter ?? "");
          setTypeFilter(data.filters.typeFilter ?? "");
          setStyleFilter(data.filters.styleFilter ?? "");
          setBestseller(data.filters.bestseller ?? false);
          setChristmas(data.filters.christmas ?? false);
        }
        setPhase("done");
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCount = useCallback(async () => {
    setCountLoading(true);
    setProductCount(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (reviewedFilter) params.set("reviewed", reviewedFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (styleFilter) params.set("style", styleFilter);
    if (bestseller) params.set("bestseller", "true");
    if (christmas) params.set("christmas", "true");
    try {
      const res = await fetch(`/api/products/count?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setProductCount(data.count);
    } catch { /* ignore */ } finally {
      setCountLoading(false);
    }
  }, [search, statusFilter, reviewedFilter, typeFilter, styleFilter, bestseller, christmas]);

  useEffect(() => {
    const timer = setTimeout(() => { fetchCount(); }, 400);
    return () => clearTimeout(timer);
  }, [fetchCount]);

  function mergeAiResults(
    aiResults: { productId: string; issues: QualityIssue[] }[],
    productMap: Map<string, ProductSummary>,
    rowMap: Map<string, ContentRow>,
  ) {
    const map = new Map(latestFlaggedRef.current.map((p) => [p.productId, p]));
    for (const ai of aiResults) {
      const existing = map.get(ai.productId);
      if (existing) {
        const existingIds = new Set(existing.issues.map((i) => i.checkId));
        const fresh = ai.issues.filter((i) => !existingIds.has(i.checkId));
        if (fresh.length > 0) {
          map.set(ai.productId, { ...existing, issues: [...existing.issues, ...fresh] });
        }
      } else if (ai.issues.length > 0) {
        const product = productMap.get(ai.productId);
        const row = rowMap.get(ai.productId);
        if (row) {
          map.set(ai.productId, {
            productId: ai.productId,
            title: row.title,
            handle: product?.handle ?? "",
            imageUrl: row.imageUrl,
            productTypePt: row.productTypePt,
            issues: ai.issues,
          });
        }
      }
    }
    const result = Array.from(map.values()).sort((a, b) => b.issues.length - a.issues.length);
    latestFlaggedRef.current = result;
    setFlagged(result);
  }

  async function runReport() {
    setPhase("loading");
    setFlagged([]);
    setAiError(null);
    setFatalError(null);
    setSaveError(null);
    setCheckedTotal(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Stage 1: load all products
      setStageLabel("Loading product list");
      const allProducts: ProductSummary[] = [];
      let cursor: string | null = null;

      do {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        if (search) params.set("search", search);
        if (statusFilter) params.set("status", statusFilter);
        if (reviewedFilter) params.set("reviewed", reviewedFilter);
        if (typeFilter) params.set("type", typeFilter);
        if (styleFilter) params.set("style", styleFilter);
        if (bestseller) params.set("bestseller", "true");
        if (christmas) params.set("christmas", "true");
        const res = await fetch(`/api/products?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to load products");
        const data: { products: ProductSummary[]; nextCursor: string | null } = await res.json();
        allProducts.push(...data.products);
        cursor = data.nextCursor;
        setProgress({ done: allProducts.length, total: 0 }); // total unknown during product list loading
      } while (cursor);

      if (allProducts.length === 0) {
        setPhase("done");
        return;
      }

      const productMap = new Map(allProducts.map((p) => [p.id, p]));

      // Stage 2: fetch content in batches of 50
      setStageLabel("Loading content");
      const rowMap = new Map<string, ContentRow>();
      const CONTENT_BATCH = 50;

      for (let i = 0; i < allProducts.length; i += CONTENT_BATCH) {
        const batch = allProducts.slice(i, i + CONTENT_BATCH);
        const res = await fetch("/api/bulk-content-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: batch.map((p) => p.id), readOnly: true }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Failed to load content");
        const data: { rows: ContentRow[] } = await res.json();
        for (const row of data.rows) rowMap.set(row.productId, row);
        setProgress({ done: rowMap.size, total: allProducts.length });
      }

      // Stage 3: run non-AI checks
      setStageLabel("Running checks");
      const newFlagged: FlaggedProduct[] = [];
      for (const row of rowMap.values()) {
        const issues = runNonAiChecks({
          productId: row.productId,
          title: row.title,
          productTypePt: row.productTypePt,
          summary: row.summary,
          wctBullets: row.wctBullets,
          pfBullets: row.pfBullets,
          pfIcons: row.pfIcons,
        });
        if (issues.length > 0) {
          newFlagged.push({
            productId: row.productId,
            title: row.title,
            handle: productMap.get(row.productId)?.handle ?? "",
            imageUrl: row.imageUrl,
            productTypePt: row.productTypePt,
            issues,
          });
        }
      }
      const sortedFlagged = newFlagged.sort((a, b) => b.issues.length - a.issues.length);
      latestFlaggedRef.current = sortedFlagged;
      setFlagged(sortedFlagged);

      // Stage 4: AI checks (only products with a summary)
      const rowsWithSummary = Array.from(rowMap.values()).filter((r) => r.summary.trim());

      if (rowsWithSummary.length > 0) {
        setStageLabel("Running AI checks");
        const AI_BATCH = 25;
        let aiDone = 0;

        for (let i = 0; i < rowsWithSummary.length; i += AI_BATCH) {
          const batch = rowsWithSummary.slice(i, i + AI_BATCH);
          setProgress({ done: i, total: rowsWithSummary.length });

          const res = await fetch("/api/quality-report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: batch.map((r) => ({
                productId: r.productId,
                title: r.title,
                productTypePt: r.productTypePt,
                summary: r.summary,
                pfBullets: r.pfBullets,
              })),
            }),
            signal: controller.signal,
          });

          if (res.ok) {
            const data: {
              results: { productId: string; issues: QualityIssue[] }[];
              creditsExhausted?: boolean;
              error?: string;
            } = await res.json();

            if (data.creditsExhausted) {
              setAiError("Anthropic account has run out of credits — AI checks were skipped.");
              break;
            }
            if (data.error && !data.results?.length) {
              setAiError(`AI checks incomplete: ${data.error}`);
              break;
            }
            if (data.results?.length) {
              mergeAiResults(data.results, productMap, rowMap);
            }
          }

          aiDone += batch.length;
          setCheckedTotal(aiDone);
        }
        setProgress({ done: rowsWithSummary.length, total: rowsWithSummary.length });
      }

      setCheckedTotal(allProducts.length);
      const timestamp = new Date().toISOString();
      setLastRunAt(timestamp);
      // Strip display-only fields before saving to stay well under the 64KB metafield limit.
      // imageUrl, label, severity, and handle are all re-derived at load time.
      const slim = latestFlaggedRef.current.map(({ imageUrl: _img, ...p }) => ({
        ...p,
        issues: p.issues.map(({ label: _l, severity: _s, ...i }) => i),
      }));
      fetch("/api/quality-report/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp,
          flagged: slim,
          checkedTotal: allProducts.length,
          filters: { search, statusFilter, reviewedFilter, typeFilter, styleFilter, bestseller, christmas },
        }),
      }).then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setSaveError(body.error ?? "Report could not be saved — it won't persist after you leave this page.");
        }
      }).catch(() => {
        setSaveError("Report could not be saved — it won't persist after you leave this page.");
      });
      setPhase("done");
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setFatalError("Something went wrong loading the report. Please try again.");
      setPhase("error");
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setPhase("idle");
  }

  function clearReport() {
    fetch("/api/quality-report/saved", { method: "DELETE" }).catch(() => {});
    setPhase("idle");
    setFlagged([]);
    latestFlaggedRef.current = [];
    setCheckedTotal(0);
    setLastRunAt(null);
    setFilterCheckId("all");
    setAiError(null);
  }

  const filtered = filterCheckId === "all"
    ? flagged
    : flagged.filter((p) => p.issues.some((i) => i.checkId === filterCheckId));

  const countByCheck = ALL_CHECK_IDS.reduce<Record<string, number>>((acc, id) => {
    acc[id] = flagged.filter((p) => p.issues.some((i) => i.checkId === id)).length;
    return acc;
  }, {});

  const isRunning = phase === "loading";

  return (
    <div className="flex flex-col h-screen bg-white">
      <Nav active="quality-report" helpText={"Run a quality check across all your products to spot common content issues.\nSelect which checks and filters to apply, then click Run Report.\nClick Edit on any flagged product to fix it directly."} />

      <div className="flex-1 overflow-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-gray-900">Content Quality Report</h1>
            <p className="mt-1 text-sm text-gray-500">
              Scan products for content issues: missing bullets, duplicate icons, occasion mismatches, wear language on non-wearable items, and AI-sounding summaries.
            </p>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2 items-center mb-5">
            <input
              type="search"
              placeholder="Search products…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={isRunning}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              disabled={isRunning}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
            >
              <option value="partial">Partial Content</option>
              <option value="complete">Complete</option>
            </select>
            <select
              value={reviewedFilter}
              onChange={(e) => setReviewedFilter(e.target.value)}
              disabled={isRunning}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
            >
              <option value="">Approval Status</option>
              <option value="true">Approved</option>
              <option value="false">Not Approved</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setStyleFilter(""); }}
              disabled={isRunning || christmas}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
            >
              <option value="">All types</option>
              {Object.keys(taxonomy).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              value={styleFilter}
              onChange={(e) => setStyleFilter(e.target.value)}
              disabled={isRunning || christmas || !typeFilter}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
            >
              <option value="">All styles</option>
              {(taxonomy[typeFilter] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={bestseller}
                  onChange={(e) => setBestseller(e.target.checked)}
                  disabled={isRunning}
                  className="rounded border-gray-300"
                />
                Bestseller
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={christmas}
                  onChange={(e) => { setChristmas(e.target.checked); if (e.target.checked) { setTypeFilter(""); setStyleFilter(""); } }}
                  disabled={isRunning}
                  className="rounded border-gray-300"
                />
                Christmas
              </label>
            </div>
          </div>

          {/* Product count + cost estimate */}
          {phase === "idle" && (
            <div className="flex items-center gap-4 mb-5">
              <span className="text-sm text-gray-500">
                {countLoading
                  ? "Counting…"
                  : productCount === null
                    ? ""
                    : `${productCount} product${productCount !== 1 ? "s" : ""}`}
              </span>
              {productCount !== null && productCount > 0 && (
                <span className="text-xs text-gray-400">
                  Estimated total AI cost: {formatCost(productCount)}
                </span>
              )}
            </div>
          )}

          {/* Idle state */}
          {phase === "idle" && (
            <button
              onClick={runReport}
              disabled={productCount === 0}
              className="px-5 py-2.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-40"
            >
              Run Report
            </button>
          )}

          {/* Error state */}
          {phase === "error" && (
            <div className="space-y-3">
              <p className="text-sm text-red-600">{fatalError}</p>
              <button
                onClick={runReport}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded hover:bg-gray-700"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Loading state */}
          {phase === "loading" && (
            <div className="space-y-4 max-w-sm">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-600">{stageLabel}</span>
                  <span className="text-xs text-gray-400">
                    {progress.total > 0
                      ? `${progress.done} / ${progress.total}`
                      : progress.done > 0 ? `${progress.done} loaded` : ""}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gray-800 rounded-full transition-all duration-300 ${progress.total === 0 ? "animate-pulse" : ""}`}
                    style={{ width: progress.total > 0 ? `${Math.min(100, (progress.done / progress.total) * 100)}%` : "30%" }}
                  />
                </div>
              </div>
              {stageLabel === "Running AI checks" && (
                <p className="text-xs text-gray-400">
                  AI checks running — this may take a minute for larger catalogues.
                </p>
              )}
              <button
                onClick={cancel}
                className="text-xs text-gray-400 hover:text-gray-600 underline"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Results */}
          {(phase === "done" || (phase === "loading" && flagged.length > 0)) && (
            <div className="space-y-5">
              {phase === "done" && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div>
                    <span className="text-sm text-gray-600">
                      {flagged.length === 0
                        ? `${checkedTotal} products checked — no issues found`
                        : `${flagged.length} of ${checkedTotal} products have issues`}
                    </span>
                    {lastRunAt && (
                      <span className="text-xs text-gray-400 ml-2">
                        · Run {new Date(lastRunAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={runReport}
                    className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-2 py-0.5 rounded"
                  >
                    Re-run
                  </button>
                  <button
                    onClick={clearReport}
                    className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 px-2 py-0.5 rounded"
                  >
                    Clear report
                  </button>
                </div>
              )}

              {aiError && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  {aiError}
                </p>
              )}

              {saveError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  ⚠ {saveError}
                </p>
              )}

              {flagged.length > 0 && (
                <>
                  {/* Check type summary chips */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setFilterCheckId("all")}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        filterCheckId === "all"
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      All issues ({flagged.length})
                    </button>
                    {ALL_CHECK_IDS.filter((id) => countByCheck[id] > 0).map((id) => (
                      <button
                        key={id}
                        onClick={() => setFilterCheckId(filterCheckId === id ? "all" : id)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          filterCheckId === id
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {CHECK_META[id]?.label ?? id} ({countByCheck[id]})
                      </button>
                    ))}
                  </div>

                  {/* Results table */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200">
                          <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Product</th>
                          <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide w-40">Type</th>
                          <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Issues</th>
                          <th className="px-4 py-2.5 w-20"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filtered.map((product) => (
                          <tr key={product.productId} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                {product.imageUrl ? (
                                  <img
                                    src={product.imageUrl}
                                    alt=""
                                    className="w-10 h-10 object-cover rounded shrink-0 bg-gray-100"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded bg-gray-100 shrink-0" />
                                )}
                                <span className="font-medium text-gray-900 leading-snug">{product.title}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">
                              {product.productTypePt || <span className="text-gray-300">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {product.issues.map((issue, idx) => (
                                  <span
                                    key={idx}
                                    className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-default ${CHECK_META[issue.checkId]?.color ?? "bg-gray-100 text-gray-600"}`}
                                  >
                                    {CHECK_META[issue.checkId]?.label ?? issue.label}
                                  </span>
                                ))}
                              </div>
                              {/* Details line */}
                              <div className="mt-1 space-y-1">
                                {product.issues.map((issue, idx) => (
                                  <div key={idx}>
                                    <p className="text-xs text-gray-400">{issue.detail}</p>
                                    {issue.checkId === "duplicate-icons" && issue.meta?.duplicateIconPhrases && (
                                      <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                                        {issue.meta.duplicateIconPhrases.map((item, i) => (
                                          <span key={i} className="flex items-center gap-1 text-xs text-gray-500">
                                            <img src={`/icons/${item.iconKey}.svg`} alt="" className="w-3.5 h-3.5 opacity-50" />
                                            {item.phrase}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <a
                                href={`/products?id=${numericId(product.productId)}`}
                                className="text-xs text-gray-500 hover:text-gray-900 border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                              >
                                Edit
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {filtered.length === 0 && (
                      <p className="text-center text-sm text-gray-400 py-8">
                        No products match this filter.
                      </p>
                    )}
                  </div>
                </>
              )}

              {phase === "done" && flagged.length === 0 && checkedTotal > 0 && (
                <div className="text-center py-16 text-gray-400">
                  <p className="text-2xl mb-2">✓</p>
                  <p className="text-sm">All content looks good!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
