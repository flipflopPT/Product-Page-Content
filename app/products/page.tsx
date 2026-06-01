"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import ProductList from "@/components/ProductList";
import ProductEditor from "@/components/ProductEditor";
import type { ProductSummary } from "@/lib/types";

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bestseller, setBestseller] = useState(false);
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id") ? `gid://shopify/Product/${searchParams.get("id")}` : null
  );

  const fetchProducts = useCallback(async (reset = true) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
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
  }, [search, statusFilter, bestseller, nextCursor]);

  useEffect(() => {
    fetchProducts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, bestseller]);

  const selectedProduct = products.find((p) => p.id === selectedId) ?? null;

  function handleSaved() {
    fetchProducts(true);
  }

  return (
    <div className="flex flex-col h-screen">
      <Nav active="products" />
      <div className="flex flex-1 overflow-hidden">
        {/* Product list */}
        <div className={`${selectedId ? "hidden md:flex" : "flex"} flex-col w-full md:w-80 border-r border-gray-200 bg-white`}>
          <div className="p-3 border-b border-gray-200 space-y-2">
            <input
              type="search"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none px-0.5">
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
              className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All products</option>
              <option value="missing">No Content</option>
              <option value="partial">Partial Content</option>
              <option value="complete">Complete</option>
            </select>
          </div>
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
