"use client";

import { useRef, useEffect } from "react";
import { Tooltip } from "@/components/Tooltip";

interface DeletePhraseModalProps {
  mode: "delete" | "remove-assignment";
  phraseText: string;
  removeApp?: { productType: string; productStyle: string };
  actionPhase: "idle" | "checking" | "confirm" | "replacing" | "done" | "error";
  actionFoundCount: number;
  actionFoundProducts: { id: string; title: string }[];
  actionReplacement: string;
  actionReplacementPhrases: { phraseId: string; phrase: string }[];
  actionLog: { title: string; status: "updated" | "error" }[];
  actionResult: { updated: number; swapped: number; alternated: number; failed: number } | null;
  actionError: string;
  onReplacementChange: (phraseId: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeletePhraseModal({
  mode,
  phraseText,
  removeApp,
  actionPhase,
  actionFoundCount,
  actionFoundProducts,
  actionReplacement,
  actionReplacementPhrases,
  actionLog,
  actionResult,
  actionError,
  onReplacementChange,
  onConfirm,
  onCancel,
}: DeletePhraseModalProps) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [actionLog]);

  const isReplacing = actionPhase === "replacing";
  const isDone = actionPhase === "done";

  const headerText =
    mode === "delete"
      ? `Delete "${phraseText}"`
      : `Remove ${removeApp?.productType} · ${removeApp?.productStyle}`;

  const actionLabel =
    actionFoundCount > 0
      ? mode === "delete" ? "Replace & Delete" : "Replace & Remove"
      : mode === "delete" ? "Delete phrase" : "Remove assignment";

  const showFooter = actionPhase === "confirm" || isDone || actionPhase === "error";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
      onClick={isReplacing ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-900">{headerText}</span>
          <button
            onClick={onCancel}
            disabled={isReplacing}
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-lg leading-none disabled:opacity-30"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div ref={logRef} className="max-h-52 overflow-y-auto px-5 py-3 space-y-2 text-sm">
          {actionPhase === "checking" && (
            <p className="text-gray-400">Checking for product uses…</p>
          )}

          {actionPhase === "confirm" && actionFoundCount === 0 && (
            <p className="text-gray-700">
              No products use this {mode === "delete" ? "phrase" : "assignment"}. Safe to remove.
            </p>
          )}

          {actionPhase === "confirm" && actionFoundCount > 0 && (
            <>
              <p className="text-gray-700">
                <strong>{actionFoundCount}</strong> product{actionFoundCount !== 1 ? "s" : ""} use this phrase
                {mode === "remove-assignment" && removeApp ? ` for ${removeApp.productType} · ${removeApp.productStyle}` : ""}.
                Choose a replacement:
              </p>
              <div className="max-h-48 overflow-y-auto space-y-0.5 border border-gray-100 rounded p-2 bg-gray-50">
                {actionFoundProducts.map((p) => (
                  <div key={p.id} className="text-gray-700 text-sm">{p.title}</div>
                ))}
              </div>
              <select
                value={actionReplacement}
                onChange={(e) => onReplacementChange(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select replacement phrase…</option>
                {actionReplacementPhrases.map((p) => (
                  <option key={p.phraseId} value={p.phraseId}>{p.phrase}</option>
                ))}
              </select>
            </>
          )}

          {(isReplacing || isDone) && (
            <>
              {isReplacing && actionLog.length === 0 && (
                <p className="text-gray-400">Updating products…</p>
              )}
              {actionLog.map((e, i) => (
                <div key={i} className={e.status === "updated" ? "text-green-700" : "text-red-600"}>
                  {e.status === "updated" ? "✓" : "✗"} {e.title}
                </div>
              ))}
              {isDone && actionResult && (
                <p className="text-xs text-gray-500 pt-1">
                  {actionResult.swapped} received replacement phrase
                  {actionResult.alternated > 0 && ` · ${actionResult.alternated} received an alternative`}
                  {actionResult.failed > 0 && ` · ${actionResult.failed} failed`}
                </p>
              )}
            </>
          )}

          {actionPhase === "error" && (
            <p className="text-red-600">{actionError}</p>
          )}
        </div>

        {/* Footer */}
        {showFooter && (
          <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-end gap-3">
            {(isDone || actionPhase === "error") && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Close
              </button>
            )}
            {actionPhase === "confirm" && (
              <>
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <Tooltip
                  content={
                    actionFoundCount > 0
                      ? mode === "delete"
                        ? "Swap the phrase on all affected products then permanently delete it from the library."
                        : "Swap the phrase on all affected products then remove this type assignment."
                      : mode === "delete"
                        ? "Permanently delete this phrase from the library."
                        : "Remove this product type from the phrase assignments."
                  }
                  side="top"
                >
                  <button
                    onClick={onConfirm}
                    disabled={actionFoundCount > 0 && !actionReplacement}
                    className="px-4 py-2 text-sm bg-gray-900 text-white rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    {actionLabel}
                  </button>
                </Tooltip>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
