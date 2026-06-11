"use client";

import { useRef, useEffect } from "react";
import { Tooltip } from "@/components/Tooltip";

interface AffectedProductsModalProps {
  title: string;
  phase: "finding" | "found" | "updating" | "done";
  products: { id: string; title: string }[];
  updateLog: { title: string; status: "updated" | "error" }[];
  updateResult: { updated: number; skipped: number; failed: number } | null;
  canUpdate: boolean;
  onUpdate: () => void;
  onDismiss: () => void;
}

export default function AffectedProductsModal({
  title,
  phase,
  products,
  updateLog,
  updateResult,
  canUpdate,
  onUpdate,
  onDismiss,
}: AffectedProductsModalProps) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [updateLog]);

  const isUpdating = phase === "updating";
  const isDone = phase === "done";

  function headerText() {
    if (phase === "finding") return "Searching products…";
    if (phase === "found") {
      if (products.length === 0) return "No products found";
      return `${products.length} product${products.length !== 1 ? "s" : ""} use this phrase`;
    }
    if (phase === "updating") return "Updating products…";
    if (isDone && updateResult) {
      return `Done — ${updateResult.updated} updated${updateResult.failed > 0 ? ` · ${updateResult.failed} failed` : ""}`;
    }
    return title;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={isUpdating ? undefined : onDismiss}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">{headerText()}</span>
          <button
            onClick={onDismiss}
            disabled={isUpdating}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none disabled:opacity-30"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div ref={logRef} className="max-h-52 overflow-y-auto px-5 py-3 space-y-0.5 text-sm">
          {phase === "finding" && (
            <div className="text-gray-400">Scanning products…</div>
          )}
          {phase === "found" && products.length === 0 && (
            <div className="text-gray-500">No products currently use this.</div>
          )}
          {phase === "found" && products.map((p) => (
            <div key={p.id} className="text-gray-700">{p.title}</div>
          ))}
          {(phase === "updating" || isDone) && updateLog.map((e, i) => (
            <div key={i} className={e.status === "updated" ? "text-green-700" : "text-red-600"}>
              {e.status === "updated" ? "✓" : "✗"} {e.title}
            </div>
          ))}
          {phase === "updating" && updateLog.length === 0 && (
            <div className="text-gray-400">Starting update…</div>
          )}
        </div>

        {/* Footer */}
        {(phase === "found" || isDone) && (
          <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-end gap-3">
            {isDone && (
              <button
                onClick={onDismiss}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            )}
            {phase === "found" && canUpdate && products.length > 0 && (
              <>
                <Tooltip content="Close this without pushing any changes to products." side="top">
                  <button
                    onClick={onDismiss}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    Skip
                  </button>
                </Tooltip>
                <Tooltip content="Push this change to all listed products at once." side="top">
                  <button
                    onClick={onUpdate}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 transition-colors"
                  >
                    Update All ({products.length})
                  </button>
                </Tooltip>
              </>
            )}
            {phase === "found" && (!canUpdate || products.length === 0) && (
              <button
                onClick={onDismiss}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
