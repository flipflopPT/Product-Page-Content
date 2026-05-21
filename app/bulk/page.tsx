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

interface ProgressEntry {
  productId: string;
  title: string;
  status: "ok" | "skipped" | "error";
  summaryStatus?: "generated" | "failed";
  message?: string;
}

interface DoneStats {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ProductSummary["contentStatus"] }) {
  if (status === "complete")
    return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Complete</span>;
  if (status === "partial")
    return <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700">Partial</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600">Missing</span>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BulkPage() {
  // Product list state
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("missing");
  const [typeFilter, setTypeFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(25);
  const cursorRef = useRef<string | null>(null);

  // Assign workflow state
  const [skipComplete, setSkipComplete] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [progressLog, setProgressLog] = useState<ProgressEntry[]>([]);
  const [done, setDone] = useState<DoneStats | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // Classify workflow state
  const [classifyRows, setClassifyRows] = useState<ClassifyRow[]>([]);
  const [classifyPhase, setClassifyPhase] = useState<ClassifyPhase>("idle");
  const [classifySaveResult, setClassifySaveResult] = useState<{ saved: number; failed: number } | null>(null);
  const classifyPanelRef = useRef<HTMLDivElement>(null);

  // Image modal
  const [modalImage, setModalImage] = useState<string | null>(null);

  // ── Product fetching ─────────────────────────────────────────────────────

  const fetchProducts = useCallback(async (reset: boolean) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    params.set("limit", String(pageSize));
    if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json();

    setProducts((prev) => (reset ? data.products : [...prev, ...data.products]));
    setNextCursor(data.nextCursor);
    cursorRef.current = data.nextCursor;
    setLoading(false);
  }, [search, statusFilter, pageSize]);

  useEffect(() => {
    cursorRef.current = null;
    fetchProducts(true);
    setSelectedIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, pageSize]);

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

  // ── Assign workflow ──────────────────────────────────────────────────────

  async function handleAssign() {
    const ids = selectedWithTypeStyle.map((p) => p.id);
    if (ids.length === 0 || assigning) return;

    setAssigning(true);
    setProgressLog([]);
    setDone(null);

    try {
      const res = await fetch("/api/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids, skipComplete }),
      });

      if (!res.ok || !res.body) {
        setDone({ total: ids.length, succeeded: 0, skipped: 0, failed: ids.length });
        setAssigning(false);
        return;
      }

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
            if (event.type === "progress") {
              setProgressLog((prev) => [...prev, event as ProgressEntry]);
              setTimeout(() => {
                if (progressRef.current)
                  progressRef.current.scrollTop = progressRef.current.scrollHeight;
              }, 0);
            } else if (event.type === "done") {
              setDone(event as DoneStats);
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setDone({ total: ids.length, succeeded: 0, skipped: 0, failed: ids.length });
    }

    setAssigning(false);
  }

  function handleDone() {
    setDone(null);
    setProgressLog([]);
    setSelectedIds(new Set());
    cursorRef.current = null;
    fetchProducts(true);
  }

  // ── Layout state ─────────────────────────────────────────────────────────

  const selectedCount = selectedIds.size;
  // Only products with both type AND style can have content populated
  const selectedWithTypeStyle = products.filter(
    (p) => selectedIds.has(p.id) && p.productTypePt && p.productStylePt
  );
  const populateCount = selectedWithTypeStyle.length;
  const showClassify = classifyPhase !== "idle";
  const showAssign = assigning || done !== null;
  const showRightPanel = showClassify || showAssign;

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
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All products</option>
          <option value="missing">Missing content</option>
          <option value="partial">Partial content</option>
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
                  <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Status</th>
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
                      <StatusBadge status={p.contentStatus} />
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Loading…</td>
                  </tr>
                )}
                {!loading && filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">No products found</td>
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
            <button
              onClick={toggleAll}
              disabled={filteredProducts.length === 0}
              className="text-sm text-blue-600 hover:underline disabled:opacity-40"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={skipComplete}
                onChange={(e) => setSkipComplete(e.target.checked)}
                className="rounded border-gray-300"
              />
              Skip already complete
            </label>
            <div className="flex-1" />
            <span className="text-sm text-gray-500">
              {selectedCount === 0 ? "None selected" : `${selectedCount} selected`}
            </span>
            <button
              onClick={handleClassify}
              disabled={selectedCount === 0 || classifyPhase !== "idle" || assigning}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded disabled:opacity-40 hover:bg-gray-50 transition-colors"
            >
              Classify Type &amp; Style{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <button
              onClick={handleAssign}
              disabled={populateCount === 0 || assigning || classifyPhase !== "idle"}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              {assigning ? "Populating…" : `Populate Content${populateCount > 0 ? ` (${populateCount})` : ""}`}
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
                      Save {approvedCount > 0 ? `${approvedCount} approved` : ""}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* ── Assign progress panel ── */}
            {showAssign && (
              <>
                <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm text-gray-900">
                    {assigning ? "Populating content…" : "Done"}
                  </span>
                  {done && (
                    <span className="text-xs text-gray-500">
                      {done.succeeded} saved · {done.skipped} skipped · {done.failed} failed
                    </span>
                  )}
                </div>

                <div ref={progressRef} className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs">
                  {progressLog.map((entry, i) => (
                    <div
                      key={i}
                      className={`flex gap-2 items-start ${
                        entry.status === "ok" ? "text-green-700"
                        : entry.status === "skipped" ? "text-gray-400"
                        : "text-red-600"
                      }`}
                    >
                      <span className="shrink-0 select-none">
                        {entry.status === "ok" ? "✓" : entry.status === "skipped" ? "–" : "✗"}
                      </span>
                      <span className="break-all">{entry.title}</span>
                      {entry.status === "ok" && entry.summaryStatus === "failed" && (
                        <span className="shrink-0 text-yellow-600">(summary failed)</span>
                      )}
                      {entry.message && (
                        <span className="shrink-0 text-gray-400">({entry.message})</span>
                      )}
                    </div>
                  ))}
                  {assigning && progressLog.length === 0 && (
                    <div className="text-gray-400">Starting…</div>
                  )}
                </div>

                {done && (
                  <div className="border-t border-gray-200 px-4 py-3 bg-white shrink-0">
                    <button onClick={handleDone} className="text-sm text-blue-600 hover:underline">
                      Close and refresh list
                    </button>
                  </div>
                )}
              </>
            )}

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
