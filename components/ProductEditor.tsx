"use client";

import { useState, useEffect } from "react";
import { PRODUCT_TYPES, getValidStyles } from "@/data/taxonomy";
import SwapModal from "./SwapModal";
import IconPicker from "./IconPicker";

const WCT_SLOTS = [
  {
    key: "bullet1" as const,
    label: "Stands Out",
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    ),
  },
  {
    key: "bullet2" as const,
    label: "Gift Impact",
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    ),
  },
  {
    key: "bullet3" as const,
    label: "Trusted Pick",
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="M9 12l2 2 4-4"/>
      </svg>
    ),
  },
  {
    key: "bullet4" as const,
    label: "Worth Keeping",
    icon: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="9" width="18" height="11" rx="1"/>
        <path d="M3 13h18M12 9v11"/>
        <path d="M8.5 9c-1.5 0-2.5-1-2.5-2.5S7 4 8.5 4c2 0 3.5 5 3.5 5s1.5-5 3.5-5S18 5 18 6.5 17 9 15.5 9"/>
      </svg>
    ),
  },
];

interface WCTBullets { bullet1: string; bullet2: string; bullet3: string; bullet4: string }
interface PFSlot { phrase: string; icon: string }

interface Props {
  productId: string;
  productTitle: string;
  onSaved: () => void;
  onClose: () => void;
}

interface ProductData {
  product: { id: string; title: string; handle: string; descriptionHtml: string; featuredImage: { url: string } | null };
  metafields: {
    productSummary: string;
    productTypePt: string;
    productStylePt: string;
    whyChooseThis: WCTBullets;
    perfectFor: { bullet1: string; bullet2: string; bullet3: string; bullet4: string; icon1: string; icon2: string; icon3: string; icon4: string };
    seasonalOverrides: { mothersDay: boolean; fathersDay: boolean; valentinesDay: boolean };
  };
  preview: {
    whyChooseThis: WCTBullets;
    perfectFor: { bullets: string[]; icons: string[] };
    wctHasAlternatives: boolean;
    wctSlotCounts: number[];
    pfSwapCount: number;
  } | null;
}

// SVG strings saved to Shopify metafields have id="name" — extract it so the editor always holds plain names
function normalizeIcon(icon: string): string {
  if (!icon || icon.startsWith("https://")) return icon;
  if (icon.startsWith("<svg")) {
    const m = icon.match(/\bid="([^"]+)"/);
    return m ? m[1] : icon;
  }
  return icon;
}

// Parse "<strong>Text</strong> Subtext" into {text, subtext}
function parseBullet(html: string): { text: string; subtext: string } {
  const m = html.match(/^<strong>(.*?)<\/strong>\s*(.*)/);
  if (m) return { text: m[1], subtext: m[2] };
  return { text: html, subtext: "" };
}

function formatBullet(text: string, subtext: string): string {
  if (!text) return "";
  return `<strong>${text}</strong>${subtext ? ` ${subtext}` : ""}`;
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className="text-sm font-semibold uppercase tracking-wider text-gray-800">{children}</span>
      <div className="flex-1 border-t border-gray-200" />
      {action}
    </div>
  );
}

export default function ProductEditor({ productId, productTitle, onSaved, onClose }: Props) {
  const [data, setData] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Form state
  const [productType, setProductType] = useState("");
  const [productStyles, setProductStyles] = useState<string[]>([]);
  const [seasonalOverrides, setSeasonalOverrides] = useState({ mothersDay: false, fathersDay: false, valentinesDay: false });
  const [productSummary, setProductSummary] = useState("");
  const [summaryOptions, setSummaryOptions] = useState<string[]>([]);
  const [generatingOptions, setGeneratingOptions] = useState(false);
  const [generateError, setGenerateError] = useState<{ message: string; billingUrl?: string } | null>(null);
  const [wctBullets, setWctBullets] = useState<WCTBullets>({ bullet1: "", bullet2: "", bullet3: "", bullet4: "" });
  const [wctEditing, setWctEditing] = useState<{ key: keyof WCTBullets; text: string; subtext: string } | null>(null);
  const [pfSlots, setPfSlots] = useState<PFSlot[]>([{ phrase: "", icon: "" }, { phrase: "", icon: "" }, { phrase: "", icon: "" }, { phrase: "", icon: "" }]);
  const [swapModal, setSwapModal] = useState<{ type: "why" | "perfect"; slotIndex: number } | null>(null);
  const [iconPickerSlot, setIconPickerSlot] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [reassigningWct, setReassigningWct] = useState(false);
  const [wctHasAlternatives, setWctHasAlternatives] = useState(true);
  const [wctSlotCounts, setWctSlotCounts] = useState<number[]>([1, 1, 1, 1]);
  const [pfSwapCount, setPfSwapCount] = useState<number>(1);
  const [typeStyleError, setTypeStyleError] = useState("");

  useEffect(() => {
    setSummaryOptions([]);
    setLoading(true);
    fetch(`/api/products/${productId}`)
      .then((r) => r.json())
      .then((d: ProductData) => {
        setData(d);
        setProductType(d.metafields.productTypePt);
        setProductStyles(d.metafields.productStylePt ? d.metafields.productStylePt.split(",").map(s => s.trim()).filter(Boolean) : []);
        setProductSummary(d.metafields.productSummary);
        setSeasonalOverrides(d.metafields.seasonalOverrides ?? { mothersDay: false, fathersDay: false, valentinesDay: false });

        // Use saved metafields, fall back to preview
        const wct = d.metafields.whyChooseThis.bullet1
          ? d.metafields.whyChooseThis
          : d.preview?.whyChooseThis ?? { bullet1: "", bullet2: "", bullet3: "", bullet4: "" };
        setWctBullets(wct);
        setWctHasAlternatives(d.preview?.wctHasAlternatives ?? true);
        setWctSlotCounts(d.preview?.wctSlotCounts ?? [1, 1, 1, 1]);
        setPfSwapCount(d.preview?.pfSwapCount ?? 1);

        const pf = d.metafields.perfectFor;
        if (pf.bullet1) {
          setPfSlots([
            { phrase: pf.bullet1, icon: normalizeIcon(pf.icon1) },
            { phrase: pf.bullet2, icon: normalizeIcon(pf.icon2) },
            { phrase: pf.bullet3, icon: normalizeIcon(pf.icon3) },
            { phrase: pf.bullet4, icon: normalizeIcon(pf.icon4) },
          ]);
        }
      })
      .finally(() => setLoading(false));
  }, [productId]);

  async function refreshPreview(type: string, styles: string[], overrides = seasonalOverrides) {
    if (!type || styles.length === 0) return;
    setPreviewLoading(true);
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, productType: type, productStyles: styles, seasonalOverrides: overrides }),
    });
    const preview = await res.json();
    setWctBullets(preview.whyChooseThis);
    setPfSlots(
      preview.perfectFor.bullets.map((phrase: string, i: number) => ({
        phrase,
        icon: preview.perfectFor.icons[i] ?? "",
      }))
    );
    if (preview.wctHasAlternatives !== undefined) setWctHasAlternatives(preview.wctHasAlternatives);
    if (preview.wctSlotCounts) setWctSlotCounts(preview.wctSlotCounts);
    if (preview.pfSwapCount !== undefined) setPfSwapCount(preview.pfSwapCount);
    setPreviewLoading(false);
  }

  function handleTypeChange(t: string) {
    setProductType(t);
    setProductStyles([]);
    setTypeStyleError("");
    setWctHasAlternatives(true);
  }

  function handleStyleToggle(s: string) {
    setProductStyles((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      setTypeStyleError("");
      refreshPreview(productType, next);
      return next;
    });
  }

  async function handleReassignWct() {
    if (!productType || productStyles.length === 0) return;
    setReassigningWct(true);
    const res = await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, productType, productStyles, seasonalOverrides }),
    });
    const preview = await res.json();
    if (preview.whyChooseThis) setWctBullets(preview.whyChooseThis);
    if (preview.wctHasAlternatives !== undefined) setWctHasAlternatives(preview.wctHasAlternatives);
    if (preview.wctSlotCounts) setWctSlotCounts(preview.wctSlotCounts);
    if (preview.pfSwapCount !== undefined) setPfSwapCount(preview.pfSwapCount);
    setReassigningWct(false);
  }

  function handleSeasonalToggle(key: keyof typeof seasonalOverrides) {
    setSeasonalOverrides((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      refreshPreview(productType, productStyles, next);
      return next;
    });
  }

  async function handleGenerateSummary() {
    setGeneratingOptions(true);
    setGenerateError(null);
    setSummaryOptions([]);
    const res = await fetch("/api/generate-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    const result = await res.json();
    setGeneratingOptions(false);
    if (result.error) {
      setGenerateError(result.error);
    } else {
      setSummaryOptions(result.options ?? []);
    }
  }

  function handleWctEdit(slot: keyof WCTBullets) {
    const parsed = parseBullet(wctBullets[slot]);
    setWctEditing({ key: slot, ...parsed });
  }

  function handleWctEditSave() {
    if (!wctEditing) return;
    setWctBullets((prev) => ({
      ...prev,
      [wctEditing.key]: formatBullet(wctEditing.text, wctEditing.subtext),
    }));
    setWctEditing(null);
  }

  function handlePfReorder(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= pfSlots.length) return;
    setPfSlots((prev) => {
      const arr = [...prev];
      [arr[index], arr[next]] = [arr[next], arr[index]];
      return arr;
    });
  }

  function handleSwapSelect(phrase: string, icon: string, text?: string, subtext?: string) {
    if (!swapModal) return;
    if (swapModal.type === "why") {
      const key = WCT_SLOTS[swapModal.slotIndex].key;
      setWctBullets((prev) => ({
        ...prev,
        [key]: formatBullet(text ?? "", subtext ?? ""),
      }));
    } else {
      setPfSlots((prev) => {
        const arr = [...prev];
        arr[swapModal.slotIndex] = { phrase, icon };
        return arr;
      });
    }
    setSwapModal(null);
  }

  async function handleSave() {
    if (!productType || productStyles.length === 0) {
      setTypeStyleError("Please set a product type and at least one style before saving.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccessMsg("");

    const res = await fetch(`/api/products/${productId}/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productSummary,
        productTypePt: productType,
        productStylesPt: productStyles,
        seasonalOverrides,
        whyChooseThis: wctBullets,
        perfectFor: {
          bullet1: pfSlots[0]?.phrase ?? "",
          bullet2: pfSlots[1]?.phrase ?? "",
          bullet3: pfSlots[2]?.phrase ?? "",
          bullet4: pfSlots[3]?.phrase ?? "",
          icon1: pfSlots[0]?.icon ?? "",
          icon2: pfSlots[1]?.icon ?? "",
          icon3: pfSlots[2]?.icon ?? "",
          icon4: pfSlots[3]?.icon ?? "",
        },
      }),
    });

    const result = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(result.error ?? "Save failed");
    } else {
      setSuccessMsg("Saved successfully");
      onSaved();
      setTimeout(() => setSuccessMsg(""), 3000);
    }
  }

  if (loading) {
    return <div className="p-8 text-gray-400 text-sm">Loading product…</div>;
  }

  const validStyles = getValidStyles(productType);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 max-w-2xl space-y-6">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              {data?.product.featuredImage && (
                <img
                  src={data.product.featuredImage.url}
                  alt=""
                  className="w-14 h-14 object-cover rounded-md shrink-0 ring-1 ring-gray-200"
                />
              )}
              <div>
                <h2 className="font-semibold text-gray-900 text-base leading-snug">{productTitle || data?.product.title}</h2>
                <a
                  href={`https://${process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ?? "penelopetom-office.myshopify.com"}/products/${data?.product.handle}?view=pdp-redesign`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-gray-400 hover:text-gray-600 hover:underline mt-1 inline-block transition-colors"
                >
                  Preview on site →
                </a>
                {data?.product.id && (() => {
                  const numericId = data.product.id.split("/").pop();
                  const storeName = (process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN ?? "penelopetom-office.myshopify.com").replace(".myshopify.com", "");
                  return (
                    <a
                      href={`https://admin.shopify.com/store/${storeName}/apps/256-metafields-editor/products/${numericId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-gray-400 hover:text-gray-600 hover:underline mt-0.5 block transition-colors"
                    >
                      Preview metafields on Shopify →
                    </a>
                  );
                })()}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-300 hover:text-gray-600 text-xl leading-none transition-colors shrink-0 mt-0.5"
            >
              ×
            </button>
          </div>

          {/* Type + Style */}
          <section>
            <SectionHeading>Product Type &amp; Style</SectionHeading>
            <select
              value={productType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
            >
              <option value="">Select type…</option>
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {productType && (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {validStyles.map((s) => (
                  <label key={s} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={productStyles.includes(s)}
                      onChange={() => handleStyleToggle(s)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{s}</span>
                  </label>
                ))}
              </div>
            )}
            {typeStyleError && <p className="text-red-500 text-xs mt-2">{typeStyleError}</p>}
            {previewLoading && <p className="text-gray-400 text-xs mt-2">Updating preview…</p>}
          </section>

          {/* Product Summary */}
          <section>
            <SectionHeading>Product Summary</SectionHeading>
            <textarea
              value={productSummary}
              onChange={(e) => setProductSummary(e.target.value)}
              rows={3}
              placeholder="[Aesthetic benefit] + [Functional benefit] + [Permission to buy]. Include a tension-resolving line e.g. 'Looks expensive, but…'"
              className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-md text-sm text-gray-800 placeholder:text-gray-300 resize-none focus:outline-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
            />
            <button
              onClick={handleGenerateSummary}
              disabled={generatingOptions}
              className="mt-2 px-4 py-2 bg-white border border-gray-400 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-50 hover:border-gray-600 disabled:opacity-50 transition-colors"
            >
              {generatingOptions ? "Generating…" : productSummary ? "Regenerate Product Summary" : "Generate Product Summary"}
            </button>

            {generateError && (
              <p className="text-red-500 text-sm mt-2">
                {generateError.message}{" "}
                {generateError.billingUrl && (
                  <a href={generateError.billingUrl} target="_blank" rel="noreferrer" className="underline">
                    Add credits →
                  </a>
                )}
              </p>
            )}

            {summaryOptions.length > 0 && (
              <div className="mt-3 space-y-2">
                {summaryOptions.map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => { setProductSummary(opt); setSummaryOptions([]); }}
                    className="w-full text-left px-3 py-2.5 bg-white border border-gray-200 rounded-md text-sm text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all"
                  >
                    <span className="text-gray-400 font-medium mr-1.5">{i + 1}.</span>{opt}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Why People Love This */}
          <section>
            <SectionHeading>Why People Love This</SectionHeading>
            {(!productType || productStyles.length === 0) && !wctBullets.bullet1 ? (
              <p className="text-sm text-gray-400 italic">Please select a Product Type and Style above to populate</p>
            ) : (
            <div className="space-y-2">
              {WCT_SLOTS.map((slot, i) => {
                const val = wctBullets[slot.key];
                const parsed = parseBullet(val);
                return (
                  <div key={slot.key} className="bg-white border border-gray-200 rounded-md p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        <span className="text-gray-400">{slot.icon}</span>
                        {slot.label}
                      </span>
                      {(wctSlotCounts[i] ?? 1) > 1 && (
                        <button
                          onClick={() => setSwapModal({ type: "why", slotIndex: i })}
                          className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-2.5 py-1 rounded transition-colors"
                        >
                          Swap
                        </button>
                      )}
                    </div>
                    {wctEditing?.key === slot.key ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={wctEditing.text}
                          onChange={(e) => setWctEditing({ ...wctEditing, text: e.target.value })}
                          placeholder="Bold headline"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <input
                          type="text"
                          value={wctEditing.subtext}
                          onChange={(e) => setWctEditing({ ...wctEditing, subtext: e.target.value })}
                          placeholder="Supporting subtext"
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleWctEditSave}
                            className="px-3 py-1.5 bg-gray-800 text-white text-sm font-medium rounded hover:bg-gray-900 transition-colors"
                          >
                            Done
                          </button>
                          <button
                            onClick={() => setWctEditing(null)}
                            className="px-3 py-1.5 text-gray-500 text-sm hover:text-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : val ? (
                      <button
                        onClick={() => handleWctEdit(slot.key)}
                        className="w-full text-left text-sm text-gray-700 hover:text-gray-900 transition-colors"
                      >
                        <strong className="text-gray-900">{parsed.text}</strong>
                        {parsed.subtext ? <span className="text-gray-600"> {parsed.subtext}</span> : ""}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleWctEdit(slot.key)}
                        className="text-sm text-gray-400 italic hover:text-gray-600 transition-colors"
                      >
                        No content — click to type or use Swap
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            )}
            {productType && productStyles.length > 0 && wctHasAlternatives && (
              <button
                onClick={handleReassignWct}
                disabled={reassigningWct}
                className="mt-2 px-4 py-2 bg-white border border-gray-400 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-50 hover:border-gray-600 disabled:opacity-50 transition-colors"
              >
                {reassigningWct ? "Regenerating…" : "Regenerate Why People Love"}
              </button>
            )}
          </section>

          {/* Perfect For */}
          <section>
            <SectionHeading>Perfect For</SectionHeading>
            {(!productType || productStyles.length === 0) && pfSlots.every(s => !s.phrase) ? (
              <p className="text-sm text-gray-400 italic">Please select a Product Type and Style above to populate</p>
            ) : (
            <div className="space-y-2">
              {pfSlots.map((slot, i) => (
                <div key={i} className="bg-white border border-gray-200 rounded-md px-3 py-2.5 flex items-center gap-3">
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button
                      onClick={() => handlePfReorder(i, -1)}
                      disabled={i === 0}
                      className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-600 disabled:invisible transition-colors rounded hover:bg-gray-100"
                      aria-label="Move up"
                    >
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 15l-6-6-6 6"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => handlePfReorder(i, 1)}
                      disabled={i === pfSlots.length - 1}
                      className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-gray-600 disabled:invisible transition-colors rounded hover:bg-gray-100"
                      aria-label="Move down"
                    >
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </button>
                  </div>
                  <button
                    onClick={() => setIconPickerSlot(i)}
                    title="Change icon"
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 transition-colors group"
                  >
                    {!slot.icon ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 group-hover:text-gray-500">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>
                      </svg>
                    ) : slot.icon.startsWith("<svg") ? (
                      <span
                        className="w-5 h-5 flex items-center justify-center opacity-70 group-hover:opacity-100 [&>svg]:w-5 [&>svg]:h-5"
                        dangerouslySetInnerHTML={{ __html: slot.icon }}
                      />
                    ) : slot.icon.startsWith("https://") ? (
                      <img src={slot.icon} alt="" className="w-5 h-5 opacity-70 group-hover:opacity-100" />
                    ) : (
                      <img src={`/icons/${slot.icon}.svg`} alt={slot.icon} className="w-5 h-5 opacity-70 group-hover:opacity-100" />
                    )}
                  </button>
                  <span className="text-sm text-gray-700 flex-1">
                    {slot.phrase || <em className="text-gray-400 not-italic">Empty</em>}
                  </span>
                  {pfSwapCount > 1 && (
                    <button
                      onClick={() => setSwapModal({ type: "perfect", slotIndex: i })}
                      className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 hover:border-gray-300 px-2.5 py-1 rounded shrink-0 transition-colors"
                    >
                      Swap
                    </button>
                  )}
                </div>
              ))}
            </div>
            )}
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Perfect For Seasonal Occasions</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {([
                  { key: "mothersDay",    label: "Mother's Day" },
                  { key: "fathersDay",    label: "Father's Day" },
                  { key: "valentinesDay", label: "Valentine's Day" },
                ] as const).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={seasonalOverrides[key]}
                      onChange={() => handleSeasonalToggle(key)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Sticky save footer */}
      <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-5 py-4 flex items-center gap-4">
        {error && <p className="text-red-500 text-xs">{error}</p>}
        {successMsg && <p className="text-emerald-600 text-xs">{successMsg}</p>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-black text-white text-sm font-semibold rounded-md hover:bg-gray-900 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* Swap modal */}
      {swapModal && (
        <SwapModal
          type={swapModal.type}
          slotIndex={swapModal.slotIndex}
          slotLabel={swapModal.type === "why" ? WCT_SLOTS[swapModal.slotIndex].label : undefined}
          productType={productType}
          productStyles={productStyles}
          onSelect={handleSwapSelect}
          onClose={() => setSwapModal(null)}
        />
      )}

      {/* Icon picker */}
      {iconPickerSlot !== null && (
        <IconPicker
          current={pfSlots[iconPickerSlot]?.icon ?? ""}
          onSelect={(icon) => {
            setPfSlots((prev) => {
              const arr = [...prev];
              arr[iconPickerSlot] = { ...arr[iconPickerSlot], icon };
              return arr;
            });
          }}
          onClose={() => setIconPickerSlot(null)}
        />
      )}
    </div>
  );
}
