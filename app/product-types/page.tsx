"use client";

import { useState, useEffect } from "react";
import Nav from "@/components/Nav";
import { Tooltip } from "@/components/Tooltip";

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

  useEffect(() => {
    fetch("/api/taxonomy")
      .then((r) => r.json())
      .then((d) => setTaxonomy(d.taxonomy ?? {}))
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

  function saveTypeEdit() {
    const name = editTypeName.trim();
    if (!name || !editingType) return;
    if (name === editingType) { setEditingType(null); return; }
    if (taxonomy[name]) return; // already exists
    const next: Taxonomy = {};
    for (const [k, v] of Object.entries(taxonomy)) {
      next[k === editingType ? name : k] = v;
    }
    persist(next);
    setEditingType(null);
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
    persist({ ...taxonomy, [type]: taxonomy[type].map((s) => (s === style ? name : s)) });
    setEditingStyle(null);
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
    </div>
  );
}
