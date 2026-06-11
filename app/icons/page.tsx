"use client";

import { useState, useEffect, useRef } from "react";
import Nav from "@/components/Nav";
import { Tooltip } from "@/components/Tooltip";
import type { UploadedIcon } from "@/lib/uploaded-icons-store";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">{children}</span>
      <div className="flex-1 border-t border-gray-200" />
    </div>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
  );
}

interface DeleteModal {
  name: string;
  svg: string;
  status: "checking" | "clear" | "in-use" | "error";
  products: string[];
  phrases: string[];
  deleting: boolean;
  errorMsg?: string;
}

export default function IconsPage() {
  const [builtInIcons, setBuiltInIcons] = useState<string[]>([]);
  const [uploadedIcons, setUploadedIcons] = useState<UploadedIcon[]>([]);
  const [loadingIcons, setLoadingIcons] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rename state
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [renameError, setRenameError] = useState("");

  // Delete state
  const [deleteModal, setDeleteModal] = useState<DeleteModal | null>(null);

  // Unused-only filter for built-ins
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);
  const [usedBuiltins, setUsedBuiltins] = useState<Set<string> | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  useEffect(() => {
    fetch("/api/icons")
      .then((r) => r.json())
      .then((d) => {
        setBuiltInIcons(d.builtIn ?? []);
        setUploadedIcons(d.uploaded ?? []);
        setLoadingIcons(false);
      });
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setUploadError("");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/icons", { method: "POST", body });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) {
      setUploadError(data.error ?? "Upload failed");
    } else {
      setUploadedIcons((prev) => {
        const filtered = prev.filter((i) => i.name !== data.name);
        return [...filtered, { name: data.name, svg: data.svg }];
      });
    }
  }

  function startEdit(name: string) {
    setEditingName(name);
    setEditValue(name);
    setRenameError("");
  }

  async function handleSaveName(oldName: string) {
    const sanitized = editValue
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");

    if (!sanitized || sanitized === oldName) {
      setEditingName(null);
      return;
    }

    setSavingName(true);
    setRenameError("");

    const res = await fetch("/api/icons", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldName, newName: sanitized }),
    });
    const data = await res.json();
    setSavingName(false);

    if (!res.ok) {
      setRenameError(data.error ?? "Rename failed");
      return;
    }

    setUploadedIcons((prev) =>
      prev.map((i) => (i.name === oldName ? { ...i, name: data.name } : i))
    );
    setEditingName(null);
  }

  async function handleDeleteClick(name: string, svg: string) {
    setDeleteModal({ name, svg, status: "checking", products: [], phrases: [], deleting: false });

    const res = await fetch(`/api/icons?check=${encodeURIComponent(name)}`);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      setDeleteModal((prev) =>
        prev ? { ...prev, status: "error", errorMsg: errData.error ?? "Could not check icon usage" } : null
      );
      return;
    }
    const data = await res.json();
    setDeleteModal((prev) =>
      prev
        ? {
            ...prev,
            status: data.products.length > 0 || data.phrases.length > 0 ? "in-use" : "clear",
            products: data.products ?? [],
            phrases: data.phrases ?? [],
          }
        : null
    );
  }

  async function handleConfirmDelete() {
    if (!deleteModal) return;
    setDeleteModal((prev) => (prev ? { ...prev, deleting: true } : null));

    const res = await fetch(`/api/icons?name=${encodeURIComponent(deleteModal.name)}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setUploadedIcons((prev) => prev.filter((i) => i.name !== deleteModal.name));
      setDeleteModal(null);
    } else {
      const data = await res.json();
      setDeleteModal((prev) =>
        prev
          ? {
              ...prev,
              deleting: false,
              status: "in-use",
              products: data.products ?? [],
              phrases: data.phrases ?? [],
            }
          : null
      );
    }
  }

  async function handleToggleUnusedOnly() {
    const next = !showUnusedOnly;
    setShowUnusedOnly(next);
    if (next && usedBuiltins === null) {
      setLoadingUsage(true);
      try {
        const res = await fetch("/api/icons?builtinUsage=true");
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();
        setUsedBuiltins(new Set<string>(data.usedBuiltins ?? []));
      } catch {
        setShowUnusedOnly(false);
      } finally {
        setLoadingUsage(false);
      }
    }
  }

  const displayedBuiltins =
    showUnusedOnly && usedBuiltins !== null
      ? builtInIcons.filter((n) => !usedBuiltins.has(n))
      : builtInIcons;

  return (
    <div className="flex flex-col min-h-screen">
      <Nav
        active="perfect-for"
        subActive="icons"
        helpText={
          "Manage the icons used alongside Perfect For phrases.\nUpload your own SVG files or use the built-in icon set.\nAssign icons to phrases from the Perfect For Phrases page."
        }
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-10">
          <section>
            <SectionHeading>Icon Library</SectionHeading>

            {loadingIcons ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <>
                {/* Built-in icons */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    Built-in (
                    {showUnusedOnly && usedBuiltins !== null
                      ? `${displayedBuiltins.length} of ${builtInIcons.length}`
                      : builtInIcons.length}
                    )
                  </p>
                  <button
                    onClick={handleToggleUnusedOnly}
                    disabled={loadingUsage}
                    className={`text-xs px-2.5 py-1 rounded border transition-colors disabled:opacity-50 ${
                      showUnusedOnly
                        ? "border-blue-400 bg-blue-50 text-blue-700"
                        : "border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {loadingUsage ? "Checking…" : "Unused only"}
                  </button>
                </div>
                {showUnusedOnly && usedBuiltins !== null && displayedBuiltins.length === 0 ? (
                  <p className="text-sm text-gray-400 italic mb-8">All built-in icons are in use.</p>
                ) : (
                  <div className="grid grid-cols-6 sm:grid-cols-10 gap-2 mb-8">
                    {displayedBuiltins.map((name) => (
                      <div
                        key={name}
                        className="flex flex-col items-center gap-1 p-2 rounded-lg border border-gray-100 bg-white"
                      >
                        <img src={`/icons/${name}.svg`} alt={name} className="w-6 h-6" />
                        <span className="text-[11px] text-gray-500 truncate w-full text-center">{name}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Custom icons header */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    Custom{uploadedIcons.length > 0 ? ` (${uploadedIcons.length})` : ""}
                  </p>
                  <div>
                    <Tooltip content="Upload an SVG file to add it to your custom icon library." side="left">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 transition-colors"
                      >
                        {uploading ? "Uploading…" : "Upload SVG"}
                      </button>
                    </Tooltip>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".svg,image/svg+xml"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </div>
                </div>

                {uploadError && <p className="text-red-500 text-sm mb-3">{uploadError}</p>}

                {uploadedIcons.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No custom icons uploaded yet.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                      {uploadedIcons.map(({ name, svg }) => (
                        <div
                          key={name}
                          className="relative group flex flex-col items-center gap-1.5 p-2 pt-4 rounded-lg border border-gray-100 bg-white"
                        >
                          {/* Delete button — visible on hover */}
                          <Tooltip content="Delete this icon." side="top">
                            <button
                              className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-500"
                              onClick={() => handleDeleteClick(name, svg)}
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>

                          {/* Icon SVG */}
                          <span
                            className="w-6 h-6 flex items-center justify-center [&>svg]:w-6 [&>svg]:h-6"
                            dangerouslySetInnerHTML={{ __html: svg }}
                          />

                          {/* Editable name */}
                          {editingName === name ? (
                            <input
                              className="text-[11px] w-full text-center border border-blue-400 rounded px-0.5 py-0 outline-none bg-blue-50 disabled:opacity-50"
                              value={editValue}
                              onChange={(e) => {
                                setEditValue(e.target.value);
                                setRenameError("");
                              }}
                              onBlur={() => handleSaveName(name)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") {
                                  setEditingName(null);
                                  setRenameError("");
                                }
                              }}
                              autoFocus
                              disabled={savingName}
                            />
                          ) : (
                            <Tooltip content="Click to rename this icon." side="bottom">
                              <button
                                className="text-[11px] text-gray-500 truncate w-full text-center hover:text-blue-600 transition-colors"
                                onClick={() => startEdit(name)}
                              >
                                {name}
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      ))}
                    </div>
                    {renameError && (
                      <p className="text-red-500 text-xs mt-2">{renameError}</p>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* Delete modal */}
      {deleteModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !deleteModal.deleting && setDeleteModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {deleteModal.status === "checking" && (
              <p className="text-sm text-gray-500 text-center py-4">Checking usage…</p>
            )}

            {deleteModal.status === "error" && (
              <>
                <h3 className="font-semibold text-gray-900 mb-2">Error</h3>
                <p className="text-sm text-red-600 mb-4">{deleteModal.errorMsg}</p>
                <div className="flex justify-end">
                  <button
                    onClick={() => setDeleteModal(null)}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            )}

            {deleteModal.status === "clear" && (
              <>
                <h3 className="font-semibold text-gray-900 mb-2">Delete icon</h3>
                <p className="text-sm text-gray-600 mb-5">
                  Delete <span className="font-medium">"{deleteModal.name}"</span>? This cannot be
                  undone.
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setDeleteModal(null)}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={deleteModal.deleting}
                    className="px-4 py-2 text-sm text-white bg-red-500 rounded-md hover:bg-red-600 disabled:opacity-50 transition-colors"
                  >
                    {deleteModal.deleting ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </>
            )}

            {deleteModal.status === "in-use" && (
              <>
                <h3 className="font-semibold text-gray-900 mb-2">
                  Cannot delete "{deleteModal.name}"
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                  This icon is currently in use and cannot be deleted.
                </p>

                {deleteModal.phrases.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                      Perfect For Phrases
                    </p>
                    <ul className="space-y-0.5">
                      {deleteModal.phrases.map((p) => (
                        <li key={p} className="text-sm text-gray-700 truncate">
                          · {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {deleteModal.products.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                      Products ({deleteModal.products.length})
                    </p>
                    <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                      {deleteModal.products.map((p) => (
                        <li key={p} className="text-sm text-gray-700 truncate">
                          · {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    onClick={() => setDeleteModal(null)}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
