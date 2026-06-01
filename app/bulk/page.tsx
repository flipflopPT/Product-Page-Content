"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Nav from "@/components/Nav";
import type { ProductSummary } from "@/lib/types";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";

// ── Types ────────────────────────────────────────────────────────────────────

interface ClassifyRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  suggestedType: string;
  suggestedStyles: string[];
  existingType: string;
  existingStyle: string;
  selectedType: string;
  selectedStyles: string[];
  skip: boolean;
  error?: string;
}

type ClassifyPhase = "idle" | "streaming" | "review" | "saving" | "saved";
type ContentPhase  = "idle" | "loading" | "review" | "saving" | "saved";

interface ContentRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  productTypePt: string;
  productStylePt: string;
  summary: string;
  wctBullets: [string, string, string, string];
  pfBullets:  [string, string, string, string];
  pfIcons:    [string, string, string, string];
  skip: boolean;
  regenerating: boolean;
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function ClassifyBadge({ status }: { status: ProductSummary["classifyStatus"] }) {
  if (status === "complete")
    return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Type and Style set</span>;
  if (status === "partial")
    return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">Part. classified</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">No Type and Style set</span>;
}

function ContentBadge({ status }: { status: ProductSummary["contentStatus"] }) {
  if (status === "complete")
    return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Content set</span>;
  if (status === "partial")
    return <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">Partial content</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">No Content set</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BulkPage() {
  // Product list state
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("needs-classify");
  const [bestseller, setBestseller] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(25);
  const cursorRef = useRef<string | null>(null);

  // Content review workflow state
  const [contentRows, setContentRows] = useState<ContentRow[]>([]);
  const [contentPhase, setContentPhase] = useState<ContentPhase>("idle");
  const [contentSaveResult, setContentSaveResult] = useState<{ saved: number; failed: number } | null>(null);

  // Classify workflow state
  const [classifyRows, setClassifyRows] = useState<ClassifyRow[]>([]);
  const [classifyPhase, setClassifyPhase] = useState<ClassifyPhase>("idle");
  const [classifySaveResult, setClassifySaveResult] = useState<{ saved: number; failed: number } | null>(null);
  const classifyPanelRef = useRef<HTMLDivElement>(null);

  // Total count
  const [totalCount, setTotalCount] = useState<number | null>(null);

  // Image modal
  const [modalImage, setModalImage] = useState<string | null>(null);

  // ── Product fetching ─────────────────────────────────────────────────────

  const fetchTotalCount = useCallback(async () => {
    setTotalCount(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
    const res = await fetch(`/api/products/count?${params}`);
    if (res.ok) {
      const data = await res.json();
      setTotalCount(data.count);
    }
  }, [search, statusFilter, bestseller]);

  const fetchProducts = useCallback(async (reset: boolean) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
    params.set("limit", String(pageSize));
    if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();

    setProducts((prev) => (reset ? data.products : [...prev, ...data.products]));
    setNextCursor(data.nextCursor);
    cursorRef.current = data.nextCursor;
    setLoading(false);
  }, [search, statusFilter, bestseller, pageSize]);

  useEffect(() => {
    cursorRef.current = null;
    fetchProducts(true);
    fetchTotalCount();
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, bestseller, pageSize]);

  // ── Selection helpers ────────────────────────────────────────────────────

  const filteredProducts = typeFilter
    ? products.filter((p) => p.productTypePt === typeFilter)
    : products;

  const allFilteredIds = filteredProducts.map((p) => p.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));
  const someSelected = allFilteredIds.some((id) => selectedIds.has(id));

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) allFilteredIds.forEach((id) => next.delete(id));
      else allFilteredIds.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // ── Classify workflow ────────────────────────────────────────────────────

  async function handleClassify() {
    const ids = [...selectedIds];
    if (ids.length === 0 || classifyPhase !== "idle") return;

    setClassifyRows([]);
    setClassifyPhase("streaming");
    setClassifySaveResult(null);

    const res = await fetch("/api/bulk-classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: ids }),
    });

    if (!res.ok || !res.body) { setClassifyPhase("review"); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "result") {
            setClassifyRows((prev) => [
              ...prev,
              {
                productId: event.productId,
                title: event.title,
                imageUrl: event.imageUrl ?? null,
                suggestedType: event.suggestedType,
                suggestedStyles: event.suggestedStyles,
                existingType: event.existingType,
                existingStyle: event.existingStyle,
                selectedType: event.suggestedType,
                selectedStyles: event.suggestedStyles,
                skip: !!event.error,
                error: event.error,
              },
            ]);
            setTimeout(() => {
              if (classifyPanelRef.current)
                classifyPanelRef.current.scrollTop = classifyPanelRef.current.scrollHeight;
            }, 0);
          } else if (event.type === "done") {
            setClassifyPhase("review");
          }
        } catch { /* ignore */ }
      }
    }

    setClassifyPhase("review");
  }

  function handleTypeChange(productId: string, newType: string) {
    const validStyles = PRODUCT_TAXONOMY[newType] ?? [];
    setClassifyRows((prev) =>
      prev.map((r) =>
        r.productId !== productId ? r : {
          ...r,
          selectedType: newType,
          selectedStyles: r.selectedStyles.filter((s) => validStyles.includes(s)),
        }
      )
    );
  }

  function handleStyleToggle(productId: string, style: string, checked: boolean) {
    setClassifyRows((prev) =>
      prev.map((r) => {
        if (r.productId !== productId) return r;
        const next = checked
          ? [...r.selectedStyles, style]
          : r.selectedStyles.filter((s) => s !== style);
        return { ...r, selectedStyles: next };
      })
    );
  }

  function handleSkipToggle(productId: string, skip: boolean) {
    setClassifyRows((prev) => prev.map((r) => r.productId !== productId ? r : { ...r, skip }));
  }

  async function handleSaveClassify() {
    if (classifyPhase !== "review") return;

    const assignments = classifyRows
      .filter((r) => !r.skip && !r.error && r.selectedType && r.selectedStyles.length > 0)
      .map((r) => ({ productId: r.productId, type: r.selectedType, styles: r.selectedStyles }));

    if (assignments.length === 0) return;

    setClassifyPhase("saving");

    const res = await fetch("/api/bulk-classify/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments }),
    });

    const data = await res.json();
    setClassifySaveResult({ saved: data.saved, failed: data.failed });
    setClassifyPhase("saved");
  }

  function handleCloseClassify() {
    const wasSaved = classifyPhase === "saved";
    setClassifyPhase("idle");
    setClassifyRows([]);
    setClassifySaveResult(null);
    if (wasSaved) {
      setSelectedIds(new Set());
      cursorRef.current = null;
      fetchProducts(true);
    }
  }

  const approvedCount = classifyRows.filter(
    (r) => !r.skip && !r.error && r.selectedType && r.selectedStyles.length > 0
  ).length;

  // ── Content review workflow ───────────────────────────────────────────────

  async function handleSetContent() {
    const ids = selectedWithTypeStyle.map((p) => p.id);
    if (ids.length === 0 || contentPhase !== "idle") return;

    setContentPhase("loading");
    setContentRows([]);
    setContentSaveResult(null);

    const res = await fetch("/api/bulk-content-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: ids }),
    });

    if (!res.ok) { setContentPhase("idle"); return; }

    const data = await res.json();
    const rows: ContentRow[] = (data.rows as ContentRow[]).map((r) => ({
      ...r,
      skip: false,
    }));
    setContentRows(rows);
    setContentPhase("review");
  }

  async function handleRegenerateContent(productId: string) {
    setContentRows((rows) => rows.map((r) => r.productId === productId ? { ...r, regenerating: true } : r));

    const res = await fetch("/api/generate-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });

    if (res.ok) {
      const data = await res.json();
      setContentRows((rows) => rows.map((r) =>
        r.productId === productId
          ? { ...r, regenerating: false, summary: data.summary, wctBullets: data.wctBullets, pfBullets: data.pfBullets, pfIcons: data.pfIcons }
          : r
      ));
    } else {
      setContentRows((rows) => rows.map((r) => r.productId === productId ? { ...r, regenerating: false } : r));
    }
  }

  async function handleSaveContent() {
    const toSave = contentRows.filter((r) => !r.skip);
    if (toSave.length === 0 || contentPhase !== "review") return;

    setContentPhase("saving");

    const res = await fetch("/api/bulk-content-save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: toSave.map((r) => ({
          productId: r.productId,
          summary: r.summary,
          wctBullets: r.wctBullets,
          pfBullets: r.pfBullets,
          pfIcons: r.pfIcons,
        })),
      }),
    });

    const data = res.ok ? await res.json() : { saved: 0, failed: toSave.length };
    setContentSaveResult(data);
    setContentPhase("saved");
  }

  function handleCloseContent() {
    const wasSaved = contentPhase === "saved";
    setContentPhase("idle");
    setContentRows([]);
    setContentSaveResult(null);
    if (wasSaved) {
      setSelectedIds(new Set());
      cursorRef.current = null;
      fetchProducts(true);
    }
  }

  // ── Layout state ─────────────────────────────────────────────────────────

  const selectedCount = selectedIds.size;
  // Only products with both type AND style can have content populated
  const selectedWithTypeStyle = products.filter(
    (p) => selectedIds.has(p.id) && p.productTypePt && p.productStylePt
  );
  const populateCount = selectedWithTypeStyle.length;
  const showClassify = classifyPhase !== "idle";
  const showContent  = contentPhase !== "idle";
  const showRightPanel = showClassify || showContent;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen">
      <Nav active="bulk" />

      {/* Filter bar */}
      <div className="border-b border-gray-200 px-4 py-3 flex gap-3 items-center bg-white shrink-0 flex-wrap">
        <input
          type="search"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={bestseller}
            onChange={(e) => setBestseller(e.target.checked)}
            className="rounded border-gray-300"
          />
          Bestseller Tag
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All products</option>
          <option value="needs-classify">No Type and Style Set</option>
          <option value="ready-to-populate">No Content Set</option>
          <option value="complete">Complete</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setSelectedIds(new Set()); }}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All types</option>
          {Object.keys(PRODUCT_TAXONOMY).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="text-sm text-gray-400">
          {loading && products.length === 0
            ? "Loading..."
            : totalCount === null
              ? `${products.length}${nextCursor ? "+" : ""} product${products.length !== 1 ? "s" : ""}`
              : `${products.length} of ${totalCount} product${totalCount !== 1 ? "s" : ""}`}
        </span>
        <button
          onClick={toggleAll}
          disabled={filteredProducts.length === 0}
          className="text-sm text-blue-600 hover:underline disabled:opacity-40"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value={10}>10 per page</option>
          <option value={25}>25 per page</option>
          <option value={50}>50 per page</option>
          <option value={100}>100 per page</option>
        </select>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">

        {/* Product table */}
        <div className={`flex flex-col ${showRightPanel ? "w-1/2 border-r border-gray-200" : "w-full"} overflow-hidden`}>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                <tr>
                  <th className="w-10 px-4 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }}
                      onChange={toggleAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Product</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Type</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Style</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Step 1</th>
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Step 2</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredProducts.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-gray-50 cursor-pointer ${selectedIds.has(p.id) ? "bg-blue-50" : ""}`}
                    onClick={() => toggleOne(p.id)}
                  >
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-xs truncate">{p.title}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {p.productTypePt || <span className="text-red-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {p.productStylePt || <span className="text-red-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <ClassifyBadge status={p.classifyStatus} />
                    </td>
                    <td className="px-4 py-2.5">
                      <ContentBadge status={p.contentStatus} />
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">Loading…</td>
                  </tr>
                )}
                {!loading && filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">No products found</td>
                  </tr>
                )}
              </tbody>
            </table>
            {nextCursor && !loading && (
              <div className="p-4 text-center border-t border-gray-100">
                <button
                  onClick={() => fetchProducts(false)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Load more
                </button>
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          <div className="border-t border-gray-200 px-4 py-3 flex items-center gap-3 bg-white shrink-0 flex-wrap">
            <div className="flex-1" />
            <span className="text-sm text-gray-500">
              {selectedCount === 0 ? "None selected" : `${selectedCount} selected`}
            </span>
            <button
              onClick={handleClassify}
              disabled={selectedCount === 0 || classifyPhase !== "idle" || contentPhase !== "idle"}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              Set Type &amp; Style{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <button
              onClick={handleSetContent}
              disabled={populateCount === 0 || contentPhase !== "idle" || classifyPhase !== "idle"}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {contentPhase === "loading" ? "Loading…" : `Set Content${populateCount > 0 ? ` (${populateCount})` : ""}`}
            </button>
          </div>
        </div>

        {/* Right panel — classify or assign progress */}
        {showRightPanel && (
          <div className="w-1/2 flex flex-col bg-gray-50 overflow-hidden">

            {/* ── Classify panel ── */}
            {showClassify && (
              <>
                <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm text-gray-900">
                    {classifyPhase === "streaming" && "Classifying…"}
                    {classifyPhase === "review" && "Review Classifications"}
                    {classifyPhase === "saving" && "Saving…"}
                    {classifyPhase === "saved" && "Saved"}
                  </span>
                  {classifySaveResult && (
                    <span className="text-xs text-gray-500">
                      {classifySaveResult.saved} saved · {classifySaveResult.failed} failed
                    </span>
                  )}
                </div>

                <div ref={classifyPanelRef} className="flex-1 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                      <tr>
                        <th className="w-12 px-3 py-2"></th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Product</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Existing</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Type</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Style</th>
                        <th className="w-10 px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Skip</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {classifyRows.map((row) => (
                        <tr key={row.productId} className={`${row.skip ? "opacity-40" : ""} align-top`}>
                          {/* Thumbnail */}
                          <td className="px-3 py-2">
                            {row.imageUrl ? (
                              <button
                                onClick={() => setModalImage(row.imageUrl)}
                                className="block w-10 h-10 rounded overflow-hidden hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-shadow"
                                title="Click to enlarge"
                              >
                                <Image
                                  src={row.imageUrl}
                                  alt={row.title}
                                  width={40}
                                  height={40}
                                  className="w-10 h-10 object-cover"
                                  unoptimized
                                />
                              </button>
                            ) : (
                              <div className="w-10 h-10 rounded bg-gray-200" />
                            )}
                          </td>
                          {/* Title */}
                          <td className="px-3 py-2 text-gray-900 max-w-[120px]">
                            <span className="line-clamp-2 leading-tight">{row.title}</span>
                            {row.error && (
                              <span className="text-red-500 block mt-0.5">{row.error}</span>
                            )}
                          </td>
                          {/* Existing */}
                          <td className="px-3 py-2 text-gray-400 max-w-[100px]">
                            {row.existingType
                              ? <><div>{row.existingType}</div><div>{row.existingStyle}</div></>
                              : <span>—</span>
                            }
                          </td>
                          {/* Type dropdown */}
                          <td className="px-3 py-2">
                            {row.error ? null : (
                              <select
                                value={row.selectedType}
                                onChange={(e) => handleTypeChange(row.productId, e.target.value)}
                                disabled={row.skip || classifyPhase === "saving" || classifyPhase === "saved"}
                                className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                              >
                                <option value="">— choose —</option>
                                {Object.keys(PRODUCT_TAXONOMY).map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          {/* Style checkboxes */}
                          <td className="px-3 py-2">
                            {row.error || !row.selectedType ? null : (
                              <div className="flex flex-col gap-0.5">
                                {(PRODUCT_TAXONOMY[row.selectedType] ?? []).map((style) => (
                                  <label key={style} className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={row.selectedStyles.includes(style)}
                                      onChange={(e) => handleStyleToggle(row.productId, style, e.target.checked)}
                                      disabled={row.skip || classifyPhase === "saving" || classifyPhase === "saved"}
                                      className="rounded border-gray-300"
                                    />
                                    <span className="text-gray-700">{style}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </td>
                          {/* Skip toggle */}
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={row.skip}
                              onChange={(e) => handleSkipToggle(row.productId, e.target.checked)}
                              disabled={classifyPhase === "saving" || classifyPhase === "saved"}
                              className="rounded border-gray-300"
                            />
                          </td>
                        </tr>
                      ))}
                      {classifyPhase === "streaming" && classifyRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Starting…</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-gray-200 px-4 py-3 bg-white flex items-center gap-3 shrink-0">
                  <button
                    onClick={handleCloseClassify}
                    className="px-4 py-2 border border-gray-300 text-sm text-gray-600 rounded hover:bg-gray-50 transition-colors"
                  >
                    {classifyPhase === "saved" ? "Close and refresh list" : "Cancel"}
                  </button>
                  <div className="flex-1" />
                  {(classifyPhase === "review" || classifyPhase === "streaming") && (
                    <button
                      onClick={handleSaveClassify}
                      disabled={approvedCount === 0 || classifyPhase === "streaming"}
                      className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
                    >
                      {approvedCount > 0 ? `Save (${approvedCount})` : "Save"}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* ── Content review panel ── */}
            {showContent && (() => {
              const saveCount = contentRows.filter((r) => !r.skip).length;
              const anyRegenerating = contentRows.some((r) => r.regenerating);
              return (
                <>
                  <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
                    <span className="font-medium text-sm text-gray-900">
                      {contentPhase === "loading" && "Loading content…"}
                      {contentPhase === "review" && `Review Content (${contentRows.length})`}
                      {contentPhase === "saving" && "Saving…"}
                      {contentPhase === "saved" && "Saved"}
                    </span>
                    {contentSaveResult && (
                      <span className="text-xs text-gray-500">
                        {contentSaveResult.saved} saved · {contentSaveResult.failed} failed
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {contentPhase === "loading" && (
                      <div className="text-center text-gray-400 text-sm py-8">Loading…</div>
                    )}
                    {contentRows.map((row) => (
                      <div key={row.productId} className={`bg-white rounded-lg border border-gray-200 ${row.skip ? "opacity-40" : ""}`}>
                        {/* Product header */}
                        <div className="flex items-center gap-3 p-3 border-b border-gray-100">
                          {row.imageUrl ? (
                            <img src={row.imageUrl} alt="" className="w-10 h-10 object-cover rounded shrink-0" />
                          ) : (
                            <div className="w-10 h-10 bg-gray-100 rounded shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-gray-900 truncate">{row.title}</div>
                            <div className="text-xs text-gray-400">{row.productTypePt} · {row.productStylePt}</div>
                          </div>
                          <button
                            onClick={() => handleRegenerateContent(row.productId)}
                            disabled={row.skip || row.regenerating || anyRegenerating || contentPhase === "saving" || contentPhase === "saved"}
                            className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors shrink-0"
                          >
                            {row.regenerating ? "Regenerating…" : "Regenerate"}
                          </button>
                          <label className="flex items-center gap-1 text-xs text-gray-600 shrink-0 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={row.skip}
                              onChange={(e) => setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, skip: e.target.checked } : r))}
                              disabled={contentPhase === "saving" || contentPhase === "saved"}
                              className="rounded border-gray-300"
                            />
                            Skip
                          </label>
                        </div>

                        {/* Fields */}
                        <div className="p-3 space-y-3">
                          <div>
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Summary</label>
                            <textarea
                              value={row.summary}
                              onChange={(e) => setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, summary: e.target.value } : r))}
                              disabled={row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved"}
                              rows={3}
                              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 resize-none"
                            />
                          </div>

                          <div>
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Why Choose This</label>
                            <div className="space-y-1">
                              {row.wctBullets.map((bullet, i) => (
                                <input
                                  key={i}
                                  type="text"
                                  value={bullet}
                                  onChange={(e) => {
                                    const next = [...row.wctBullets] as [string, string, string, string];
                                    next[i] = e.target.value;
                                    setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, wctBullets: next } : r));
                                  }}
                                  disabled={row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved"}
                                  placeholder={`Bullet ${i + 1}`}
                                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                                />
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Perfect For</label>
                            <div className="space-y-1">
                              {row.pfBullets.map((bullet, i) => (
                                <input
                                  key={i}
                                  type="text"
                                  value={bullet}
                                  onChange={(e) => {
                                    const next = [...row.pfBullets] as [string, string, string, string];
                                    next[i] = e.target.value;
                                    setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, pfBullets: next } : r));
                                  }}
                                  disabled={row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved"}
                                  placeholder={`Bullet ${i + 1}`}
                                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-200 px-4 py-3 bg-white flex items-center gap-3 shrink-0">
                    <button
                      onClick={handleCloseContent}
                      className="px-4 py-2 border border-gray-300 text-sm text-gray-600 rounded hover:bg-gray-50 transition-colors"
                    >
                      {contentPhase === "saved" ? "Close and refresh list" : "Cancel"}
                    </button>
                    <div className="flex-1" />
                    {(contentPhase === "review" || contentPhase === "saving") && (
                      <button
                        onClick={handleSaveContent}
                        disabled={saveCount === 0 || contentPhase === "saving"}
                        className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
                      >
                        {saveCount > 0 ? `Save (${saveCount})` : "Save"}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

          </div>
        )}
      </div>

      {/* Image modal */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setModalImage(null)}
        >
          <div
            className="relative max-w-2xl max-h-[80vh] rounded-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={modalImage}
              alt="Product image"
              width={640}
              height={640}
              className="max-w-full max-h-[80vh] object-contain"
              unoptimized
            />
            <button
              onClick={() => setModalImage(null)}
              className="absolute top-2 right-2 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
