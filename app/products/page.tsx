"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import ProductList from "@/components/ProductList";
import ProductEditor from "@/components/ProductEditor";
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
  const [bestseller, setBestseller] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id") ? `gid://shopify/Product/${searchParams.get("id")}` : null
  );

  const fetchTotalCount = useCallback(async () => {
    setTotalCount(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
    try {
      const res = await fetch(`/api/products/count?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setTotalCount(data.count);
    } catch { /* network error — leave count as null */ }
  }, [search, statusFilter, bestseller]);

  const fetchProducts = useCallback(async (reset = true) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
    params.set("limit", String(pageSize));
    if (!reset && nextCursor) params.set("cursor", nextCursor);

    const res = await fetch(`/api/products?${params}`);
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();

    setProducts((prev) => reset ? data.products : [...prev, ...data.products]);
    setNextCursor(data.nextCursor);
    setLoading(false);
  }, [search, statusFilter, bestseller, pageSize, nextCursor]);

  useEffect(() => {
    fetchProducts(true);
    fetchTotalCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, bestseller, pageSize]);

  const selectedProduct = products.find((p) => p.id === selectedId) ?? null;

  function handleSaved() {
    fetchProducts(true);
  }

  return (
    <div className="flex flex-col h-screen">
      <Nav active="products" />

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
          <option value="missing">No Content</option>
          <option value="partial">Partial Content</option>
          <option value="complete">Complete</option>
        </select>
        <span className="text-sm text-gray-400">
          {loading && products.length === 0
            ? "Loading..."
            : totalCount === null
              ? `${products.length}${nextCursor ? "+" : ""} product${products.length !== 1 ? "s" : ""}`
              : `${products.length} of ${totalCount} product${totalCount !== 1 ? "s" : ""}`}
        </span>
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

      <div className="flex flex-1 overflow-hidden">
        {/* Product list */}
        <div className={`${selectedId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 border-r border-gray-200 bg-white`}>
          <ProductList
            products={products}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onLoadMore={nextCursor ? () => fetchProducts(false) : undefined}
          />
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
