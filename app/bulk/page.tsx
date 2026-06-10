"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Nav from "@/components/Nav";
import SwapModal from "@/components/SwapModal";
import { Tooltip } from "@/components/Tooltip";
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
  source: "existing" | "generated";
  dirty: boolean;
  regenerating: boolean;
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
  source: "existing" | "generated" | "needs-classify";
  dirty: boolean;
  skip: boolean;
  regenerating: boolean;
  humanReviewed: boolean;
  summaryError?: { message: string; billingUrl?: string };
  regenerateError?: { message: string; billingUrl?: string };
}


const WCT_LABELS = ["Stands Out", "Gift Impact", "Trusted Pick", "Worth Keeping"];

function parseBullet(val: string): { text: string; subtext: string } {
  if (!val) return { text: "", subtext: "" };
  const m = val.match(/^<strong>(.*?)<\/strong>\s*(.*)/s);
  if (m) return { text: m[1], subtext: m[2] };
  return { text: val, subtext: "" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ClassifyBadge({ status }: { status: ProductSummary["classifyStatus"] }) {
  if (status === "complete")
    return <Tooltip content="This product already has a Product Type and Style assigned."><span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 cursor-default">Type and Style set</span></Tooltip>;
  if (status === "partial")
    return <Tooltip content="This product has a Type but no Style, or vice versa — it needs both before content can be generated."><span className="px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-700 cursor-default">Part. classified</span></Tooltip>;
  return <Tooltip content="This product hasn't been classified yet. Use Set Type & Style to assign one."><span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 cursor-default">No Type and Style set</span></Tooltip>;
}

function ContentBadge({ status }: { status: ProductSummary["contentStatus"] }) {
  if (status === "complete")
    return <Tooltip content="This product has its Why People Love This and Perfect For content filled in."><span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 cursor-default">Content set</span></Tooltip>;
  if (status === "partial")
    return <Tooltip content="Some content fields are filled in but not all. Edit the product to complete it."><span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 cursor-default">Partial content</span></Tooltip>;
  return <Tooltip content="This product has no marketing content yet. Use Set Content to generate it."><span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 cursor-default">No Content set</span></Tooltip>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BulkPage() {
  // Product list state
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [bestseller, setBestseller] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [styleFilter, setStyleFilter] = useState("");
  const [reviewedFilter, setReviewedFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(25);
  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>(PRODUCT_TAXONOMY);
  const cursorRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const fetchEpochRef = useRef(0);

  // Content review workflow state
  const [contentRows, setContentRows] = useState<ContentRow[]>([]);
  const [contentPhase, setContentPhase] = useState<ContentPhase>("idle");
  const [contentSaveResult, setContentSaveResult] = useState<{ saved: number; failed: number } | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [contentHasSaved, setContentHasSaved] = useState(false);
  const [wctEditing, setWctEditing] = useState<{ productId: string; slotIndex: number; text: string; subtext: string } | null>(null);
  const [bulkSwapModal, setBulkSwapModal] = useState<{ productId: string; type: "why" | "perfect"; slotIndex: number } | null>(null);
  const [pfAvailability, setPfAvailability] = useState<Record<string, boolean>>({});
  const [wctAvailability, setWctAvailability] = useState<Record<string, boolean>>({});
  const [summaryOptions, setSummaryOptions] = useState<Record<string, string[] | "loading">>({});

  // Classify workflow state
  const [classifyRows, setClassifyRows] = useState<ClassifyRow[]>([]);
  const [classifyPhase, setClassifyPhase] = useState<ClassifyPhase>("idle");
  const [classifySaveResult, setClassifySaveResult] = useState<{ saved: number; failed: number } | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [classifyHasSaved, setClassifyHasSaved] = useState(false);
  const classifyPanelRef = useRef<HTMLDivElement>(null);

  // Total count
  const [totalCount, setTotalCount] = useState<number | null>(null);

  // Image modal
  const [modalImage, setModalImage] = useState<string | null>(null);

  // Fetch error
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Check PF and WCT library availability when content rows load.
  useEffect(() => {
    if (contentPhase !== "review" || contentRows.length === 0) return;
    const eligible = contentRows.filter((row) => row.source !== "needs-classify");

    // PF: per-product, hide button if all library entries are already selected
    const pfPromise = Promise.all(
      eligible.map(async (row) => {
        const styles = row.productStylePt ? row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : [];
        const stylesToFetch = styles.length > 0 ? styles : [""];
        const selected = new Set(row.pfBullets.filter(Boolean));
        const results = await Promise.all(
          stylesToFetch.map((style) => {
            const params = new URLSearchParams({ type: "perfect" });
            if (row.productTypePt) params.set("productType", row.productTypePt);
            if (style) params.set("productStyle", style);
            return fetch(`/api/library?${params}`).then((r) => r.json()).catch(() => ({ entries: [] }));
          })
        );
        const seen = new Set<string>();
        const hasUnselected = results.some((d) =>
          (d.entries ?? []).some((e: { phrase: string; timeSensitive?: boolean }) => {
            if (e.timeSensitive || seen.has(e.phrase)) return false;
            seen.add(e.phrase);
            return !selected.has(e.phrase);
          })
        );
        return [row.productId, hasUnselected] as [string, boolean];
      })
    );

    // WCT: deduplicate checks by type+styles+category, then map to productId|slotIndex
    const wctCombos = new Map<string, { productType: string; productStyles: string[]; category: string }>();
    eligible.forEach((row) => {
      const styles = row.productStylePt ? row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : [];
      WCT_LABELS.forEach((category) => {
        const key = `${row.productTypePt}|${styles.join("|")}|${category}`;
        if (!wctCombos.has(key)) wctCombos.set(key, { productType: row.productTypePt, productStyles: styles, category });
      });
    });
    const wctPromise = Promise.all(
      Array.from(wctCombos.entries()).map(async ([key, { productType, productStyles, category }]) => {
        const stylesToFetch = productStyles.length > 0 ? productStyles : [""];
        const results = await Promise.all(
          stylesToFetch.map((style) => {
            const params = new URLSearchParams({ type: "why", category });
            if (productType) params.set("productType", productType);
            if (style) params.set("productStyle", style);
            return fetch(`/api/library?${params}`).then((r) => r.json()).catch(() => ({ entries: [] }));
          })
        );
        const seen = new Set<string>();
        const entries = results.flatMap((d) => (d.entries ?? []) as { text: string; subtext?: string }[])
          .filter((e) => { const k = `${e.text}|${e.subtext ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
        return [key, entries] as [string, { text: string; subtext?: string }[]];
      })
    );

    Promise.all([pfPromise, wctPromise]).then(([pfPairs, wctComboResults]) => {
      setPfAvailability(Object.fromEntries(pfPairs));
      const wctComboMap = Object.fromEntries(wctComboResults);
      const wctPairs = eligible.flatMap((row) => {
        const styles = row.productStylePt ? row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : [];
        return WCT_LABELS.map((category, i) => {
          const comboKey = `${row.productTypePt}|${styles.join("|")}|${category}`;
          const entries = wctComboMap[comboKey] ?? [];
          const current = parseBullet(row.wctBullets[i]);
          const hasAlternative = entries.some(
            (e) => e.text !== current.text || (e.subtext ?? "") !== current.subtext
          );
          return [`${row.productId}|${i}`, hasAlternative] as [string, boolean];
        });
      });
      setWctAvailability(Object.fromEntries(wctPairs));
    });
  }, [contentPhase]);

  // ── Product fetching ─────────────────────────────────────────────────────

  const fetchTotalCount = useCallback(async (signal?: AbortSignal) => {
    setTotalCount(null);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
    if (reviewedFilter) params.set("reviewed", reviewedFilter);
    try {
      const res = await fetch(`/api/products/count?${params}`, { signal });
      if (!res.ok) return;
      const data = await res.json();
      setTotalCount(data.count);
    } catch { /* abort or network error — leave count as null (shows fallback) */ }
  }, [search, statusFilter, bestseller, reviewedFilter]);

  const fetchProducts = useCallback(async (reset: boolean, signal?: AbortSignal) => {
    setLoading(true);
    if (reset) { fetchEpochRef.current += 1; setFetchError(null); }
    const epoch = fetchEpochRef.current;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (bestseller) params.set("bestseller", "true");
    if (reviewedFilter) params.set("reviewed", reviewedFilter);
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
      const data = await res.json();
      if (fetchEpochRef.current !== epoch) return;
      setProducts((prev) => (reset ? data.products : [...prev, ...data.products]));
      setNextCursor(data.nextCursor);
      cursorRef.current = data.nextCursor;
      setLoading(false);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setFetchError("Network error — please check your connection and try again.");
      setLoading(false);
    }
  }, [search, statusFilter, bestseller, reviewedFilter, pageSize]);

  useEffect(() => {
    fetch("/api/taxonomy").then((r) => r.ok ? r.json() : null).then((d) => { if (d?.taxonomy) setTaxonomy(d.taxonomy); }).catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    cursorRef.current = null;
    fetchProducts(true, controller.signal);
    fetchTotalCount(controller.signal);
    setSelectedIds(new Set());
    return () => { controller.abort(); if (controllerRef.current !== controller) controllerRef.current?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter, bestseller, reviewedFilter, pageSize]);

  // ── Selection helpers ────────────────────────────────────────────────────

  const filteredProducts = products.filter((p) => {
    if (typeFilter && p.productTypePt !== typeFilter) return false;
    if (styleFilter) {
      const styles = p.productStylePt ? p.productStylePt.split(",").map((s) => s.trim()) : [];
      if (!styles.includes(styleFilter)) return false;
    }
    return true;
  });

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
    if (selectedIds.size === 0 || classifyPhase !== "idle") return;

    setClassifyRows([]);
    setClassifyPhase("streaming");
    setClassifySaveResult(null);
    setClassifyError(null);

    // Split: products with existing classification show immediately, unclassified go to AI
    const selectedProducts = products.filter((p) => selectedIds.has(p.id));
    const hasExisting = selectedProducts.filter((p) => p.productTypePt);
    const needsClassify = selectedProducts.filter((p) => !p.productTypePt);

    if (hasExisting.length > 0) {
      setClassifyRows(
        hasExisting.map((p) => ({
          productId: p.id,
          title: p.title,
          imageUrl: p.featuredImage,
          suggestedType: p.productTypePt,
          suggestedStyles: p.productStylePt ? p.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : [],
          existingType: p.productTypePt,
          existingStyle: p.productStylePt,
          selectedType: p.productTypePt,
          selectedStyles: p.productStylePt ? p.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : [],
          source: "existing" as const,
          dirty: false,
          regenerating: false,
          skip: false,
        }))
      );
    }

    if (needsClassify.length === 0) {
      setClassifyPhase("review");
      return;
    }

    const res = await fetch("/api/bulk-classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: needsClassify.map((p) => p.id) }),
    });

    if (!res.ok || !res.body) {
      setClassifyError("Classification failed — please try again.");
      setClassifyPhase("idle");
      setClassifyRows([]);
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
                source: "generated" as const,
                dirty: false,
                regenerating: false,
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

  async function handleRegenerateExisting() {
    const existingRows = classifyRows.filter((r) => r.source === "existing" && !r.skip && !r.regenerating);
    if (existingRows.length === 0) return;

    const productIds = existingRows.map((r) => r.productId);
    setClassifyRows((rows) => rows.map((r) =>
      productIds.includes(r.productId) ? { ...r, regenerating: true } : r
    ));

    try {
      const res = await fetch("/api/bulk-classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds }),
      });

      if (!res.ok || !res.body) {
        setClassifyRows((rows) => rows.map((r) =>
          productIds.includes(r.productId) ? { ...r, regenerating: false } : r
        ));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "result") {
              setClassifyRows((rows) => rows.map((r) =>
                r.productId !== event.productId ? r : event.error ? {
                  ...r,
                  regenerating: false,
                  error: event.error,
                } : {
                  ...r,
                  regenerating: false,
                  suggestedType: event.suggestedType,
                  suggestedStyles: event.suggestedStyles,
                  selectedType: event.suggestedType,
                  selectedStyles: event.suggestedStyles,
                  source: "generated" as const,
                  dirty: false,
                  error: undefined,
                }
              ));
            }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setClassifyRows((rows) => rows.map((r) =>
        productIds.includes(r.productId) ? { ...r, regenerating: false, error: "Failed to reach server — please try again" } : r
      ));
    }
  }

  function handleTypeChange(productId: string, newType: string) {
    const validStyles = taxonomy[newType] ?? [];
    setClassifyRows((prev) =>
      prev.map((r) =>
        r.productId !== productId ? r : {
          ...r,
          selectedType: newType,
          selectedStyles: r.selectedStyles.filter((s) => validStyles.includes(s)),
          dirty: true,
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
        return { ...r, selectedStyles: next, dirty: true };
      })
    );
  }

  function handleSkipToggle(productId: string, skip: boolean) {
    setClassifyRows((prev) => prev.map((r) => r.productId !== productId ? r : { ...r, skip }));
  }

  async function handleSaveClassify() {
    if (classifyPhase !== "review") return;

    const assignments = classifyRows
      .filter((r) => !r.skip && !r.error && r.selectedType && r.selectedStyles.length > 0 && (r.source === "generated" || r.dirty))
      .map((r) => ({ productId: r.productId, type: r.selectedType, styles: r.selectedStyles }));

    if (assignments.length === 0) return;

    setClassifyPhase("saving");

    try {
      const res = await fetch("/api/bulk-classify/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignments }),
      });
      const data = res.ok ? await res.json() : { saved: 0, failed: assignments.length };
      setClassifySaveResult({ saved: data.saved, failed: data.failed });
      const savedIds = new Set(assignments.map((a) => a.productId));
      setClassifyRows((prev) => prev.map((r) => savedIds.has(r.productId) ? { ...r, source: "existing", dirty: false } : r));
      setClassifyHasSaved(true);
      setClassifyPhase("review");
    } catch {
      setClassifyPhase("review");
    }
  }

  function handleCloseClassify() {
    const wasSaved = classifyHasSaved;
    setClassifyPhase("idle");
    setClassifyRows([]);
    setClassifySaveResult(null);
    setClassifyHasSaved(false);
    if (wasSaved) {
      setSelectedIds(new Set());
      cursorRef.current = null;
      const controller = new AbortController();
      controllerRef.current = controller;
      fetchProducts(true, controller.signal);
      fetchTotalCount(controller.signal);
    }
  }

  const approvedCount = classifyRows.filter(
    (r) => !r.skip && !r.error && r.selectedType && r.selectedStyles.length > 0 && (r.source === "generated" || r.dirty)
  ).length;

  // ── Content review workflow ───────────────────────────────────────────────

  function handleWctEditSave() {
    if (!wctEditing) return;
    const { productId, slotIndex, text, subtext } = wctEditing;
    const bullet = subtext ? `<strong>${text}</strong> ${subtext}` : `<strong>${text}</strong>`;
    setContentRows((rows) => rows.map((r) => {
      if (r.productId !== productId) return r;
      const next = [...r.wctBullets] as [string, string, string, string];
      next[slotIndex] = bullet;
      return { ...r, wctBullets: next, dirty: true };
    }));
    setWctEditing(null);
  }

  function handlePfReorder(productId: string, index: number, direction: -1 | 1) {
    setContentRows((rows) => rows.map((r) => {
      if (r.productId !== productId) return r;
      const next = index + direction;
      if (next < 0 || next >= 4) return r;
      const phrases = [...r.pfBullets] as [string, string, string, string];
      const icons   = [...r.pfIcons]   as [string, string, string, string];
      [phrases[index], phrases[next]] = [phrases[next], phrases[index]];
      [icons[index],   icons[next]]   = [icons[next],   icons[index]];
      return { ...r, pfBullets: phrases, pfIcons: icons, dirty: true };
    }));
  }

  function handleBulkSwapSelect(phrase: string, icon: string, text?: string, subtext?: string) {
    if (!bulkSwapModal) return;
    const { productId, type, slotIndex } = bulkSwapModal;
    setContentRows((rows) => rows.map((r) => {
      if (r.productId !== productId) return r;
      if (type === "why") {
        const bullet = text !== undefined
          ? (subtext ? `<strong>${text}</strong> ${subtext}` : `<strong>${text}</strong>`)
          : phrase;
        const next = [...r.wctBullets] as [string, string, string, string];
        next[slotIndex] = bullet;
        return { ...r, wctBullets: next, dirty: true };
      } else {
        const nextPhrases = [...r.pfBullets] as [string, string, string, string];
        const nextIcons   = [...r.pfIcons]   as [string, string, string, string];
        nextPhrases[slotIndex] = phrase;
        nextIcons[slotIndex]   = icon;
        return { ...r, pfBullets: nextPhrases, pfIcons: nextIcons, dirty: true };
      }
    }));
    setBulkSwapModal(null);
  }

  async function handleSetContent() {
    const ids = selectedWithTypeStyle.map((p) => p.id);
    if (ids.length === 0 || contentPhase !== "idle") return;

    setContentPhase("loading");
    setContentRows([]);
    setContentSaveResult(null);
    setContentError(null);

    const res = await fetch("/api/bulk-content-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: ids }),
    });

    if (!res.ok) {
      setContentError("Failed to load content — please try again.");
      setContentPhase("idle");
      return;
    }

    const text = await res.text();
    let data: { rows: ContentRow[] };
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("Bulk content review — raw response:", text.slice(0, 1000));
      console.error("Parse error:", e);
      setContentError("Failed to parse response — please try again.");
      setContentPhase("idle");
      return;
    }
    const reviewedMap = new Map(selectedWithTypeStyle.map((p) => [p.id, p.humanReviewed ?? false]));
    const rows: ContentRow[] = (data.rows ?? []).map((r) => ({ ...r, dirty: false, humanReviewed: reviewedMap.get(r.productId) ?? false }));
    setContentRows(rows);
    setContentPhase("review");
  }

  async function handleRegenerateContent(productId: string) {
    setContentRows((rows) => rows.map((r) => r.productId === productId ? { ...r, regenerating: true, regenerateError: undefined } : r));

    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });

      if (res.ok) {
        const data = await res.json();
        setContentRows((rows) => rows.map((r) =>
          r.productId === productId
            ? { ...r, regenerating: false, summary: data.summary, wctBullets: data.wctBullets, pfBullets: data.pfBullets, pfIcons: data.pfIcons, source: "generated" as const, dirty: true }
            : r
        ));
      } else {
        let errorInfo: { message: string; billingUrl?: string } = { message: "Failed to regenerate content — please try again." };
        try {
          const errData = await res.json();
          if (errData.error?.message) errorInfo = errData.error;
        } catch { /* ignore parse failure */ }
        setContentRows((rows) => rows.map((r) =>
          r.productId === productId ? { ...r, regenerating: false, regenerateError: errorInfo } : r
        ));
      }
    } catch {
      setContentRows((rows) => rows.map((r) =>
        r.productId === productId ? { ...r, regenerating: false, regenerateError: { message: "Network error — please check your connection and try again." } } : r
      ));
    }
  }

  async function handleSaveContent() {
    const toSave = contentRows.filter((r) => !r.skip && (r.source === "generated" || (r.source === "existing" && r.dirty)));
    if (toSave.length === 0 || contentPhase !== "review") return;

    setContentPhase("saving");

    try {
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
            productTypePt: r.productTypePt,
            productStylePt: r.productStylePt,
            humanReviewed: r.humanReviewed,
          })),
        }),
      });
      const data = res.ok ? await res.json() : { saved: 0, failed: toSave.length };
      setContentSaveResult(data);
      const savedIds = new Set(toSave.map((r) => r.productId));
      setContentRows((prev) => prev.map((r) => savedIds.has(r.productId) ? { ...r, source: "existing", dirty: false } : r));
      setContentHasSaved(true);
      setContentPhase("review");
    } catch {
      setContentPhase("review");
    }
  }

  function handleCloseContent() {
    const wasSaved = contentHasSaved;
    setContentPhase("idle");
    setContentRows([]);
    setContentSaveResult(null);
    setContentHasSaved(false);
    if (wasSaved) {
      setSelectedIds(new Set());
      cursorRef.current = null;
      const controller = new AbortController();
      controllerRef.current = controller;
      fetchProducts(true, controller.signal);
      fetchTotalCount(controller.signal);
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
      <Nav active="bulk" helpText={"Classify and generate content for many products at once.\nFilter and select the products you want to work on, then use Set Type & Style to classify them, and Set Content to generate their marketing copy.\nYou'll review everything before anything is saved."} />

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
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setStyleFilter(""); setSelectedIds(new Set()); }}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All types</option>
          {Object.keys(taxonomy).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={styleFilter}
          onChange={(e) => { setStyleFilter(e.target.value); setSelectedIds(new Set()); }}
          disabled={!typeFilter || (taxonomy[typeFilter] ?? []).length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-40"
        >
          <option value="">All styles</option>
          {(taxonomy[typeFilter] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-sm text-gray-400">
          {loading && products.length === 0
            ? "Loading..."
            : (typeFilter || styleFilter)
              ? `${filteredProducts.length} product${filteredProducts.length !== 1 ? "s" : ""}`
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
        <div className="flex-1" />
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
        <div className={`flex flex-col ${showRightPanel ? "w-2/5 border-r border-gray-200" : "w-full"} overflow-hidden`}>
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
                  {!showRightPanel && <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Step 1</th>}
                  {!showRightPanel && <th className="px-4 py-2.5 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Step 2</th>}
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
                    {!showRightPanel && <td className="px-4 py-2.5"><ClassifyBadge status={p.classifyStatus} /></td>}
                    {!showRightPanel && <td className="px-4 py-2.5"><ContentBadge status={p.contentStatus} /></td>}
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={showRightPanel ? 4 : 6} className="px-4 py-10 text-center text-gray-400 text-sm">Loading…</td>
                  </tr>
                )}
                {!loading && fetchError && (
                  <tr>
                    <td colSpan={showRightPanel ? 4 : 6} className="px-4 py-10 text-center text-red-500 text-sm">{fetchError}</td>
                  </tr>
                )}
                {!loading && !fetchError && filteredProducts.length === 0 && (
                  <tr>
                    <td colSpan={showRightPanel ? 4 : 6} className="px-4 py-10 text-center text-gray-400 text-sm">No products found</td>
                  </tr>
                )}
              </tbody>
            </table>
            {nextCursor && !loading && !typeFilter && !styleFilter && (
              <div className="p-4 text-center border-t border-gray-100">
                <button
                  onClick={() => fetchProducts(false, controllerRef.current?.signal)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Load more
                </button>
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          <div className="border-t border-gray-200 px-4 py-3 flex items-center gap-3 bg-white shrink-0 flex-wrap">
            {(classifyError || contentError) && (
              <span className="w-full text-xs text-red-500">{classifyError || contentError}</span>
            )}
            <div className="flex-1" />
            <span className="text-sm text-gray-500">
              {selectedCount === 0 ? "None selected" : `${selectedCount} selected`}
            </span>
            <Tooltip content="For selected products, use AI to suggest the right Product Type and Style. You'll review and approve before anything saves." side="top">
              <button
                onClick={handleClassify}
                disabled={selectedCount === 0 || classifyPhase !== "idle" || contentPhase !== "idle"}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
              >
                Set Type &amp; Style{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </button>
            </Tooltip>
            <Tooltip content="Load Why People Love This and Perfect For content for selected products. AI generates it where missing — you review everything before saving." side="top">
              <button
                onClick={handleSetContent}
                disabled={populateCount === 0 || contentPhase !== "idle" || classifyPhase !== "idle"}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
              >
                {contentPhase === "loading" ? "Loading…" : `Set Content${populateCount > 0 ? ` (${populateCount})` : ""}`}
              </button>
            </Tooltip>
          </div>
        </div>

        {/* Right panel — classify or assign progress */}
        {showRightPanel && (
          <div className="w-3/5 flex flex-col bg-gray-50 overflow-hidden">

            {/* ── Classify panel ── */}
            {showClassify && (
              <>
                <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm text-gray-900">
                    {classifyPhase === "streaming" && "Classifying…"}
                    {classifyPhase === "saving" && "Saving…"}
                    {(classifyPhase === "review") && "Review Classifications"}
                  </span>
                  <div className="flex items-center gap-2">
                    {classifySaveResult && (
                      <span className="text-xs text-gray-500">
                        {classifySaveResult.saved} saved · {classifySaveResult.failed} failed
                      </span>
                    )}
                    {classifyPhase === "review" && classifyRows.some((r) => r.source === "existing" && !r.skip) && (
                      <Tooltip content="Re-run AI classification for products that already have a Type and Style. Use if the existing suggestions look wrong." side="bottom">
                        <button
                          onClick={handleRegenerateExisting}
                          disabled={classifyRows.some((r) => r.regenerating)}
                          className="px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors"
                        >
                          {classifyRows.some((r) => r.regenerating) ? "Regenerating…" : "Regenerate all Existing"}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>

                <div ref={classifyPanelRef} className="flex-1 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                      <tr>
                        <th className="w-20 px-3 py-2"></th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Product</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Type</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Style</th>
                        <th className="w-10 px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wide">Skip</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {classifyRows.map((row) => (
                        <tr key={row.productId} className={`${row.skip || row.regenerating ? "opacity-40" : ""} align-top`}>
                          {/* Thumbnail */}
                          <td className="px-3 py-2">
                            {row.imageUrl ? (
                              <button
                                onClick={() => setModalImage(row.imageUrl)}
                                className="block w-16 h-16 rounded overflow-hidden hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-shadow"
                                title="Click to enlarge"
                              >
                                <Image
                                  src={row.imageUrl}
                                  alt={row.title}
                                  width={64}
                                  height={64}
                                  className="w-16 h-16 object-cover"
                                  unoptimized
                                />
                              </button>
                            ) : (
                              <div className="w-16 h-16 rounded bg-gray-200" />
                            )}
                          </td>
                          {/* Title */}
                          <td className="px-3 py-2 text-gray-900">
                            <div className="flex items-start gap-1.5">
                              <span className="leading-tight text-sm">{row.title}</span>
                              <a
                                href={`https://admin.shopify.com/store/${(process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ?? "penelopetom-office.myshopify.com").replace(".myshopify.com", "")}/products/${row.productId.split("/").pop()}`}
                                target="_blank" rel="noreferrer"
                                className="shrink-0 text-[10px] text-blue-500 hover:text-blue-700 leading-tight mt-0.5"
                                title="Open in Shopify Admin"
                              >↗</a>
                            </div>
                            {row.error ? (
                              <span className="text-red-500 block mt-0.5">{row.error}</span>
                            ) : row.source === "existing" && !row.dirty ? (
                              <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Existing</span>
                            ) : row.source === "existing" && row.dirty ? (
                              <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-600">Edited - Unsaved</span>
                            ) : (
                              <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">Newly Generated - Unsaved</span>
                            )}
                            {row.regenerating && (
                              <span className="mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">Regenerating…</span>
                            )}
                          </td>
                          {/* Type dropdown */}
                          <td className="px-3 py-2">
                            {row.error ? null : (
                              <select
                                value={row.selectedType}
                                onChange={(e) => handleTypeChange(row.productId, e.target.value)}
                                disabled={row.skip || classifyPhase === "saving" || classifyPhase === "saved"}
                                className="w-full border border-gray-300 rounded px-1.5 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                              >
                                <option value="">— choose —</option>
                                {Object.keys(taxonomy).map((t) => (
                                  <option key={t} value={t}>{t}</option>
                                ))}
                              </select>
                            )}
                          </td>
                          {/* Style checkboxes */}
                          <td className="px-3 py-2">
                            {row.error || !row.selectedType ? null : (
                              <div className="flex flex-col gap-0.5">
                                {(taxonomy[row.selectedType] ?? []).map((style) => (
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
                            <Tooltip content="Tick to skip this product — it won't be updated when you save." side="left">
                              <input
                                type="checkbox"
                                checked={row.skip}
                                onChange={(e) => handleSkipToggle(row.productId, e.target.checked)}
                                disabled={classifyPhase === "saving" || classifyPhase === "saved"}
                                className="rounded border-gray-300"
                              />
                            </Tooltip>
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
                    {classifyHasSaved ? "Close" : "Cancel"}
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
              const needsSave = (r: ContentRow) => !r.skip && (r.source === "generated" || (r.source === "existing" && r.dirty));
              const saveCount = contentRows.filter(needsSave).length;
              const anyRegenerating = contentRows.some((r) => r.regenerating);
              return (
                <>
                  <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
                    <span className="font-medium text-sm text-gray-900">
                      {contentPhase === "loading" && "Loading content…"}
                      {contentPhase === "saving" && "Saving…"}
                      {contentPhase === "review" && `Review Content (${contentRows.length})`}
                    </span>
                    {contentSaveResult && (
                      <span className="text-xs text-gray-500">
                        {contentSaveResult.saved} saved · {contentSaveResult.failed} failed
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {contentPhase === "loading" && (
                      <div className="text-center text-gray-400 text-sm py-8">Loading content — this may take several minutes when generating for a large number of products…</div>
                    )}
                    {contentRows.map((row) => (
                      <div key={row.productId} className={`bg-white rounded-lg border border-gray-200 ${row.skip ? "opacity-40" : ""}`}>
                        {/* Product header */}
                        <div className="flex items-center gap-3 p-3 border-b border-gray-100">
                          {row.imageUrl ? (
                            <button
                              onClick={() => setModalImage(row.imageUrl)}
                              className="block w-10 h-10 rounded overflow-hidden hover:ring-2 hover:ring-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-shadow shrink-0"
                              title="Click to enlarge"
                            >
                              <img src={row.imageUrl} alt="" className="w-10 h-10 object-cover" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 bg-gray-100 rounded shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm text-gray-900 truncate">{row.title}</span>
                              <a
                                href={`https://admin.shopify.com/store/${(process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ?? "penelopetom-office.myshopify.com").replace(".myshopify.com", "")}/products/${row.productId.split("/").pop()}`}
                                target="_blank" rel="noreferrer"
                                className="shrink-0 text-[10px] text-blue-500 hover:text-blue-700"
                                title="Open in Shopify Admin"
                              >↗</a>
                              {row.source === "needs-classify"
                                ? <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-600">Needs Type &amp; Style</span>
                                : row.source === "existing" && !row.dirty
                                  ? <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">Existing</span>
                                  : row.dirty
                                    ? <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-600">Edited - Unsaved</span>
                                    : <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">Newly Generated - Unsaved</span>
                              }
                            </div>
                            <div className="text-xs text-gray-400">{row.productTypePt} · {row.productStylePt}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <button
                              onClick={() => handleRegenerateContent(row.productId)}
                              disabled={row.skip || row.regenerating || anyRegenerating || contentPhase === "saving" || contentPhase === "saved"}
                              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors shrink-0"
                            >
                              {row.regenerating ? "Regenerating…" : "Regenerate"}
                            </button>
                            {row.regenerateError && (
                              <p className="text-xs text-red-500 text-right max-w-[160px]">
                                {row.regenerateError.message}
                                {row.regenerateError.billingUrl && (
                                  <a href={row.regenerateError.billingUrl} target="_blank" rel="noreferrer" className="underline ml-1 whitespace-nowrap">Add credits →</a>
                                )}
                              </p>
                            )}
                          </div>
                          <Tooltip content="Tick to skip this product — it won't be updated when you save." side="left">
                            <label className="flex items-center gap-1 text-sm text-gray-600 shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.skip}
                                onChange={(e) => setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, skip: e.target.checked } : r))}
                                disabled={row.source === "needs-classify" || contentPhase === "saving" || contentPhase === "saved"}
                                className="rounded border-gray-300"
                              />
                              Skip
                            </label>
                          </Tooltip>
                        </div>

                        {/* Fields */}
                        <div className="p-3 space-y-3">
                          <div>
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Summary</label>
                            <textarea
                              value={row.summary}
                              onChange={(e) => setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, summary: e.target.value, dirty: true } : r))}
                              disabled={row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved"}
                              rows={3}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 resize-none"
                            />
                            {row.summaryError && (
                              <p className="text-xs text-red-500 mt-1">
                                {row.summaryError.message}
                                {row.summaryError.billingUrl && (
                                  <a href={row.summaryError.billingUrl} target="_blank" rel="noreferrer" className="underline ml-1 whitespace-nowrap">Add credits →</a>
                                )}
                              </p>
                            )}
                            {(() => {
                              const opts = summaryOptions[row.productId];
                              const isLoading = opts === "loading";
                              const disabled = row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved";
                              return (
                                <>
                                  <button
                                    onClick={async () => {
                                      setSummaryOptions((s) => ({ ...s, [row.productId]: "loading" }));
                                      try {
                                        const res = await fetch("/api/generate-summary", {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ productId: row.productId }),
                                        });
                                        const data = await res.json();
                                        if (res.ok && data.options) {
                                          setSummaryOptions((s) => ({ ...s, [row.productId]: data.options }));
                                        } else {
                                          setSummaryOptions((s) => { const n = { ...s }; delete n[row.productId]; return n; });
                                        }
                                      } catch {
                                        setSummaryOptions((s) => { const n = { ...s }; delete n[row.productId]; return n; });
                                      }
                                    }}
                                    disabled={disabled || isLoading}
                                    className="mt-1.5 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition-colors disabled:opacity-40"
                                  >
                                    {isLoading ? "Generating…" : "Regenerate Alternative Product Summaries"}
                                  </button>
                                  {Array.isArray(opts) && opts.length > 0 && (
                                    <div className="mt-1.5 space-y-1">
                                      {opts.map((opt, oi) => (
                                        <div key={oi} className="flex items-start gap-2 border border-gray-200 rounded px-2 py-1.5">
                                          <span className="flex-1 text-sm text-gray-700">{opt}</span>
                                          <button
                                            onClick={() => {
                                              setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, summary: opt, dirty: true } : r));
                                              setSummaryOptions((s) => { const n = { ...s }; delete n[row.productId]; return n; });
                                            }}
                                            className="shrink-0 text-xs text-white bg-gray-800 hover:bg-gray-600 px-2 py-0.5 rounded transition-colors"
                                          >
                                            Use
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                          </div>

                          <div>
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Why Choose This</label>
                            <div className="space-y-1.5">
                              {row.wctBullets.map((bullet, i) => {
                                const parsed = parseBullet(bullet);
                                const isEditing = wctEditing?.productId === row.productId && wctEditing?.slotIndex === i;
                                const disabled = row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved";
                                return (
                                  <div key={i} className="bg-white border border-gray-200 rounded-md px-2.5 py-2">
                                    {isEditing ? (
                                      <div className="space-y-1.5">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 block mb-1">{WCT_LABELS[i]}</span>
                                        <input
                                          autoFocus
                                          type="text"
                                          value={wctEditing.text}
                                          onChange={(e) => setWctEditing({ ...wctEditing, text: e.target.value })}
                                          placeholder="Bold headline"
                                          className="w-full text-sm border border-gray-200 rounded px-2 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                        <input
                                          type="text"
                                          value={wctEditing.subtext}
                                          onChange={(e) => setWctEditing({ ...wctEditing, subtext: e.target.value })}
                                          placeholder="Supporting subtext"
                                          className="w-full text-sm border border-gray-200 rounded px-2 py-2 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                        <div className="flex gap-2">
                                          <button onClick={handleWctEditSave} className="px-2.5 py-1 bg-gray-800 text-white text-xs rounded hover:bg-gray-900 transition-colors">Done</button>
                                          <button onClick={() => setWctEditing(null)} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400 shrink-0 w-28">{WCT_LABELS[i]}</span>
                                        <button
                                          disabled={disabled}
                                          onClick={() => setWctEditing({ productId: row.productId, slotIndex: i, text: parsed.text, subtext: parsed.subtext })}
                                          className="flex-1 text-left text-sm text-gray-700 hover:text-gray-900 disabled:cursor-default transition-colors min-w-0"
                                        >
                                          {parsed.text
                                            ? <><strong className="text-gray-900">{parsed.text}</strong>{parsed.subtext ? <span className="text-gray-500"> {parsed.subtext}</span> : ""}</>
                                            : <em className="text-gray-400 not-italic">Empty — click to type or use Swap</em>
                                          }
                                        </button>
                                        {!disabled && wctAvailability[`${row.productId}|${i}`] && (
                                          <button
                                            onClick={() => setBulkSwapModal({ productId: row.productId, type: "why", slotIndex: i })}
                                            className="shrink-0 text-[10px] text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-2 py-0.5 rounded transition-colors"
                                          >
                                            Swap
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Perfect For</label>
                            <div className="space-y-1.5">
                              {row.pfBullets.map((phrase, i) => {
                                const icon = row.pfIcons[i];
                                const disabled = row.skip || row.regenerating || contentPhase === "saving" || contentPhase === "saved";
                                return (
                                  <div key={i} className="bg-white border border-gray-200 rounded-md px-1.5 py-1 flex items-center gap-1.5">
                                    {!disabled && (
                                      <div className="flex flex-col gap-0.5 shrink-0">
                                        <button onClick={() => handlePfReorder(row.productId, i, -1)} disabled={i === 0}
                                          className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-gray-600 disabled:invisible rounded transition-colors">
                                          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
                                        </button>
                                        <button onClick={() => handlePfReorder(row.productId, i, 1)} disabled={i === 3}
                                          className="w-4 h-4 flex items-center justify-center text-gray-300 hover:text-gray-600 disabled:invisible rounded transition-colors">
                                          <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                                        </button>
                                      </div>
                                    )}
                                    <span className="shrink-0 w-6 h-6 flex items-center justify-center">
                                      {!icon ? (
                                        <span className="text-gray-300 text-xs">—</span>
                                      ) : icon.startsWith("<svg") ? (
                                        <span className="w-5 h-5 opacity-60 [&>svg]:w-5 [&>svg]:h-5" dangerouslySetInnerHTML={{ __html: icon }} />
                                      ) : (
                                        <img src={icon.startsWith("https://") ? icon : `/icons/${icon}.svg`} alt="" className="w-5 h-5 opacity-60" />
                                      )}
                                    </span>
                                    <span className="flex-1 text-sm text-gray-700 truncate">
                                      {phrase || <em className="text-gray-400 not-italic">Empty</em>}
                                    </span>
                                    {!disabled && (
                                      <button
                                        onClick={() => setBulkSwapModal({ productId: row.productId, type: "perfect", slotIndex: i })}
                                        className="shrink-0 text-[10px] text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-300 px-2 py-0.5 rounded transition-colors"
                                      >
                                        Swap
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* Approved bar */}
                        <div className={`border-t px-3 py-2.5 flex items-center gap-2 ${row.humanReviewed ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                          <input
                            type="checkbox"
                            id={`reviewed-${row.productId}`}
                            checked={row.humanReviewed}
                            onChange={(e) => setContentRows((rows) => rows.map((r) => r.productId === row.productId ? { ...r, humanReviewed: e.target.checked, dirty: true } : r))}
                            disabled={row.skip || contentPhase === "saving" || contentPhase === "saved"}
                            className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <label htmlFor={`reviewed-${row.productId}`} className={`text-sm font-medium cursor-pointer select-none ${row.humanReviewed ? "text-emerald-700" : "text-amber-700"}`}>
                            {row.humanReviewed ? "Approved" : "Mark as approved"}
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-200 px-4 py-3 bg-white flex items-center gap-3 shrink-0">
                    <button
                      onClick={handleCloseContent}
                      className="px-4 py-2 border border-gray-300 text-sm text-gray-600 rounded hover:bg-gray-50 transition-colors"
                    >
                      {contentHasSaved ? "Close" : "Cancel"}
                    </button>
                    <div className="flex-1" />
                    {contentPhase !== "loading" && (
                      <button
                        onClick={handleSaveContent}
                        disabled={saveCount === 0 || contentPhase === "saving"}
                        className="px-4 py-2 bg-gray-900 text-white text-sm rounded disabled:opacity-40 hover:bg-gray-700 transition-colors"
                      >
                        {contentPhase === "saving" ? "Saving…" : saveCount > 0 ? `Save (${saveCount})` : "Save"}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}

          </div>
        )}
      </div>

      {/* Bulk content swap modal */}
      {bulkSwapModal && (() => {
        const row = contentRows.find((r) => r.productId === bulkSwapModal.productId);
        if (!row) return null;
        return (
          <SwapModal
            type={bulkSwapModal.type}
            slotIndex={bulkSwapModal.slotIndex}
            slotLabel={bulkSwapModal.type === "why" ? WCT_LABELS[bulkSwapModal.slotIndex] : undefined}
            productType={row.productTypePt}
            productStyles={row.productStylePt ? row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : []}
            selectedPhrases={bulkSwapModal.type === "perfect" ? row.pfBullets.filter(Boolean) : []}
            onSelect={handleBulkSwapSelect}
            onClose={() => setBulkSwapModal(null)}
          />
        );
      })()}

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
