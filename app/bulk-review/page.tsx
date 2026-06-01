"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Nav from "@/components/Nav";
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
  seasonalOverrides: { mothersDay: boolean; fathersDay: boolean; valentinesDay: boolean };
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
  const [search, setSearch] = useState("");
  const [bestseller, setBestseller] = useState(false);
  const [contentFilter, setContentFilter] = useState("has-content");
  const [typeFilter, setTypeFilter] = useState("");
  const [seasonalFilter, setSeasonalFilter] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const cursorRef = useRef<string | null>(null);

  const fetchTotalCount = useCallback(async () => {
    setTotalCount(null);
    const params = new URLSearchParams({ status: contentFilter });
    if (search) params.set("search", search);
    if (bestseller) params.set("bestseller", "true");
    const res = await fetch(`/api/products/count?${params}`);
    if (res.ok) setTotalCount((await res.json()).count);
  }, [search, bestseller, contentFilter]);

  const fetchPage = useCallback(async (reset: boolean) => {
    setLoading(true);
    const params = new URLSearchParams({ status: contentFilter });
    if (search) params.set("search", search);
    if (bestseller) params.set("bestseller", "true");
    params.set("limit", String(pageSize));
    if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) { setLoading(false); return; }
    const data: { products: ProductSummary[]; nextCursor: string | null } = await res.json();

    if (data.products.length > 0) {
      const contentRes = await fetch("/api/bulk-content-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: data.products.map((p) => p.id) }),
      });
      const contentData: { rows: ContentRow[] } = contentRes.ok ? await contentRes.json() : { rows: [] };
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
  }, [search, bestseller, contentFilter, pageSize]);

  useEffect(() => {
    cursorRef.current = null;
    originalRows.current = new Map();
    setDirty(new Set());
    setSaveResult(null);
    fetchPage(true);
    fetchTotalCount();
  }, [fetchPage, fetchTotalCount]);

  const filteredRows = rows.filter((r) => {
    if (typeFilter && r.productTypePt !== typeFilter) return false;
    if (seasonalFilter === "mothersDay"    && !r.seasonalOverrides?.mothersDay)    return false;
    if (seasonalFilter === "fathersDay"    && !r.seasonalOverrides?.fathersDay)    return false;
    if (seasonalFilter === "valentinesDay" && !r.seasonalOverrides?.valentinesDay) return false;
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
          seasonalOverrides: r.seasonalOverrides,
        })),
      }),
    });
    const data = res.ok ? await res.json() : { saved: 0, failed: toSave.length };
    setSaveResult(data);
    setSaving(false);
    if (data.failed === 0) setDirty(new Set());
  }

  return (
    <div className="flex flex-col h-screen">
      <Nav active="bulk-review" />

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
          <option value="has-content">All Content</option>
          <option value="content-partial">Partial Content</option>
          <option value="complete">Complete</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All types</option>
          {Object.keys(PRODUCT_TAXONOMY).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={seasonalFilter}
          onChange={(e) => setSeasonalFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All occasions</option>
          <option value="mothersDay">Mother's Day</option>
          <option value="fathersDay">Father's Day</option>
          <option value="valentinesDay">Valentine's Day</option>
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
        <span className="text-sm text-gray-400">
          {loading && rows.length === 0
            ? "Loading..."
            : totalCount === null
              ? `${rows.length}${nextCursor ? "+" : ""} product${rows.length !== 1 ? "s" : ""}`
              : `${rows.length} of ${totalCount} product${totalCount !== 1 ? "s" : ""}`}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {saveResult && (
            <span className={`text-sm ${saveResult.failed > 0 ? "text-red-600" : "text-green-600"}`}>
              {saveResult.failed > 0 ? `${saveResult.failed} failed to save` : `${saveResult.saved} saved`}
            </span>
          )}
          {dirty.size > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : `Save ${dirty.size} change${dirty.size !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : !loading && filteredRows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No products found.</div>
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

        {nextCursor && !loading && (
          <div className="p-4 text-center">
            <button
              onClick={() => fetchPage(false)}
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
  return (
    <div className={`grid grid-cols-[10rem_13rem_7rem_4fr_7rem_3fr_2fr] gap-4 p-4 transition-colors ${isDirty ? "bg-amber-50" : "bg-white hover:bg-gray-50"}`}>
      {/* Col 1: Image + title */}
      <div>
        {row.imageUrl ? (
          <img src={row.imageUrl} alt={row.title} className="w-20 aspect-square object-cover rounded mb-2" />
        ) : (
          <div className="w-20 aspect-square bg-gray-100 rounded mb-2" />
        )}
        <p className="text-xs font-medium text-gray-800 leading-snug">{row.title}</p>
        {isDirty && (
          <>
            <span className="text-xs text-amber-600 mt-1 block">Unsaved</span>
            <button onClick={onRevert} className="text-xs text-gray-400 hover:text-gray-600 underline mt-0.5 block">Revert changes</button>
          </>
        )}
      </div>

      {/* Col 2: Type */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
        <select
          value={row.productTypePt}
          onChange={(e) => onChange({ productTypePt: e.target.value, productStylePt: "" })}
          className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— none —</option>
          {Object.keys(PRODUCT_TAXONOMY).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Col 3: Style */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Style</label>
        <div className="space-y-0.5">
          {(PRODUCT_TAXONOMY[row.productTypePt] ?? []).map((style) => {
            const selected = row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean);
            const checked = selected.includes(style);
            return (
              <label key={style} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked ? selected.filter((s) => s !== style) : [...selected, style];
                    onChange({ productStylePt: next.join(", ") });
                  }}
                  className="rounded border-gray-300"
                />
                {style}
              </label>
            );
          })}
          {!PRODUCT_TAXONOMY[row.productTypePt] && (
            <span className="text-xs text-gray-300">Select a type first</span>
          )}
        </div>
      </div>

      {/* Col 4: Product Summary */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Product Summary</label>
        <textarea
          value={row.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          rows={6}
          className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      {/* Col 5: Seasonal */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Seasonal</label>
        <div className="space-y-1">
          {([
            { key: "mothersDay",    label: "Mother's" },
            { key: "fathersDay",    label: "Father's" },
            { key: "valentinesDay", label: "Valentine's" },
          ] as const).map(({ key, label }) => (
            <label key={key} className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={row.seasonalOverrides?.[key] ?? false}
                onChange={() => onChange({
                  seasonalOverrides: {
                    ...(row.seasonalOverrides ?? { mothersDay: false, fathersDay: false, valentinesDay: false }),
                    [key]: !(row.seasonalOverrides?.[key] ?? false),
                  },
                })}
                className="rounded border-gray-300"
              />
              {label}
            </label>
          ))}
        </div>
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
