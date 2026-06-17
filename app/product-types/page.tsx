"use client";

import { useState, useEffect, useRef } from "react";
import Nav from "@/components/Nav";
import { Tooltip } from "@/components/Tooltip";
import AffectedProductsModal from "@/components/AffectedProductsModal";
import { runCascadeStream, type CascadeProgressEvent } from "@/lib/sse-cascade";

type Taxonomy = Record<string, string[]>;

interface DeleteTarget {
  type: string;
  style?: string;
}

interface UsageState {
  loading: boolean;
  count: number | null;
  products: string[] | null;
}

export default function ProductTypesPage() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Add type form
  const [addingType, setAddingType] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");

  // Edit type name
  const [editingType, setEditingType] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState("");

  // Add style
  const [addingStyleFor, setAddingStyleFor] = useState<string | null>(null);
  const [newStyleName, setNewStyleName] = useState("");

  // Edit style
  const [editingStyle, setEditingStyle] = useState<{ type: string; style: string } | null>(null);
  const [editStyleName, setEditStyleName] = useState("");

  // New style prompt
  const [newStylePrompt, setNewStylePrompt] = useState<{ type: string; style: string } | null>(null);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [usage, setUsage] = useState<UsageState>({ loading: false, count: null, products: null });

  // Rename style cascade modal
  const [renameTarget, setRenameTarget] = useState<{ type: string; oldStyle: string; newStyle: string } | null>(null);
  const [renamePhase, setRenamePhase] = useState<"finding" | "found" | "updating" | "done">("finding");
  const [renameProducts, setRenameProducts] = useState<{ id: string; title: string }[]>([]);
  const [renameUpdateLog, setRenameUpdateLog] = useState<{ title: string; status: "updated" | "error" }[]>([]);
  const [renameUpdateResult, setRenameUpdateResult] = useState<{ updated: number; skipped: number; failed: number } | null>(null);
  const [renameUpdatedIds, setRenameUpdatedIds] = useState<{ id: string; title: string }[]>([]);
  const [renameFailedIds, setRenameFailedIds] = useState<{ id: string; title: string }[]>([]);
  const [renameReverting, setRenameReverting] = useState(false);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameLibraryFailed, setRenameLibraryFailed] = useState(false);
  const renameUpdatingRef = useRef(false);

  // Rename type cascade modal
  const [typeRenameTarget, setTypeRenameTarget] = useState<{ oldType: string; newType: string } | null>(null);
  const [typeRenamePhase, setTypeRenamePhase] = useState<"finding" | "found" | "updating" | "done">("finding");
  const [typeRenameProducts, setTypeRenameProducts] = useState<{ id: string; title: string }[]>([]);
  const [typeRenameUpdateLog, setTypeRenameUpdateLog] = useState<{ title: string; status: "updated" | "error" }[]>([]);
  const [typeRenameUpdateResult, setTypeRenameUpdateResult] = useState<{ updated: number; skipped: number; failed: number } | null>(null);
  const [typeRenameUpdatedIds, setTypeRenameUpdatedIds] = useState<{ id: string; title: string }[]>([]);
  const [typeRenameFailedIds, setTypeRenameFailedIds] = useState<{ id: string; title: string }[]>([]);
  const [typeRenameReverting, setTypeRenameReverting] = useState(false);
  const [typeRenameBusy, setTypeRenameBusy] = useState(false);
  const [typeRenameLibraryFailed, setTypeRenameLibraryFailed] = useState(false);
  const typeRenameUpdatingRef = useRef(false);

  useEffect(() => {
    fetch("/api/taxonomy")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Failed to load taxonomy");
        setTaxonomy(d.taxonomy ?? {});
      })
      .catch((err) => setLoadError(err.message ?? "Failed to load taxonomy"))
      .finally(() => setLoading(false));
  }, []);

  async function persist(next: Taxonomy) {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/taxonomy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxonomy: next }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error ?? "Failed to save — please try again.");
      return;
    }
    setTaxonomy(next);
  }

  // ── Type operations ────────────────────────────────────────────────────────

  function addType() {
    const name = newTypeName.trim();
    if (!name || taxonomy[name]) return;
    persist({ ...taxonomy, [name]: [] });
    setNewTypeName("");
    setAddingType(false);
  }

  function renamedTaxonomyKey(oldType: string, newType: string): Taxonomy {
    const next: Taxonomy = {};
    for (const [k, v] of Object.entries(taxonomy)) {
      next[k === oldType ? newType : k] = v;
    }
    return next;
  }

  function saveTypeEdit() {
    const name = editTypeName.trim();
    if (!name || !editingType) return;
    if (name === editingType) { setEditingType(null); return; }
    if (taxonomy[name]) return; // already exists
    const oldType = editingType;
    setEditingType(null);

    setTypeRenameTarget({ oldType, newType: name });
    setTypeRenamePhase("finding");
    setTypeRenameProducts([]);
    setTypeRenameUpdateLog([]);
    setTypeRenameUpdateResult(null);
    setTypeRenameUpdatedIds([]);
    setTypeRenameFailedIds([]);
    setTypeRenameReverting(false);

    fetch(`/api/taxonomy/usage?type=${encodeURIComponent(oldType)}`)
      .then((r) => r.json())
      .then((d) => {
        const titles: string[] = d.products ?? [];
        if (titles.length === 0) {
          // No products affected — still need to update the library entries
          runCascadeStream("/api/taxonomy/rename-type", { oldType, newType: name, onlyLibrary: true }, () => {})
            .then(({ libraryFailed, receivedDone }) => {
              if (libraryFailed || !receivedDone) {
                setSaveError(`Renamed "${oldType}" → "${name}", but updating the matching library entries failed. Edit the type name again to retry.`);
                setTypeRenameTarget(null);
                return;
              }
              persist(renamedTaxonomyKey(oldType, name));
              setTypeRenameTarget(null);
            });
        } else {
          setTypeRenameProducts(titles.map((t) => ({ id: t, title: t })));
          setTypeRenamePhase("found");
        }
      })
      .catch(() => setTypeRenameTarget(null));
  }

  function confirmDeleteType(type: string) {
    setDeleteTarget({ type });
    setUsage({ loading: true, count: null, products: null });
    fetch(`/api/taxonomy/usage?type=${encodeURIComponent(type)}`)
      .then((r) => r.json())
      .then((d) => setUsage({ loading: false, count: d.count ?? 0, products: d.products ?? [] }))
      .catch(() => setUsage({ loading: false, count: null, products: null }));
  }

  function deleteType() {
    if (!deleteTarget) return;
    const next = { ...taxonomy };
    delete next[deleteTarget.type];
    persist(next);
    setDeleteTarget(null);
  }

  // ── Style operations ───────────────────────────────────────────────────────

  function addStyle(type: string) {
    const name = newStyleName.trim();
    if (!name || !taxonomy[type] || taxonomy[type].includes(name)) return;
    persist({ ...taxonomy, [type]: [...taxonomy[type], name] });
    setNewStyleName("");
    setAddingStyleFor(null);
    setNewStylePrompt({ type, style: name });
  }

  function saveStyleEdit() {
    if (!editingStyle) return;
    const name = editStyleName.trim();
    if (!name) return;
    const { type, style } = editingStyle;
    if (name === style) { setEditingStyle(null); return; }
    if (taxonomy[type].includes(name)) return;
    setEditingStyle(null);

    setRenameTarget({ type, oldStyle: style, newStyle: name });
    setRenamePhase("finding");
    setRenameProducts([]);
    setRenameUpdateLog([]);
    setRenameUpdateResult(null);
    setRenameUpdatedIds([]);
    setRenameFailedIds([]);
    setRenameReverting(false);

    fetch(`/api/taxonomy/usage?type=${encodeURIComponent(type)}&style=${encodeURIComponent(style)}`)
      .then((r) => r.json())
      .then((d) => {
        const titles: string[] = d.products ?? [];
        if (titles.length === 0) {
          // No products affected — still need to update the library entries
          runCascadeStream("/api/taxonomy/rename-style", { type, oldStyle: style, newStyle: name, onlyLibrary: true }, () => {})
            .then(({ libraryFailed, receivedDone }) => {
              if (libraryFailed || !receivedDone) {
                setSaveError(`Renamed "${style}" → "${name}", but updating the matching library entries failed. Edit the style name again to retry.`);
                setRenameTarget(null);
                return;
              }
              persist({ ...taxonomy, [type]: taxonomy[type].map((s) => (s === style ? name : s)) });
              setRenameTarget(null);
            });
        } else {
          setRenameProducts(titles.map((t) => ({ id: t, title: t })));
          setRenamePhase("found");
        }
      })
      .catch(() => setRenameTarget(null));
  }

  function runRenameCascade(
    body: Record<string, unknown>,
    onProgress: (ev: CascadeProgressEvent) => void
  ): Promise<{ failed: number; receivedDone: boolean; libraryFailed: boolean }> {
    return runCascadeStream("/api/taxonomy/rename-style", body, onProgress);
  }

  async function handleRenameUpdate() {
    if (!renameTarget || renameUpdatingRef.current) return;
    renameUpdatingRef.current = true;
    setRenamePhase("updating");
    setRenameUpdateLog([]);
    setRenameUpdateResult(null);
    setRenameReverting(false);
    setRenameLibraryFailed(false);

    const { type, oldStyle, newStyle } = renameTarget;
    const updatedIds: { id: string; title: string }[] = [];
    const failedIds: { id: string; title: string }[] = [];

    const { receivedDone, libraryFailed } = await runRenameCascade({ type, oldStyle, newStyle }, (ev) => {
      setRenameUpdateLog((prev) => [...prev, { title: ev.title, status: ev.status }]);
      if (!ev.id) return;
      (ev.status === "updated" ? updatedIds : failedIds).push({ id: ev.id, title: ev.title });
    });

    renameUpdatingRef.current = false;
    setRenameUpdatedIds(updatedIds);
    setRenameFailedIds(failedIds);
    setRenameUpdateResult({ updated: updatedIds.length, skipped: 0, failed: failedIds.length });
    setRenameLibraryFailed(libraryFailed);

    if (!receivedDone) { setRenamePhase("found"); return; }
    setRenamePhase("done");
    if (failedIds.length === 0) {
      await persist({ ...taxonomy, [type]: taxonomy[type].map((s) => (s === oldStyle ? newStyle : s)) });
    }
  }

  async function retryRenameLibrary() {
    if (!renameTarget || renameBusy) return;
    setRenameBusy(true);
    const { type, oldStyle, newStyle } = renameTarget;
    const { libraryFailed } = await runRenameCascade({ type, oldStyle, newStyle, onlyLibrary: true }, () => {});
    setRenameLibraryFailed(libraryFailed);
    setRenameBusy(false);
  }

  async function retryRenameUpdate() {
    if (!renameTarget || renameFailedIds.length === 0 || renameBusy) return;
    setRenameBusy(true);
    setRenameUpdateLog([]);

    const { type, oldStyle, newStyle } = renameTarget;
    const [fromStyle, toStyle] = renameReverting ? [newStyle, oldStyle] : [oldStyle, newStyle];
    const newUpdated: { id: string; title: string }[] = [];
    const stillFailed: { id: string; title: string }[] = [];

    await runRenameCascade(
      { type, oldStyle: fromStyle, newStyle: toStyle, retryIds: renameFailedIds.map((p) => p.id), skipLibrary: true },
      (ev) => {
        setRenameUpdateLog((prev) => [...prev, { title: ev.title, status: ev.status }]);
        if (!ev.id) return;
        (ev.status === "updated" ? newUpdated : stillFailed).push({ id: ev.id, title: ev.title });
      }
    );

    const mergedUpdated = [...renameUpdatedIds, ...newUpdated];
    setRenameUpdatedIds(mergedUpdated);
    setRenameFailedIds(stillFailed);
    setRenameUpdateResult({ updated: mergedUpdated.length, skipped: 0, failed: stillFailed.length });
    setRenameBusy(false);

    if (stillFailed.length > 0) return;

    if (renameReverting) {
      setRenameTarget(null);
    } else {
      await persist({ ...taxonomy, [type]: taxonomy[type].map((s) => (s === oldStyle ? newStyle : s)) });
    }
  }

  async function cancelAndRevertRenameUpdate() {
    if (!renameTarget || renameBusy) return;
    if (renameUpdatedIds.length === 0) { setRenameTarget(null); return; }

    setRenameBusy(true);
    setRenameReverting(true);
    setRenameUpdateLog([]);

    const { type, oldStyle, newStyle } = renameTarget;
    const newUpdated: { id: string; title: string }[] = [];
    const stillFailed: { id: string; title: string }[] = [];

    const { libraryFailed } = await runRenameCascade(
      { type, oldStyle: newStyle, newStyle: oldStyle, retryIds: renameUpdatedIds.map((p) => p.id), skipLibrary: false },
      (ev) => {
        setRenameUpdateLog((prev) => [...prev, { title: ev.title, status: ev.status }]);
        if (!ev.id) return;
        (ev.status === "updated" ? newUpdated : stillFailed).push({ id: ev.id, title: ev.title });
      }
    );

    setRenameUpdatedIds(stillFailed);
    setRenameFailedIds(stillFailed);
    setRenameUpdateResult({ updated: newUpdated.length, skipped: 0, failed: stillFailed.length });
    setRenameLibraryFailed(libraryFailed);
    setRenameBusy(false);

    if (stillFailed.length === 0 && !libraryFailed) setRenameTarget(null);
  }

  function dismissRenameModal() {
    if (renameTarget && renamePhase === "found") {
      // User skipped updating products — still rename in taxonomy
      const { type, oldStyle, newStyle } = renameTarget;
      persist({ ...taxonomy, [type]: taxonomy[type].map((s) => (s === oldStyle ? newStyle : s)) });
    }
    setRenameTarget(null);
  }

  function runTypeRenameCascade(
    body: Record<string, unknown>,
    onProgress: (ev: CascadeProgressEvent) => void
  ): Promise<{ failed: number; receivedDone: boolean; libraryFailed: boolean }> {
    return runCascadeStream("/api/taxonomy/rename-type", body, onProgress);
  }

  async function handleTypeRenameUpdate() {
    if (!typeRenameTarget || typeRenameUpdatingRef.current) return;
    typeRenameUpdatingRef.current = true;
    setTypeRenamePhase("updating");
    setTypeRenameUpdateLog([]);
    setTypeRenameUpdateResult(null);
    setTypeRenameReverting(false);
    setTypeRenameLibraryFailed(false);

    const { oldType, newType } = typeRenameTarget;
    const updatedIds: { id: string; title: string }[] = [];
    const failedIds: { id: string; title: string }[] = [];

    const { receivedDone, libraryFailed } = await runTypeRenameCascade({ oldType, newType }, (ev) => {
      setTypeRenameUpdateLog((prev) => [...prev, { title: ev.title, status: ev.status }]);
      if (!ev.id) return;
      (ev.status === "updated" ? updatedIds : failedIds).push({ id: ev.id, title: ev.title });
    });

    typeRenameUpdatingRef.current = false;
    setTypeRenameUpdatedIds(updatedIds);
    setTypeRenameFailedIds(failedIds);
    setTypeRenameUpdateResult({ updated: updatedIds.length, skipped: 0, failed: failedIds.length });
    setTypeRenameLibraryFailed(libraryFailed);

    if (!receivedDone) { setTypeRenamePhase("found"); return; }
    setTypeRenamePhase("done");
    if (failedIds.length === 0) {
      await persist(renamedTaxonomyKey(oldType, newType));
    }
  }

  async function retryTypeRenameLibrary() {
    if (!typeRenameTarget || typeRenameBusy) return;
    setTypeRenameBusy(true);
    const { oldType, newType } = typeRenameTarget;
    const { libraryFailed } = await runTypeRenameCascade({ oldType, newType, onlyLibrary: true }, () => {});
    setTypeRenameLibraryFailed(libraryFailed);
    setTypeRenameBusy(false);
  }

  async function retryTypeRenameUpdate() {
    if (!typeRenameTarget || typeRenameFailedIds.length === 0 || typeRenameBusy) return;
    setTypeRenameBusy(true);
    setTypeRenameUpdateLog([]);

    const { oldType, newType } = typeRenameTarget;
    const [fromType, toType] = typeRenameReverting ? [newType, oldType] : [oldType, newType];
    const newUpdated: { id: string; title: string }[] = [];
    const stillFailed: { id: string; title: string }[] = [];

    await runTypeRenameCascade(
      { oldType: fromType, newType: toType, retryIds: typeRenameFailedIds.map((p) => p.id), skipLibrary: true },
      (ev) => {
        setTypeRenameUpdateLog((prev) => [...prev, { title: ev.title, status: ev.status }]);
        if (!ev.id) return;
        (ev.status === "updated" ? newUpdated : stillFailed).push({ id: ev.id, title: ev.title });
      }
    );

    const mergedUpdated = [...typeRenameUpdatedIds, ...newUpdated];
    setTypeRenameUpdatedIds(mergedUpdated);
    setTypeRenameFailedIds(stillFailed);
    setTypeRenameUpdateResult({ updated: mergedUpdated.length, skipped: 0, failed: stillFailed.length });
    setTypeRenameBusy(false);

    if (stillFailed.length > 0) return;

    if (typeRenameReverting) {
      setTypeRenameTarget(null);
    } else {
      await persist(renamedTaxonomyKey(oldType, newType));
    }
  }

  async function cancelAndRevertTypeRenameUpdate() {
    if (!typeRenameTarget || typeRenameBusy) return;
    if (typeRenameUpdatedIds.length === 0) { setTypeRenameTarget(null); return; }

    setTypeRenameBusy(true);
    setTypeRenameReverting(true);
    setTypeRenameUpdateLog([]);

    const { oldType, newType } = typeRenameTarget;
    const newUpdated: { id: string; title: string }[] = [];
    const stillFailed: { id: string; title: string }[] = [];

    const { libraryFailed } = await runTypeRenameCascade(
      { oldType: newType, newType: oldType, retryIds: typeRenameUpdatedIds.map((p) => p.id), skipLibrary: false },
      (ev) => {
        setTypeRenameUpdateLog((prev) => [...prev, { title: ev.title, status: ev.status }]);
        if (!ev.id) return;
        (ev.status === "updated" ? newUpdated : stillFailed).push({ id: ev.id, title: ev.title });
      }
    );

    setTypeRenameUpdatedIds(stillFailed);
    setTypeRenameFailedIds(stillFailed);
    setTypeRenameUpdateResult({ updated: newUpdated.length, skipped: 0, failed: stillFailed.length });
    setTypeRenameLibraryFailed(libraryFailed);
    setTypeRenameBusy(false);

    if (stillFailed.length === 0 && !libraryFailed) setTypeRenameTarget(null);
  }

  function dismissTypeRenameModal() {
    if (typeRenameTarget && typeRenamePhase === "found") {
      // User skipped updating products — still rename in taxonomy
      const { oldType, newType } = typeRenameTarget;
      persist(renamedTaxonomyKey(oldType, newType));
    }
    setTypeRenameTarget(null);
  }

  function confirmDeleteStyle(type: string, style: string) {
    setDeleteTarget({ type, style });
    setUsage({ loading: true, count: null, products: null });
    fetch(`/api/taxonomy/usage?type=${encodeURIComponent(type)}&style=${encodeURIComponent(style)}`)
      .then((r) => r.json())
      .then((d) => setUsage({ loading: false, count: d.count ?? 0, products: d.products ?? [] }))
      .catch(() => setUsage({ loading: false, count: null, products: null }));
  }

  function deleteStyle() {
    if (!deleteTarget?.style) return;
    const { type, style } = deleteTarget;
    persist({ ...taxonomy, [type]: taxonomy[type].filter((s) => s !== style) });
    setDeleteTarget(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDeleteType = deleteTarget && !deleteTarget.style;
  const canDelete = !usage.loading && usage.count === 0;

  return (
    <div className="flex flex-col h-screen">
      <Nav active="product-types" helpText={"Set up your product taxonomy. These Types and Styles are used to classify products.\nThey control which library content is suggested when generating product copy.\nTypes and Styles can only be deleted when no products are using them."} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-6 py-8">

          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-semibold text-gray-900">Product Types</h1>
            <div className="flex items-center gap-2">
              {saving && <span className="text-xs text-gray-400">Saving…</span>}
              {saveError && <span className="text-xs text-red-500">{saveError}</span>}
              {!addingType && (
                <button
                  onClick={() => { setAddingType(true); setNewTypeName(""); }}
                  className="px-3 py-1.5 bg-gray-900 text-white text-sm rounded hover:bg-gray-700 transition-colors"
                >
                  + Add Type
                </button>
              )}
            </div>
          </div>

          {/* Add type form */}
          {addingType && (
            <div className="mb-4 flex gap-2 items-center p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <input
                autoFocus
                type="text"
                placeholder="Type name…"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addType(); if (e.key === "Escape") setAddingType(false); }}
                className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={addType} className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">Save</button>
              <button onClick={() => setAddingType(false)} className="px-3 py-1.5 text-gray-500 text-sm rounded hover:bg-gray-100">Cancel</button>
            </div>
          )}

          {loading && <p className="text-gray-400 text-sm">Loading…</p>}
          {loadError && (
            <p className="text-red-600 text-sm mb-2">Couldn't load taxonomy: {loadError}</p>
          )}

          <div className="border border-gray-200 rounded-lg bg-white overflow-hidden w-full">
            {/* Column headings */}
            <div className="flex items-stretch border-b border-gray-200 bg-gray-100">
              <div className="w-64 shrink-0 border-r border-gray-200 px-4 py-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Product Type</span>
              </div>
              <div className="flex-1 px-4 py-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Product Style</span>
              </div>
            </div>

            {Object.entries(taxonomy).map(([type, styles], i, arr) => (
              <div key={type} className={`flex items-stretch${i < arr.length - 1 ? " border-b border-gray-100" : ""}`}>

                {/* Type column */}
                <div className="w-64 shrink-0 border-r border-gray-100 bg-gray-50 px-4 py-3 flex items-start">
                  {editingType === type ? (
                    <div className="flex items-center gap-2 w-full">
                      <input
                        autoFocus
                        type="text"
                        value={editTypeName}
                        onChange={(e) => setEditTypeName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") saveTypeEdit(); if (e.key === "Escape") setEditingType(null); }}
                        className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button onClick={saveTypeEdit} className="text-xs text-blue-600 hover:underline shrink-0">Save</button>
                      <button onClick={() => setEditingType(null)} className="text-xs text-gray-400 hover:underline shrink-0">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 w-full">
                      <span className="flex-1 font-medium text-gray-900 text-sm">{type}</span>
                      <button onClick={() => { setEditingType(type); setEditTypeName(type); }} className="text-xs text-gray-400 hover:text-gray-700 shrink-0">Edit</button>
                      <Tooltip content="Remove this product type. You'll be shown how many products use it. It can only be deleted when no products are assigned to it.">
                        <button onClick={() => confirmDeleteType(type)} className="text-gray-300 hover:text-red-500 transition-colors leading-none shrink-0">&times;</button>
                      </Tooltip>
                    </div>
                  )}
                </div>

                {/* Styles column */}
                <div className="flex-1 px-4 py-3 flex flex-wrap gap-2 items-center">
                  {styles.map((style) => (
                    <span key={style} className="group inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 rounded-full text-sm text-gray-700">
                      {editingStyle?.type === type && editingStyle?.style === style ? (
                        <>
                          <input
                            autoFocus
                            type="text"
                            value={editStyleName}
                            onChange={(e) => setEditStyleName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveStyleEdit(); if (e.key === "Escape") setEditingStyle(null); }}
                            className="w-28 px-1 py-0 border-b border-gray-400 bg-transparent text-sm focus:outline-none"
                          />
                          <button onClick={saveStyleEdit} className="text-blue-500 hover:text-blue-700 text-xs">✓</button>
                          <button onClick={() => setEditingStyle(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => { setEditingStyle({ type, style }); setEditStyleName(style); }}
                            className="hover:text-blue-600"
                          >
                            {style}
                          </button>
                          <Tooltip content="Remove this style. You'll be shown how many products use it. It can only be deleted when no products are assigned to it.">
                            <button
                              onClick={() => confirmDeleteStyle(type, style)}
                              className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity leading-none"
                            >
                              ×
                            </button>
                          </Tooltip>
                        </>
                      )}
                    </span>
                  ))}

                  {/* Add style */}
                  {addingStyleFor === type ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        autoFocus
                        type="text"
                        placeholder="Style name…"
                        value={newStyleName}
                        onChange={(e) => setNewStyleName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addStyle(type); if (e.key === "Escape") setAddingStyleFor(null); }}
                        className="w-32 px-2 py-0.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button onClick={() => addStyle(type)} className="text-xs text-blue-600 hover:underline">Add</button>
                      <button onClick={() => setAddingStyleFor(null)} className="text-xs text-gray-400 hover:underline">Cancel</button>
                    </span>
                  ) : (
                    <Tooltip content="Add a new style option to this type. You'll be prompted to create library content for it.">
                      <button
                        onClick={() => { setAddingStyleFor(type); setNewStyleName(""); }}
                        className="text-xs text-gray-400 hover:text-blue-600 px-1"
                      >
                        + Add Style
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* New style prompt */}
      {newStylePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <h2 className="font-semibold text-gray-900 text-base mb-2">
              Style &ldquo;{newStylePrompt.style}&rdquo; added
            </h2>
            <p className="text-sm text-gray-600">
              Now add <strong>Why Choose This</strong> and <strong>Perfect For</strong> phrases for{" "}
              <strong>{newStylePrompt.type} · {newStylePrompt.style}</strong> so the assignment engine has content to work with.
            </p>
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setNewStylePrompt(null)}
                className="px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-700"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">
                Delete {isDeleteType ? "type" : "style"}: {isDeleteType ? deleteTarget.type : deleteTarget.style}
              </span>
              <button
                onClick={() => setDeleteTarget(null)}
                className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-3 space-y-2 text-sm">
              {usage.loading && (
                <p className="text-gray-400">Checking product usage…</p>
              )}
              {!usage.loading && usage.count !== null && usage.count === 0 && (
                <p className="text-gray-700">No products use this {isDeleteType ? "type" : "style"}. Safe to delete.</p>
              )}
              {!usage.loading && usage.count !== null && usage.count > 0 && (
                <>
                  <p className="text-gray-700">
                    <strong>{usage.count}</strong> product{usage.count !== 1 ? "s" : ""} use this {isDeleteType ? "type" : "style"}.
                    Reassign these products before deleting.
                  </p>
                  {usage.products && usage.products.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-0.5 border border-gray-200 rounded p-2 bg-gray-50">
                      {usage.products.map((title) => (
                        <div key={title} className="text-gray-700">{title}</div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            {!usage.loading && usage.count !== null && (
              <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                {canDelete && (
                  <button
                    onClick={isDeleteType ? deleteType : deleteStyle}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rename style cascade modal */}
      {renameTarget && renamePhase !== "finding" && (
        <AffectedProductsModal
          title={`Rename style: ${renameTarget.oldStyle} → ${renameTarget.newStyle}`}
          subject="style"
          phase={renamePhase}
          products={renameProducts}
          updateLog={renameUpdateLog}
          updateResult={renameUpdateResult}
          canUpdate={true}
          onUpdate={handleRenameUpdate}
          onDismiss={dismissRenameModal}
          onRetry={renameFailedIds.length > 0 ? retryRenameUpdate : undefined}
          onRevert={!renameReverting && renameUpdatedIds.length > 0 ? cancelAndRevertRenameUpdate : undefined}
          libraryFailed={renameLibraryFailed}
          onRetryLibrary={retryRenameLibrary}
          busy={renameBusy}
          notCommittedMessage={
            renameReverting
              ? `Reverting — ${renameFailedIds.length} product${renameFailedIds.length !== 1 ? "s" : ""} still need reverting.`
              : `Style not renamed yet — ${renameFailedIds.length} product${renameFailedIds.length !== 1 ? "s" : ""} still need updating.`
          }
        />
      )}

      {/* Rename type cascade modal */}
      {typeRenameTarget && typeRenamePhase !== "finding" && (
        <AffectedProductsModal
          title={`Rename type: ${typeRenameTarget.oldType} → ${typeRenameTarget.newType}`}
          subject="type"
          phase={typeRenamePhase}
          products={typeRenameProducts}
          updateLog={typeRenameUpdateLog}
          updateResult={typeRenameUpdateResult}
          canUpdate={true}
          onUpdate={handleTypeRenameUpdate}
          onDismiss={dismissTypeRenameModal}
          onRetry={typeRenameFailedIds.length > 0 ? retryTypeRenameUpdate : undefined}
          onRevert={!typeRenameReverting && typeRenameUpdatedIds.length > 0 ? cancelAndRevertTypeRenameUpdate : undefined}
          libraryFailed={typeRenameLibraryFailed}
          onRetryLibrary={retryTypeRenameLibrary}
          busy={typeRenameBusy}
          notCommittedMessage={
            typeRenameReverting
              ? `Reverting — ${typeRenameFailedIds.length} product${typeRenameFailedIds.length !== 1 ? "s" : ""} still need reverting.`
              : `Type not renamed yet — ${typeRenameFailedIds.length} product${typeRenameFailedIds.length !== 1 ? "s" : ""} still need updating.`
          }
        />
      )}
    </div>
  );
}
