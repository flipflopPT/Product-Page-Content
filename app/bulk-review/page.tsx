"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Nav from "@/components/Nav";
import { Tooltip } from "@/components/Tooltip";
import type { ProductSummary } from "@/lib/types";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";

const WCT_SLOT_ICONS = [
  <svg key="1" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  <svg key="2" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  <svg key="3" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>,
  <svg key="4" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="9" width="18" height="11" rx="1"/><path d="M3 13h18M12 9v11"/><path d="M8.5 9c-1.5 0-2.5-1-2.5-2.5S7 4 8.5 4c2 0 3.5 5 3.5 5s1.5-5 3.5-5S18 5 18 6.5 17 9 15.5 9"/></svg>,
];

interface ContentRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  productTypePt: string;
  productStylePt: string;
  summary: string;
  wctBullets: [string, string, string, string];
  pfBullets: [string, string, string, string];
  pfIcons: [string, string, string, string];
  skip: boolean;
  regenerating: boolean;
}

export default function BulkReviewPage() {
  const [rows, setRows] = useState<ContentRow[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const originalRows = useRef<Map<string, ContentRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ saved: number; failed: number } | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bestseller, setBestseller] = useState(false);
  const [contentFilter, setContentFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>(PRODUCT_TAXONOMY);
  const cursorRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const fetchTotalCount = useCallback(async (signal?: AbortSignal) => {
    setTotalCount(null);
    const params = new URLSearchParams();
    if (contentFilter) params.set("status", contentFilter);
    if (search) params.set("search", search);
    if (bestseller) params.set("bestseller", "true");
    try {
      const res = await fetch(`/api/products/count?${params}`, { signal });
      if (!res.ok) return;
      setTotalCount((await res.json()).count);
    } catch { /* abort or network error — leave count as null (shows fallback) */ }
  }, [search, bestseller, contentFilter]);

  const fetchPage = useCallback(async (reset: boolean, signal?: AbortSignal) => {
    setLoading(true);
    if (reset) setFetchError(null);
    const params = new URLSearchParams();
    if (contentFilter) params.set("status", contentFilter);
    if (search) params.set("search", search);
    if (bestseller) params.set("bestseller", "true");
    params.set("limit", String(pageSize));
    if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);

    try {
      const res = await fetch(`/api/products?${params}`, { signal });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setFetchError(errData.error ?? "Failed to load products — please try refreshing.");
        setLoading(false);
        return;
      }
      const data: { products: ProductSummary[]; nextCursor: string | null } = await res.json();

      if (data.products.length > 0) {
        const contentRes = await fetch("/api/bulk-content-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: data.products.map((p) => p.id), readOnly: true }),
          signal,
        });
        if (!contentRes.ok) {
          setFetchError("Failed to load product content — please try refreshing.");
          setLoading(false);
          return;
        }
        const contentData: { rows: ContentRow[] } = await contentRes.json();
        if (signal?.aborted) return;
        contentData.rows.forEach((r) => {
          if (!originalRows.current.has(r.productId)) {
            originalRows.current.set(r.productId, { ...r });
          }
        });
        if (reset) {
          setRows(contentData.rows);
        } else {
          setRows((prev) => [...prev, ...contentData.rows]);
        }
      } else if (reset) {
        setRows([]);
      }

      cursorRef.current = data.nextCursor;
      setNextCursor(data.nextCursor);
      setLoading(false);
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setFetchError("Network error — please check your connection and try again.");
        setLoading(false);
      }
    }
  }, [search, bestseller, contentFilter, pageSize]);

  useEffect(() => {
    fetch("/api/taxonomy")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.taxonomy) setTaxonomy(d.taxonomy); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    cursorRef.current = null;
    originalRows.current = new Map();
    setDirty(new Set());
    setSaveResult(null);
    fetchPage(true, controller.signal);
    fetchTotalCount(controller.signal);
    return () => controller.abort();
  }, [fetchPage, fetchTotalCount]);

  const filteredRows = rows.filter((r) => {
    if (typeFilter && r.productTypePt !== typeFilter) return false;
    if (styleFilter) {
      const styles = r.productStylePt ? r.productStylePt.split(",").map((s) => s.trim()) : [];
      if (!styles.includes(styleFilter)) return false;
    }
    return true;
  });

  function updateRow(productId: string, patch: Partial<ContentRow>) {
    setRows((prev) => prev.map((r) => r.productId === productId ? { ...r, ...patch } : r));
    setDirty((prev) => new Set(prev).add(productId));
    setSaveResult(null);
  }

  async function handleSave() {
    const toSave = rows.filter((r) => dirty.has(r.productId));
    if (toSave.length === 0) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/bulk-content-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: toSave.map((r) => ({
            productId: r.productId,
            productTypePt: r.productTypePt,
            productStylePt: r.productStylePt,
            summary: r.summary,
            wctBullets: r.wctBullets,
            pfBullets: r.pfBullets,
            pfIcons: r.pfIcons,
          })),
        }),
      });
      const data = res.ok ? await res.json() : { saved: 0, failed: toSave.length };
      setSaveResult(data);
      setDirty(new Set());
    } catch {
      setSaveResult({ saved: 0, failed: toSave.length });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-screen">
      <Nav active="bulk-review" helpText={"Review and fine-tune product content across all your products in one table.\nEdit text directly in each row, revert changes you don't like, then save everything with one button."} />

      <div className="border-b border-gray-200 px-4 py-3 flex gap-3 items-center bg-white shrink-0 sticky top-0 z-10 flex-wrap">
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
          value={contentFilter}
          onChange={(e) => setContentFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All Products</option>
          <option value="partial">Partial Content</option>
          <option value="complete">Complete</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setStyleFilter(""); }}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All types</option>
          {Object.keys(taxonomy).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={styleFilter}
          onChange={(e) => setStyleFilter(e.target.value)}
          disabled={!typeFilter || (taxonomy[typeFilter] ?? []).length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-40"
        >
          <option value="">All styles</option>
          {(taxonomy[typeFilter] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-sm text-gray-400">
          {loading && rows.length === 0
            ? "Loading..."
            : (typeFilter || styleFilter)
              ? `${filteredRows.length} product${filteredRows.length !== 1 ? "s" : ""}`
              : totalCount === null
                ? `${filteredRows.length}${nextCursor ? "+" : ""} product${filteredRows.length !== 1 ? "s" : ""}`
                : `${filteredRows.length} of ${totalCount} product${totalCount !== 1 ? "s" : ""}`}
        </span>
        <div className="ml-auto flex items-center gap-3">
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
          {saveResult && (
            <span className={`text-sm ${saveResult.failed > 0 ? "text-red-600" : "text-green-600"}`}>
              {saveResult.failed > 0 ? `${saveResult.failed} failed to save` : `${saveResult.saved} saved`}
            </span>
          )}
          {dirty.size > 0 && (
            <Tooltip content="Save all your edited products to Shopify. Only amber (edited) rows will be saved." side="bottom">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-70"
              >
                {saving ? "Saving..." : `Save ${dirty.size} change${dirty.size !== 1 ? "s" : ""}`}
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading products…</div>
        ) : !loading && fetchError ? (
          <div className="p-8 text-center text-red-500 text-sm">{fetchError}</div>
        ) : !loading && filteredRows.length === 0 && rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No products found.</div>
        ) : !loading && filteredRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No matching products in this page — try loading more.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredRows.map((row) => (
              <RowEditor
                key={row.productId}
                row={row}
                isDirty={dirty.has(row.productId)}
                onChange={(patch) => updateRow(row.productId, patch)}
                onRevert={() => {
                  const original = originalRows.current.get(row.productId);
                  if (original) {
                    setRows((prev) => prev.map((r) => r.productId === row.productId ? { ...original } : r));
                    setDirty((prev) => { const next = new Set(prev); next.delete(row.productId); return next; });
                  }
                }}
              />
            ))}
          </div>
        )}

        {nextCursor && !loading && !typeFilter && !styleFilter && (
          <div className="p-4 text-center">
            <button
              onClick={() => fetchPage(false, controllerRef.current?.signal)}
              className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
            >
              Load more
            </button>
          </div>
        )}

        {loading && rows.length > 0 && (
          <div className="p-4 text-center text-gray-400 text-sm">Loading more...</div>
        )}
      </div>
    </div>
  );
}

function RowEditor({
  row,
  isDirty,
  onChange,
  onRevert,
}: {
  row: ContentRow;
  isDirty: boolean;
  onChange: (patch: Partial<ContentRow>) => void;
  onRevert: () => void;
}) {
  const hasNoContent = !row.summary && row.wctBullets.every((b) => !b) && row.pfBullets.every((b) => !b);

  return (
    <div className={`grid grid-cols-[10rem_13rem_7rem_4fr_3fr_2fr] gap-4 p-4 transition-colors ${isDirty ? "bg-amber-50" : hasNoContent ? "bg-gray-100" : "bg-white hover:bg-gray-50"} ${hasNoContent ? "opacity-70" : ""}`}>
      {/* Col 1: Image + title */}
      <div>
        {row.imageUrl ? (
          <img src={row.imageUrl} alt={row.title} className="w-20 aspect-square object-cover rounded mb-2" />
        ) : (
          <div className="w-20 aspect-square bg-gray-100 rounded mb-2" />
        )}
        <p className="text-sm font-medium text-gray-800 leading-snug">{row.title}</p>
        {hasNoContent && (
          <Tooltip content="This product has no marketing content. Go to Bulk Assign to generate some.">
            <span className="text-xs text-gray-400 mt-1 block cursor-default">No content</span>
          </Tooltip>
        )}
        {!hasNoContent && isDirty && (
          <>
            <Tooltip content="You've made edits to this product that haven't been saved yet.">
              <span className="text-xs text-amber-600 mt-1 block cursor-default">Unsaved</span>
            </Tooltip>
            <Tooltip content="Undo your edits and go back to the last saved version of this product.">
              <button onClick={onRevert} className="text-xs text-gray-400 hover:text-gray-600 underline mt-0.5 block">Revert changes</button>
            </Tooltip>
          </>
        )}
      </div>

      {/* Col 2: Type */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">Type</label>
          <a
            href={`/products?id=${row.productId.split("/").pop()}`}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            Edit →
          </a>
        </div>
        <p className="text-sm text-gray-700">{row.productTypePt || <span className="text-gray-300">— none —</span>}</p>
      </div>

      {/* Col 3: Style */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Style</label>
        <p className="text-sm text-gray-700 leading-snug">
          {row.productStylePt
            ? row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean).join(", ")
            : <span className="text-gray-300">—</span>}
        </p>
      </div>

      {/* Col 4: Product Summary */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Product Summary</label>
        <textarea
          value={row.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          rows={6}
          disabled={hasNoContent}
          className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
        />
      </div>

      {/* Col 5: Why Choose This */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">Why Choose This</label>
          <a
            href={`/products?id=${row.productId.split("/").pop()}`}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            Edit →
          </a>
        </div>
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded bg-gray-50">
          {row.wctBullets.map((bullet, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-gray-700 px-3 py-1.5 min-h-[2rem]">
              <span className="shrink-0 opacity-40">{WCT_SLOT_ICONS[i]}</span>
              {bullet
                ? <span dangerouslySetInnerHTML={{ __html: bullet }} />
                : <span className="text-gray-300">—</span>}
            </li>
          ))}
        </ul>
      </div>

      {/* Col 6: Perfect For */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500">Perfect For</label>
          <a
            href={`/products?id=${row.productId.split("/").pop()}`}
            className="text-xs text-blue-500 hover:text-blue-700"
          >
            Edit →
          </a>
        </div>
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded bg-gray-50">
          {row.pfBullets.map((bullet, i) => {
            const icon = row.pfIcons[i];
            return (
              <li key={i} className="flex items-center gap-2 text-sm text-gray-700 px-3 py-1.5 min-h-[2rem]">
                {icon && (
                  icon.startsWith("<svg") ? (
                    <span className="w-4 h-4 shrink-0 opacity-60 [&>svg]:w-4 [&>svg]:h-4" dangerouslySetInnerHTML={{ __html: icon }} />
                  ) : icon.startsWith("https://") ? (
                    <img src={icon} alt="" className="w-4 h-4 shrink-0 opacity-60" />
                  ) : (
                    <img src={`/icons/${icon}.svg`} alt={icon} className="w-4 h-4 shrink-0 opacity-60" />
                  )
                )}
                {bullet || <span className="text-gray-300">—</span>}
              </li>
            );
          })}
        </ul>
      </div>

    </div>
  );
}
