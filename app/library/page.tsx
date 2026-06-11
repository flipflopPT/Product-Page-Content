"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Nav from "@/components/Nav";
import AffectedProductsModal from "@/components/AffectedProductsModal";
import DeletePhraseModal from "@/components/DeletePhraseModal";
import IconPicker from "@/components/IconPicker";
import { Tooltip } from "@/components/Tooltip";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";
import type { WhyChooseThisEntry } from "@/lib/types";
import type { WCTEdit, PFPhraseEdit } from "@/lib/library-edits-store";
import type { PFPhraseRow } from "@/lib/pf-store";

const WCT_CATEGORIES = ["Stands Out", "Gift Impact", "Trusted Pick", "Worth Keeping"] as const;
const PF_CATEGORIES  = ["Occasion", "Person", "Context"] as const;

type WCTRow = WhyChooseThisEntry & { _edit: WCTEdit | null };

type PushEvent =
  | { type: "progress"; title: string; status: "updated" | "error" }
  | { type: "done"; total: number; updated: number; swapped?: number; alternated?: number; skipped: number; failed: number };

function IconImg({ icon, size = 20 }: { icon: string; size?: number }) {
  if (!icon) return <span className="text-gray-300 text-xs">—</span>;
  if (icon.startsWith("https://"))
    return <img src={icon} alt="" style={{ width: size, height: size }} className="object-contain" />;
  if (icon.startsWith("<svg"))
    return (
      <span
        style={{ width: size, height: size, minWidth: size, display: "inline-flex", alignItems: "center", overflow: "hidden" }}
        dangerouslySetInnerHTML={{ __html: icon.replace(/<svg([^>]*)>/, (_, attrs) =>
          `<svg${attrs.replace(/\s*(width|height)="[^"]*"/g, "")} width="${size}" height="${size}" style="display:block">`) }}
      />
    );
  return <img src={`/icons/${icon}.svg`} alt={icon} style={{ width: size, height: size }} className="object-contain" />;
}

// ── WCT Edit Modal (unchanged) ────────────────────────────────────────────────

type SavedPatch = { id: string; text?: string; subtext?: string; phrase?: string };

interface WCTEditModalProps {
  entry: WCTRow | null;
  onClose: () => void;
  onSaved: (patch?: SavedPatch) => void;
  taxonomy: Record<string, string[]>;
}

function WCTEditModal({ entry, onClose, onSaved, taxonomy }: WCTEditModalProps) {
  const isNew = !entry;
  const [text, setText]       = useState(entry?.text ?? "");
  const [subtext, setSubtext] = useState(entry?.subtext ?? "");
  const [entries, setEntries] = useState<Record<string, { text: string; subtext: string }>>(
    () => Object.fromEntries(WCT_CATEGORIES.map((c) => [c, { text: "", subtext: "" }]))
  );
  const [productType, setProductType] = useState(entry?.productType ?? "");
  const [productStyle, setProductStyle] = useState(entry?.productStyle ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [findPhase, setFindPhase] = useState<"idle" | "finding" | "found" | "updating" | "done">("idle");
  const [foundProducts, setFoundProducts] = useState<{ id: string; title: string }[]>([]);
  const [updateLog, setUpdateLog] = useState<{ title: string; status: "updated" | "error" }[]>([]);
  const [updateResult, setUpdateResult] = useState<{ updated: number; skipped: number; failed: number } | null>(null);
  const updatingRef = useRef(false);

  const availableStyles = productType ? (taxonomy[productType] ?? []) : [];
  const hasEdit = !!entry?._edit;
  const canFind = !isNew;
  const [originalText] = useState(entry?.text ?? "");
  const [originalSubtext] = useState(entry?.subtext ?? "");
  const textChanged = text !== originalText || subtext !== originalSubtext;

  async function handleSave(): Promise<boolean> {
    setSaving(true);
    setSaveError("");

    if (isNew) {
      if (!productType || !productStyle) {
        setSaveError("Product type and style are required");
        setSaving(false);
        return false;
      }
      if (WCT_CATEGORIES.some((c) => !entries[c].text.trim())) {
        setSaveError("Text is required for all 4 categories");
        setSaving(false);
        return false;
      }
      const results = await Promise.all(WCT_CATEGORIES.map((cat) =>
        fetch("/api/library/entry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "wct",
            entry: {
              productType,
              productStyle,
              category: cat,
              text: entries[cat].text.trim(),
              subtext: entries[cat].subtext.trim(),
              searchFormatted: "",
            },
          }),
        })
      ));
      const failed = results.find((r) => !r.ok);
      if (failed) {
        setSaveError("Save failed — some entries may not have been created");
        setSaving(false);
        return false;
      }
      setSaving(false);
      onSaved();
      onClose();
      return true;
    }

    const res = await fetch("/api/library/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "wct",
        entry: {
          id: entry!.id,
          productType: entry!.productType,
          productStyle: entry!.productStyle,
          category: entry!.category,
          text, subtext,
          searchFormatted: entry?._edit?.searchFormatted ?? "",
        },
      }),
    });
    setSaving(false);
    if (!res.ok) { setSaveError("Save failed"); return false; }
    onSaved({ id: entry!.id, text, subtext });
    setJustSaved(true);
    setSavedConfirm(true);
    setTimeout(() => setSavedConfirm(false), 2000);
    if (textChanged) handleFind();
    return true;
  }

  async function handleFind() {
    if (!entry) return;
    setFindPhase("finding");
    setFoundProducts([]);
    try {
      const res = await fetch("/api/library/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "wct", id: entry.id }),
      });
      const data = res.ok ? await res.json() : { products: [] };
      setFoundProducts(data.products ?? []);
      setFindPhase("found");
    } catch { setFindPhase("idle"); setSaveError("Could not search for products — try Check Usage again."); }
  }

  async function handleFindClick() {
    if (!entry) return;
    const ok = await handleSave();
    if (!ok) return;
    if (!textChanged) handleFind();
  }

  async function handleUpdate() {
    if (!entry || updatingRef.current) return;
    updatingRef.current = true;
    setFindPhase("updating");
    setUpdateLog([]);
    setUpdateResult(null);
    const res = await fetch("/api/library/push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "wct", id: entry.id }),
    });
    if (!res.ok || !res.body) { updatingRef.current = false; setFindPhase("found"); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDone = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as PushEvent;
            if (event.type === "progress") {
              setUpdateLog((prev) => [...prev, { title: event.title, status: event.status }]);
            } else if (event.type === "done") {
              setUpdateResult({ updated: event.updated, skipped: event.skipped, failed: event.failed });
              setFindPhase("done");
              receivedDone = true;
            }
          } catch { /* ignore */ }
        }
        if (receivedDone) break;
      }
    } catch { /* network error */ } finally { updatingRef.current = false; }
    onSaved();
    if (!receivedDone) setFindPhase("found");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{isNew ? "New Why Choose This entries" : "Edit entry"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {isNew ? (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Product Type</label>
                <select value={productType} onChange={(e) => { setProductType(e.target.value); setProductStyle(""); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Select type…</option>
                  {Object.keys(taxonomy).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Product Style</label>
                <select value={productStyle} onChange={(e) => setProductStyle(e.target.value)} disabled={!productType}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40">
                  <option value="">Select style…</option>
                  {availableStyles.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {WCT_CATEGORIES.map((cat) => (
                <div key={cat} className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{cat}</p>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Text (bold)</label>
                    <input type="text" value={entries[cat].text}
                      onChange={(e) => setEntries((prev) => ({ ...prev, [cat]: { ...prev[cat], text: e.target.value } }))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Subtext</label>
                    <input type="text" value={entries[cat].subtext}
                      onChange={(e) => setEntries((prev) => ({ ...prev, [cat]: { ...prev[cat], subtext: e.target.value } }))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Text (bold)</label>
                <input type="text" value={text} onChange={(e) => { setText(e.target.value); setJustSaved(false); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Subtext</label>
                <input type="text" value={subtext} onChange={(e) => { setSubtext(e.target.value); setJustSaved(false); }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="text-xs text-gray-400 bg-gray-50 rounded px-3 py-2">Preview: <strong>{text}</strong> {subtext}</div>
            </>
          )}
          {saveError && <p className="text-red-600 text-xs">{saveError}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-3">
          <button onClick={onClose} disabled={findPhase === "updating"}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
            Close
          </button>
          <div className="flex-1" />
          {canFind && (
            <Tooltip content="Search all your products to find which ones currently use this entry.">
              <button onClick={handleFindClick} disabled={saving}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                Check Usage
              </button>
            </Tooltip>
          )}
          <button onClick={handleSave} disabled={saving || savedConfirm}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {saving ? "Saving…" : savedConfirm ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
      {findPhase !== "idle" && (
        <AffectedProductsModal
          title="Products using this entry"
          phase={findPhase}
          products={foundProducts}
          updateLog={updateLog}
          updateResult={updateResult}
          canUpdate={textChanged}
          onUpdate={handleUpdate}
          onDismiss={() => { setFindPhase("idle"); setFoundProducts([]); setUpdateLog([]); setUpdateResult(null); }}
        />
      )}
    </div>
  );
}

// ── PF Edit Modal ─────────────────────────────────────────────────────────────

type ActionPhase = "idle" | "checking" | "confirm" | "replacing" | "done" | "error";
type ModalMode = "edit" | "delete" | "remove-assignment";

interface PFEditModalProps {
  entry: PFPhraseRow | null; // null = new phrase
  onClose: () => void;
  onSaved: () => void;
  taxonomy: Record<string, string[]>;
}

function PFEditModal({ entry, onClose, onSaved, taxonomy }: PFEditModalProps) {
  const isNew = !entry;

  const [phrase, setPhrase] = useState(entry?.phrase ?? "");
  const [category, setCategory] = useState(entry?.category ?? "");
  const [timeSensitive, setTimeSensitive] = useState<string | null>(entry?.timeSensitive ?? null);
  const [filterByInterest, setFilterByInterest] = useState(entry?.filterByInterest ?? false);
  const [minPrice, setMinPrice] = useState<string>(entry?.minPrice !== undefined ? String(entry.minPrice) : "");
  const [maxPrice, setMaxPrice] = useState<string>(entry?.maxPrice !== undefined ? String(entry.maxPrice) : "");
  const [currentIcon, setCurrentIcon] = useState(entry?.icon ?? "");
  const [showIconPicker, setShowIconPicker] = useState(false);

  // New phrase: multi type/style pairs
  const [typeStylePairs, setTypeStylePairs] = useState<{ type: string; style: string }[]>([]);
  const [addingType, setAddingType] = useState("");
  const [addingStyle, setAddingStyle] = useState("");
  const addingStyles = addingType ? (taxonomy[addingType] ?? []) : [];

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [savedConfirm, setSavedConfirm] = useState(false);

  const [findPhase, setFindPhase] = useState<"idle" | "finding" | "found" | "updating" | "done">("idle");
  const [foundProducts, setFoundProducts] = useState<{ id: string; title: string }[]>([]);
  const [updateLog, setUpdateLog] = useState<{ title: string; status: "updated" | "error" }[]>([]);
  const [updateResult, setUpdateResult] = useState<{ updated: number; skipped: number; failed: number } | null>(null);
  const updatingRef = useRef(false);

  // Delete phrase / remove assignment shared state
  const [mode, setMode] = useState<ModalMode>("edit");
  const [removeApp, setRemoveApp] = useState<{ id: string; productType: string; productStyle: string } | null>(null);
  const [actionPhase, setActionPhase] = useState<ActionPhase>("idle");
  const [actionFoundCount, setActionFoundCount] = useState(0);
  const [actionFoundProducts, setActionFoundProducts] = useState<{ id: string; title: string }[]>([]);
  const [pendingDeleteIds, setPendingDeleteIds] = useState(new Set<string>());
  const [actionReplacement, setActionReplacement] = useState("");
  const [actionReplacementPhrases, setActionReplacementPhrases] = useState<{ phraseId: string; phrase: string }[]>([]);
  const [actionLog, setActionLog] = useState<{ title: string; status: "updated" | "error" }[]>([]);
  const [actionResult, setActionResult] = useState<{ updated: number; swapped: number; alternated: number; failed: number } | null>(null);
  const [actionError, setActionError] = useState("");
  const actionRef = useRef(false);

  const hasEdit = !!entry?._edit;
  const [originalPhrase] = useState(entry?.phrase ?? "");
  const [originalIcon] = useState(entry?.icon ?? "");
  const [originalFilterByInterest] = useState(entry?.filterByInterest ?? false);
  const [showKeywordsReminder, setShowKeywordsReminder] = useState(false);
  const phraseChangedSinceOpen = phrase !== originalPhrase;
  const iconChangedSinceOpen = currentIcon !== originalIcon;
  const canFind = !isNew;

  // ── Shared helper: stream a replace operation ──────────────────────────────
  async function streamReplace(oldPhrase: string, newPhrase: string, filterType?: string, filterStyle?: string): Promise<boolean> {
    if (actionRef.current) return false;
    actionRef.current = true;
    setActionPhase("replacing");
    setActionLog([]);
    setActionResult(null);

    const res = await fetch("/api/library/replace", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPhrase, newPhrase, productType: filterType, productStyle: filterStyle }),
    });
    if (!res.ok || !res.body) { actionRef.current = false; setActionPhase("confirm"); return false; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDone = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as PushEvent;
            if (event.type === "progress") {
              setActionLog((prev) => [...prev, { title: event.title, status: event.status }]);
            } else if (event.type === "done") {
              setActionResult({ updated: event.updated, swapped: event.swapped ?? event.updated, alternated: event.alternated ?? 0, failed: event.failed });
              setActionPhase("done");
              receivedDone = true;
            }
          } catch { /* ignore */ }
        }
        if (receivedDone) break;
      }
    } catch { /* network error */ } finally { actionRef.current = false; }
    if (!receivedDone) setActionPhase("confirm");
    return receivedDone;
  }

  // ── Delete phrase flow ──────────────────────────────────────────────────────
  async function startDeletePhrase() {
    if (!entry) return;
    setMode("delete");
    setActionPhase("checking");
    setActionReplacement("");
    setActionReplacementPhrases([]);

    const [findRes, phrasesRes] = await Promise.all([
      fetch("/api/library/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pf-scoped", phraseText: entry.phrase }),
      }),
      fetch(`/api/library?type=perfect`),
    ]);
    const findData = findRes.ok ? await findRes.json() : { products: [] };
    const phrasesData = phrasesRes.ok ? await phrasesRes.json() : { entries: [] };

    const seen = new Set<string>();
    const replacements: { phraseId: string; phrase: string }[] = [];
    for (const e of phrasesData.entries ?? []) {
      if (e.phraseId !== entry.id && !seen.has(e.phraseId)) {
        seen.add(e.phraseId);
        replacements.push({ phraseId: e.phraseId, phrase: e.phrase });
      }
    }
    replacements.sort((a, b) => a.phrase.localeCompare(b.phrase));

    setActionFoundCount(findData.products?.length ?? 0);
    setActionFoundProducts(findData.products ?? []);
    setActionReplacementPhrases(replacements);
    setActionPhase("confirm");
  }

  async function confirmDeletePhrase() {
    if (!entry) return;
    const replacement = actionReplacementPhrases.find((p) => p.phraseId === actionReplacement);
    if (actionFoundCount > 0 && replacement) {
      await streamReplace(entry.phrase, replacement.phrase);
      // streamReplace sets actionPhase to "done" — the "Remove assignment" button in the
      // done state handles the final step for remove-assignment; for delete we proceed here
    }
    const res = await fetch("/api/library/entry", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pf-phrase", id: entry.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setActionError(data.error ?? `Delete failed (${res.status})`);
      setActionPhase("error");
      return;
    }
    onSaved();
    onClose();
  }

  // ── Remove assignment flow ──────────────────────────────────────────────────
  async function startRemoveAssignment(app: { id: string; productType: string; productStyle: string }) {
    setRemoveApp(app);
    setMode("remove-assignment");
    setActionPhase("checking");
    setActionReplacement("");
    setActionReplacementPhrases([]);

    const phraseText = entry?.phrase ?? "";
    const [findRes, phrasesRes] = await Promise.all([
      fetch("/api/library/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pf-scoped", phraseText, filterType: app.productType, filterStyle: app.productStyle }),
      }),
      fetch(`/api/library?type=perfect&productType=${encodeURIComponent(app.productType)}`),
    ]);
    const findData = findRes.ok ? await findRes.json() : { products: [] };
    const phrasesData = phrasesRes.ok ? await phrasesRes.json() : { entries: [] };

    const seen = new Set<string>();
    const replacements: { phraseId: string; phrase: string }[] = [];
    for (const e of phrasesData.entries ?? []) {
      if (e.phraseId !== entry?.id && !seen.has(e.phraseId)) {
        seen.add(e.phraseId);
        replacements.push({ phraseId: e.phraseId, phrase: e.phrase });
      }
    }
    replacements.sort((a, b) => a.phrase.localeCompare(b.phrase));

    setActionFoundCount(findData.products?.length ?? 0);
    setActionFoundProducts(findData.products ?? []);
    setActionReplacementPhrases(replacements);
    setActionPhase("confirm");
  }

  async function confirmRemoveAssignment() {
    if (!removeApp || !entry) return;
    const replacement = actionReplacementPhrases.find((p) => p.phraseId === actionReplacement);
    if (actionFoundCount > 0 && replacement) {
      const ok = await streamReplace(entry.phrase, replacement.phrase, removeApp.productType, removeApp.productStyle);
      if (!ok) return;
    }
    const res = await fetch("/api/library/entry", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pf-applicability", id: removeApp.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setActionError(data.error ?? "Failed to remove assignment");
      setActionPhase("error");
      return;
    }
    const deletedId = removeApp.id;
    setPendingDeleteIds(prev => { const n = new Set(prev); n.add(deletedId); return n; });
    setMode("edit");
    setRemoveApp(null);
    setActionPhase("idle");
    onSaved();
  }

  function cancelAction() {
    setMode("edit");
    setRemoveApp(null);
    setActionPhase("idle");
    setActionLog([]);
    setActionResult(null);
    setActionFoundProducts([]);
  }

  async function handleSave(): Promise<boolean> {
    setSaving(true);
    setSaveError("");

    if (isNew) {
      if (!phrase.trim()) { setSaveError("Enter a phrase"); setSaving(false); return false; }
      if (!category) { setSaveError("Select a category"); setSaving(false); return false; }
      if (typeStylePairs.length === 0) { setSaveError("Add at least one product type"); setSaving(false); return false; }
      const res = await fetch("/api/library/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "pf",
          entry: { phrase: phrase.trim(), icon: currentIcon, category, timeSensitive, filterByInterest, ...(minPrice !== "" && { minPrice: parseFloat(minPrice) }), ...(maxPrice !== "" && { maxPrice: parseFloat(maxPrice) }), typeStylePairs },
        }),
      });
      setSaving(false);
      if (!res.ok) { setSaveError("Save failed"); return false; }
      onSaved();
      onClose();
      return true;
    }

    // Edit existing phrase
    const res = await fetch("/api/library/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "pf",
        entry: {
          id: entry!.id,
          phrase,
          icon: currentIcon,
          category,
          timeSensitive,
          filterByInterest,
          minPrice: minPrice !== "" ? parseFloat(minPrice) : null,
          maxPrice: maxPrice !== "" ? parseFloat(maxPrice) : null,
          searchPhrase: entry!._edit?.searchPhrase ?? entry!.phrase,
        },
      }),
    });
    setSaving(false);
    if (!res.ok) { setSaveError("Save failed"); return false; }
    const previousPhrase = entry!._edit?.searchPhrase ?? entry!.phrase;
    if (phrase.trim() !== previousPhrase) setJustSaved(true);
    setSavedConfirm(true);
    setTimeout(() => setSavedConfirm(false), 2000);
    if (filterByInterest && !originalFilterByInterest) setShowKeywordsReminder(true);
    if (phraseChangedSinceOpen || iconChangedSinceOpen) handleFind();
    onSaved();
    return true;
  }

  async function handleIconSelect(icon: string) {
    setCurrentIcon(icon);
    setShowIconPicker(false);
    if (!isNew && entry) {
      const res = await fetch("/api/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phraseId: entry.id, icon }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(data.error ?? "Failed to save icon");
        return;
      }
      onSaved();
      handleFind();
    }
  }

  async function handleAddAssignment() {
    if (!addingType || !entry) return;
    const res = await fetch("/api/library/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "pf",
        entry: { phraseId: entry.id, productType: addingType, productStyle: addingStyle || "ALL" },
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      setSaveError(data.error ?? "Failed to add type");
      return;
    }
    setSaveError("");
    setAddingType("");
    setAddingStyle("");
    onSaved();
  }

  async function handleFind() {
    if (!entry) return;
    setFindPhase("finding");
    setFoundProducts([]);
    try {
      const res = await fetch("/api/library/find", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "pf", id: entry.id }),
      });
      const data = res.ok ? await res.json() : { products: [] };
      setFoundProducts(data.products ?? []);
      setFindPhase("found");
    } catch { setFindPhase("idle"); setSaveError("Could not search for products — try Check Usage again."); }
  }

  async function handleFindClick() {
    if (!entry) return;
    const ok = await handleSave();
    if (!ok) return;
    if (!phraseChangedSinceOpen && !iconChangedSinceOpen) handleFind();
  }

  async function handleUpdate() {
    if (!entry || updatingRef.current) return;
    updatingRef.current = true;
    setFindPhase("updating");
    setUpdateLog([]);
    setUpdateResult(null);
    const res = await fetch("/api/library/push", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pf", id: entry.id }),
    });
    if (!res.ok || !res.body) { updatingRef.current = false; setFindPhase("found"); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let receivedDone = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as PushEvent;
            if (event.type === "progress") {
              setUpdateLog((prev) => [...prev, { title: event.title, status: event.status }]);
            } else if (event.type === "done") {
              setUpdateResult({ updated: event.updated, skipped: event.skipped, failed: event.failed });
              setFindPhase("done");
              receivedDone = true;
            }
          } catch { /* ignore */ }
        }
        if (receivedDone) break;
      }
    } catch { /* network error */ } finally { updatingRef.current = false; }
    onSaved();
    if (!receivedDone) setFindPhase("found");
  }

  // Sets for Bug 1: disable already-used type/style combos
  const usedPairs = new Set(typeStylePairs.map((p) => `${p.type}|${p.style}`));
  const usedExistingPairs = new Set((entry?.applicabilities ?? []).map((a) => `${a.productType}|${a.productStyle}`));

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
            <h2 className="font-semibold text-gray-900">{isNew ? "New Perfect For phrase" : "Edit phrase"}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
          </div>

          <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            {/* Phrase text */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Phrase</label>
              <input type="text" value={phrase} onChange={(e) => { setPhrase(e.target.value); setJustSaved(false); }}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {/* Icon */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Icon</label>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 flex items-center justify-center rounded-md border border-gray-200 bg-gray-50">
                  {currentIcon ? <IconImg icon={currentIcon} size={20} /> : <span className="text-gray-300 text-xs">—</span>}
                </div>
                <button onClick={() => setShowIconPicker(true)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors">
                  {currentIcon ? "Change icon" : "Pick icon"}
                </button>
                {currentIcon && (
                  <button onClick={() => setCurrentIcon("")} className="text-xs text-gray-400 hover:text-red-500 transition-colors">Remove</button>
                )}
              </div>
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select category…</option>
                {PF_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Seasonal */}
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Seasonal Occasion</label>
              <select value={timeSensitive ?? ""} onChange={(e) => { setTimeSensitive(e.target.value || null); setJustSaved(false); }}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">None</option>
                <option value="mothers-day">Mother&apos;s Day</option>
                <option value="fathers-day">Father&apos;s Day</option>
                <option value="valentines-day">Valentine&apos;s Day</option>
              </select>
            </div>

            {/* Filter by interest */}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={filterByInterest} onChange={(e) => setFilterByInterest(e.target.checked)}
                className="rounded border-gray-300" />
              <span>
                Apply interest filter
                <span className="block text-xs text-gray-400 font-normal">
                  {isNew && filterByInterest
                    ? (<>Once saved, visit <a href="/settings/keywords" className="underline text-blue-500">Interest Filter</a> to add keywords for this phrase.</>)
                    : "Requires setting up in the Interest Filter tab. Until configured, the phrase applies to all products as normal."}
                </span>
              </span>
            </label>

            {/* Price range */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Min Price (£)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={minPrice}
                  onChange={(e) => { setMinPrice(e.target.value); setJustSaved(false); }}
                  placeholder="No minimum"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Max Price (£)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={maxPrice}
                  onChange={(e) => { setMaxPrice(e.target.value); setJustSaved(false); }}
                  placeholder="No maximum"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Type/style assignments */}
            {isNew ? (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1">Product Types</label>
                <div className="space-y-2">
                  {typeStylePairs.map((pair, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded text-gray-700">
                        {pair.type}{pair.style ? ` · ${pair.style}` : " · All styles"}
                      </span>
                      <button onClick={() => setTypeStylePairs((prev) => prev.filter((_, j) => j !== i))}
                        className="text-gray-400 hover:text-red-500 transition-colors">&times;</button>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <select value={addingType} onChange={(e) => { setAddingType(e.target.value); setAddingStyle(""); }}
                      className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">Add Product Type…</option>
                      {Object.keys(taxonomy).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    {addingStyles.length > 0 && (
                      <select value={addingStyle} onChange={(e) => setAddingStyle(e.target.value)}
                        className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">All styles</option>
                        {addingStyles.map((s) => {
                          const used = usedPairs.has(`${addingType}|${s}`);
                          return (
                            <option key={s} value={s} disabled={used} style={used ? { color: "#d1d5db" } : undefined}>
                              {s}{used ? " (already added)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {addingType && (
                      <button
                        onClick={() => { setTypeStylePairs((prev) => [...prev, { type: addingType, style: addingStyle }]); setAddingType(""); setAddingStyle(""); }}
                        className="shrink-0 px-3 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 transition-colors">Add</button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-2">Product Types / Styles</label>
                <div className="space-y-1.5">
                  {(entry?.applicabilities ?? []).filter(a => !pendingDeleteIds.has(a.id)).map((app) => (
                    <div key={app.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded text-gray-700">
                        {app.productType} · {app.productStyle}
                      </span>
                      <Tooltip content="Remove this type/style assignment. If products use this phrase, you'll choose a replacement first.">
                        <button onClick={() => startRemoveAssignment(app)}
                          className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none">&times;</button>
                      </Tooltip>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <select value={addingType} onChange={(e) => { setAddingType(e.target.value); setAddingStyle(""); }}
                    className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Add Product Type…</option>
                    {Object.keys(taxonomy).map((t) => {
                      const fullyAssigned = entry?.applicabilities.some((a) => a.productType === t && a.productStyle === "ALL");
                      return (
                        <option key={t} value={t} disabled={!!fullyAssigned} style={fullyAssigned ? { color: "#d1d5db" } : undefined}>
                          {t}{fullyAssigned ? " (already added)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  {addingStyles.length > 0 && (
                    <select value={addingStyle} onChange={(e) => setAddingStyle(e.target.value)}
                      className="flex-1 min-w-0 border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">All styles</option>
                      {addingStyles.map((s) => {
                        const used = usedExistingPairs.has(`${addingType}|${s}`);
                        return (
                          <option key={s} value={s} disabled={used} style={used ? { color: "#d1d5db" } : undefined}>
                            {s}{used ? " (already added)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                  {addingType && (
                    <button onClick={handleAddAssignment}
                      className="shrink-0 px-3 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 transition-colors">Add</button>
                  )}
                </div>
              </div>
            )}

            {saveError && <p className="text-red-600 text-xs">{saveError}</p>}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex flex-col gap-2 shrink-0">
            {mode === "edit" && showKeywordsReminder && (
              <div className="px-3 py-2 bg-blue-100 border border-blue-400 rounded text-sm text-blue-900 font-medium flex items-center justify-between">
                <span>Interest filter enabled. Add keywords in the Interest Filter page.</span>
                <a href="/settings/keywords" className="ml-3 underline hover:no-underline whitespace-nowrap">
                  Go to Keywords →
                </a>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button onClick={onClose} disabled={findPhase === "updating"}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                Close
              </button>
              {!isNew && mode === "edit" && (
                <button onClick={startDeletePhrase}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  Delete phrase
                </button>
              )}
              <div className="flex-1" />
              {mode === "edit" && (
                <>
                  {canFind && (
                    <Tooltip content="Search all your products to find which ones currently use this phrase.">
                      <button onClick={handleFindClick} disabled={saving}
                        className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 transition-colors">
                        Check Usage
                      </button>
                    </Tooltip>
                  )}
                  <button onClick={handleSave} disabled={saving || savedConfirm}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-40 transition-colors">
                    {saving ? "Saving…" : savedConfirm ? "Saved ✓" : "Save"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {findPhase !== "idle" && (
        <AffectedProductsModal
          title="Products using this phrase"
          phase={findPhase}
          products={foundProducts}
          updateLog={updateLog}
          updateResult={updateResult}
          canUpdate={phraseChangedSinceOpen || iconChangedSinceOpen}
          onUpdate={handleUpdate}
          onDismiss={() => { setFindPhase("idle"); setFoundProducts([]); setUpdateLog([]); setUpdateResult(null); }}
        />
      )}
      {mode !== "edit" && (
        <DeletePhraseModal
          mode={mode}
          phraseText={entry?.phrase ?? ""}
          removeApp={removeApp ?? undefined}
          actionPhase={actionPhase}
          actionFoundCount={actionFoundCount}
          actionFoundProducts={actionFoundProducts}
          actionReplacement={actionReplacement}
          actionReplacementPhrases={actionReplacementPhrases}
          actionLog={actionLog}
          actionResult={actionResult}
          actionError={actionError}
          onReplacementChange={setActionReplacement}
          onConfirm={mode === "delete" ? confirmDeletePhrase : confirmRemoveAssignment}
          onCancel={cancelAction}
        />
      )}
      {showIconPicker && (
        <IconPicker current={currentIcon} onSelect={handleIconSelect} onClose={() => setShowIconPicker(false)} />
      )}
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  return <Suspense><LibraryPageInner /></Suspense>;
}

function LibraryPageInner() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"why" | "perfect">(searchParams.get("tab") === "perfect" ? "perfect" : "why");

  useEffect(() => {
    setTab(searchParams.get("tab") === "perfect" ? "perfect" : "why");
  }, [searchParams]);

  const [taxonomy, setTaxonomy] = useState<Record<string, string[]>>(PRODUCT_TAXONOMY);
  const [productType, setProductType] = useState(searchParams.get("type") ?? "");
  const [productStyle, setProductStyle] = useState(searchParams.get("style") ?? "");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");

  const [wctEntries, setWctEntries] = useState<WCTRow[]>([]);
  const [pfPhrases, setPfPhrases] = useState<PFPhraseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [editWctTarget, setEditWctTarget] = useState<WCTRow | null | undefined>(undefined);
  const [editPfTarget, setEditPfTarget] = useState<PFPhraseRow | null | undefined>(undefined);
  const [addingNew, setAddingNew] = useState(false);

  // Keep open WCT modal in sync so searchFormatted stays current after pushes
  const editWctTargetId = editWctTarget?.id;
  useEffect(() => {
    if (!editWctTargetId) return;
    const updated = wctEntries.find((e) => e.id === editWctTargetId);
    if (updated) setEditWctTarget(updated);
  }, [wctEntries, editWctTargetId]);

  // Keep the open PF modal entry in sync with freshly fetched phrase data
  const editPfTargetId = editPfTarget?.id;
  useEffect(() => {
    if (!editPfTargetId) return;
    const updated = pfPhrases.find((p) => p.id === editPfTargetId);
    if (updated) setEditPfTarget(updated);
  }, [pfPhrases, editPfTargetId]);

  useEffect(() => {
    fetch("/api/taxonomy").then((r) => r.ok ? r.json() : null).then((d) => { if (d?.taxonomy) setTaxonomy(d.taxonomy); }).catch(() => {});
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    if (tab === "why") {
      const params = new URLSearchParams({ type: "why" });
      if (productType) params.set("productType", productType);
      if (productStyle) params.set("productStyle", productStyle);
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`/api/library?${params}`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setWctEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
    } else {
      const params = new URLSearchParams({ type: "perfect", format: "phrases" });
      if (productType) params.set("productType", productType);
      if (productStyle) params.set("productStyle", productStyle);
      if (category) params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`/api/library?${params}`);
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setPfPhrases(data.phrases ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [tab, productType, productStyle, category, search]);

  useEffect(() => {
    setCategory(""); setProductStyle(""); setWctEntries([]); setPfPhrases([]);
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  function closeModal() { setEditWctTarget(undefined); setEditPfTarget(undefined); setAddingNew(false); }

  return (
    <div className="flex flex-col h-screen">
      <Nav
        active={tab === "perfect" ? "perfect-for" : "library"}
        subActive={tab === "perfect" ? "phrases" : undefined}
        helpText={tab === "perfect"
          ? "Manage your bank of reusable Perfect For phrases.\nEach phrase has an icon and can be assigned to products by type and style.\nSeasonal phrases only appear on products during their set date window."
          : "Manage your bank of reusable Why People Love This bullet points.\nEach entry can be assigned to products that match its product type.\nUse Find to see which products use an entry, and Update All to push edits out to all of them at once."
        }
      />

      <div className="border-b border-gray-200 px-4 py-3 flex gap-3 items-center bg-white shrink-0 flex-wrap">
        <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm w-44 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        <select value={productType} onChange={(e) => { setProductType(e.target.value); setProductStyle(""); }}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <option value="">All types</option>
          {Object.keys(taxonomy).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={productStyle} onChange={(e) => setProductStyle(e.target.value)}
          disabled={!productType || (taxonomy[productType] ?? []).length === 0}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-40">
          <option value="">All styles</option>
          {(taxonomy[productType] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          <option value="">All categories</option>
          {(tab === "why" ? WCT_CATEGORIES : PF_CATEGORIES).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-sm text-gray-400">{loading ? "Loading…" : `${total} ${total === 1 ? "entry" : "entries"}`}</span>
        <div className="flex-1" />
        <Tooltip content="Create a new entry in the library. It will become available for products of the type and style you choose.">
          <button onClick={() => setAddingNew(true)}
            className="px-4 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 transition-colors">
            + Add new
          </button>
        </Tooltip>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <div className="max-w-5xl mx-auto px-6 py-4">
          {tab === "why" ? (
            <WctTable entries={wctEntries} loading={loading} onEdit={setEditWctTarget} />
          ) : (
            <PfTable phrases={pfPhrases} loading={loading} onEdit={setEditPfTarget} />
          )}
        </div>
      </div>

      {/* WCT modal */}
      {(editWctTarget !== undefined || (addingNew && tab === "why")) && (
        <WCTEditModal
          entry={addingNew ? null : editWctTarget!}
          onClose={closeModal}
          onSaved={() => fetchEntries()}
          taxonomy={taxonomy}
        />
      )}

      {/* PF modal */}
      {(editPfTarget !== undefined || (addingNew && tab === "perfect")) && (
        <PFEditModal
          entry={addingNew ? null : editPfTarget!}
          onClose={closeModal}
          onSaved={() => fetchEntries()}
          taxonomy={taxonomy}
        />
      )}
    </div>
  );
}

// ── Tables ────────────────────────────────────────────────────────────────────

function WctTable({ entries, loading, onEdit }: { entries: WCTRow[]; loading: boolean; onEdit: (e: WCTRow) => void }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <tr>
          <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Type</th>
          <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Style</th>
          <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide w-40">Category</th>
          <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Text</th>
          <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Subtext</th>
          <th className="w-8"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>}
        {!loading && entries.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No entries found</td></tr>}
        {entries.map((e) => (
          <tr key={e.id} onClick={() => onEdit(e)} className="group cursor-pointer hover:bg-gray-50">
            <td className="px-4 py-3 text-gray-500">{e.productType}</td>
            <td className="px-4 py-3 text-gray-500">{e.productStyle}</td>
            <td className="px-4 py-3 w-40"><span className="px-2 py-0.5 rounded-full text-sm bg-blue-50 text-blue-700 whitespace-nowrap">{e.category}</span></td>
            <td className="px-4 py-3 font-medium text-gray-900">{e.text}</td>
            <td className="px-4 py-3 text-gray-500">{e.subtext}</td>
            <td className="px-4 py-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type PfSortCol = "phrase" | "category" | "timeSensitive" | "icon" | "price";

function PfTable({ phrases, loading, onEdit }: { phrases: PFPhraseRow[]; loading: boolean; onEdit: (e: PFPhraseRow) => void }) {
  const [sortCol, setSortCol] = useState<PfSortCol | null>("phrase");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(col: PfSortCol) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  const sorted = sortCol
    ? [...phrases].sort((a, b) => {
        let av: string | number = "";
        let bv: string | number = "";
        if (sortCol === "phrase")       { av = a.phrase; bv = b.phrase; }
        if (sortCol === "category")     { av = a.category; bv = b.category; }
        if (sortCol === "timeSensitive"){ av = a.timeSensitive ?? ""; bv = b.timeSensitive ?? ""; }
        if (sortCol === "icon")         { av = a.icon; bv = b.icon; }
        if (sortCol === "price") {
          av = a.minPrice ?? a.maxPrice ?? 0;
          bv = b.minPrice ?? b.maxPrice ?? 0;
          return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
        }
        return sortDir === "asc" ? (av as string).localeCompare(bv as string) : (bv as string).localeCompare(av as string);
      })
    : phrases;

  function SortHeader({ col, label, className }: { col: PfSortCol; label: string; className?: string }) {
    const active = sortCol === col;
    return (
      <th className={`px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide ${className ?? ""}`}>
        <button onClick={() => toggleSort(col)} className="flex items-center gap-1 hover:text-gray-900 transition-colors">
          {label}
          <span className={active ? "text-gray-900" : "text-gray-300"}>{active && sortDir === "desc" ? "↓" : "↑"}</span>
        </button>
      </th>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
        <tr>
          <SortHeader col="icon" label="Icon" className="w-10" />
          <SortHeader col="phrase" label="Phrase" />
          <SortHeader col="category" label="Category" />
          <SortHeader col="timeSensitive" label="Seasonal" />
          <SortHeader col="price" label="Price" />
          <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Product Types</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {loading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>}
        {!loading && sorted.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No phrases found</td></tr>}
        {sorted.map((p) => (
          <tr key={p.id} onClick={() => onEdit(p)} className="cursor-pointer hover:bg-gray-50">
            <td className="px-4 py-3"><IconImg icon={p.icon} size={20} /></td>
            <td className="px-4 py-3 font-medium text-gray-900">{p.phrase}</td>
            <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-sm bg-purple-50 text-purple-700">{p.category}</span></td>
            <td className="px-4 py-3">
              {p.timeSensitive === "mothers-day" && <Tooltip content="This phrase only shows on products during its Mother's Day date window, set in Seasonal Settings."><span className="px-2 py-0.5 rounded-full text-xs bg-pink-50 text-pink-700 cursor-default">Mother&apos;s Day</span></Tooltip>}
              {p.timeSensitive === "fathers-day" && <Tooltip content="This phrase only shows on products during its Father's Day date window, set in Seasonal Settings."><span className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 cursor-default">Father&apos;s Day</span></Tooltip>}
              {p.timeSensitive === "valentines-day" && <Tooltip content="This phrase only shows on products during its Valentine's Day date window, set in Seasonal Settings."><span className="px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-700 cursor-default">Valentine&apos;s Day</span></Tooltip>}
            </td>
            <td className="px-4 py-3 text-xs text-gray-500">
              {p.minPrice !== undefined && p.maxPrice !== undefined && `£${p.minPrice} – £${p.maxPrice}`}
              {p.minPrice !== undefined && p.maxPrice === undefined && `£${p.minPrice}+`}
              {p.minPrice === undefined && p.maxPrice !== undefined && `up to £${p.maxPrice}`}
            </td>
            <td className="px-4 py-3 text-gray-500 text-xs">
              {p.applicabilities.length} type{p.applicabilities.length !== 1 ? "s" : ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
