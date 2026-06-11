"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import ProductList from "@/components/ProductList";
import ProductEditor from "@/components/ProductEditor";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";
import type { ProductSummary } from "@/lib/types";

export default function ProductsPage() {
  return (
    <Suspense>
      <ProductsPageInner />
    </Suspense>
  );
}

function ProductsPageInner() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [bestseller, setBestseller] = useState(false);
  const [christmas, setChristmas] = useState(false);
  const [reviewedFilter, setReviewedFilter] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>(PRODUCT_TAXONOMY);
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id") ? `gid://shopify/Product/${searchParams.get("id")}` : null
  );

  const fetchTotalCount = useCallback(async () => {
    setTotalCount(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (styleFilter) params.set("style", styleFilter);
    if (bestseller) params.set("bestseller", "true");
    if (christmas) params.set("christmas", "true");
    if (reviewedFilter) params.set("reviewed", reviewedFilter);
    try {
      const res = await fetch(`/api/products/count?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setTotalCount(data.count);
    } catch { /* network error — leave count as null */ }
  }, [search, statusFilter, typeFilter, styleFilter, bestseller, christmas, reviewedFilter]);

  const fetchProducts = useCallback(async (reset = true) => {
    setLoading(true);
    if (reset) { setProducts([]); setNextCursor(null); setFetchError(null); }
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (styleFilter) params.set("style", styleFilter);
    if (bestseller) params.set("bestseller", "true");
    if (christmas) params.set("christmas", "true");
    if (reviewedFilter) params.set("reviewed", reviewedFilter);
    params.set("limit", String(pageSize));
    if (!reset && nextCursor) params.set("cursor", nextCursor);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      setFetchError(errData.error ?? "Failed to load products — please try refreshing.");
      setLoading(false);
      return;
    }
    const data = await res.json();

    setProducts((prev) => reset ? data.products : [...prev, ...data.products]);
    setNextCursor(data.nextCursor);
    setLoading(false);
  }, [search, statusFilter, typeFilter, styleFilter, bestseller, christmas, reviewedFilter, pageSize, nextCursor]);

  useEffect(() => {
    fetch("/api/taxonomy")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.taxonomy) setTaxonomy(d.taxonomy); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchProducts(true);
    // Delay count by 1s so it doesn't fire simultaneously with the list and exhaust the Shopify rate-limit bucket.
    const timer = setTimeout(() => fetchTotalCount(), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, typeFilter, styleFilter, bestseller, christmas, reviewedFilter, pageSize]);

  const selectedProduct = products.find((p) => p.id === selectedId) ?? null;

  function handleSaved() {
    fetchProducts(true);
  }

  function handleChristmasToggle(checked: boolean) {
    setChristmas(checked);
    if (checked) {
      setTypeFilter("");
      setStyleFilter("");
      setStatusFilter("");
      setReviewedFilter("");
    }
    setSelectedId(null);
  }

  return (
    <div className="flex flex-col h-screen">
      <Nav active="products" helpText={"Browse and edit individual products.\nSelect a product from the list on the left to update its Type and Style classification, Why People Love This bullet points, and Perfect For phrases.\nChanges save to Shopify when you click Save."} />

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
        <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={christmas}
            onChange={(e) => handleChristmasToggle(e.target.checked)}
            className="rounded border-gray-300"
          />
          Christmas Tag
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Content Status</option>
          <option value="missing">No Content</option>
          <option value="partial">Partial Content</option>
          <option value="complete">Complete</option>
        </select>
        <select
          value={reviewedFilter}
          onChange={(e) => setReviewedFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">Approval Status</option>
          <option value="true">Approved</option>
          <option value="false">Not Approved</option>
        </select>
        {!christmas && (
          <>
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
          </>
        )}
        <span className="text-sm text-gray-400">
          {loading && products.length === 0
            ? "Loading..."
            : totalCount === null
              ? `${products.length}${nextCursor ? "+" : ""} product${products.length !== 1 ? "s" : ""}`
              : `${products.length} of ${totalCount} product${totalCount !== 1 ? "s" : ""}`}
        </span>
        <div className="flex-1" />
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value={10}>10 per page</option>
          <option value={25}>25 per page</option>
          <option value={50}>50 per page</option>
        </select>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Product list */}
        <div className={`${selectedId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 border-r border-gray-200 bg-white`}>
          {fetchError ? (
            <div className="flex-1 flex items-center justify-center p-4 text-red-500 text-sm text-center">{fetchError}</div>
          ) : (
            <ProductList
              products={products}
              loading={loading}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onLoadMore={nextCursor ? () => fetchProducts(false) : undefined}
            />
          )}
        </div>

        {/* Editor panel */}
        {selectedId ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="md:hidden p-3 border-b border-gray-200">
              <button
                onClick={() => setSelectedId(null)}
                className="text-gray-500 text-sm hover:text-gray-800"
              >
                ← Back to list
              </button>
            </div>
            <ProductEditor
              productId={selectedId.replace("gid://shopify/Product/", "")}
              productTitle={selectedProduct?.title ?? ""}
              onSaved={handleSaved}
              onClose={() => setSelectedId(null)}
              isChristmas={christmas}
            />
          </div>
        ) : (
          <div className="hidden md:flex flex-1 items-center justify-center text-gray-400">
            Select a product to edit
          </div>
        )}
      </div>

    </div>
  );
}
