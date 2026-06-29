"use client";

import { useState, useEffect } from "react";
import Nav from "@/components/Nav";
import type { AppSettings } from "@/lib/types";

const SEASONS = [
  { key: "mothersDay",    label: "Mother's Day" },
  { key: "fathersDay",   label: "Father's Day" },
  { key: "valentinesDay", label: "Valentine's Day" },
] as const;

type SeasonKey = typeof SEASONS[number]["key"];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((s: AppSettings) => { setSettings(s); setLoadingSettings(false); })
      .catch(() => setLoadingSettings(false));
  }, []);

  function setDate(key: SeasonKey, field: "start" | "end", value: string) {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = prev.dateRanges[key] ?? { start: "", end: "" };
      const updated = { ...current, [field]: value };
      // Only store a range when both fields are non-empty — a partial range is treated as cleared
      const stored = updated.start && updated.end ? updated : null;
      return { ...prev, dateRanges: { ...prev.dateRanges, [key]: stored } };
    });
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSaving(false);
      if (!res.ok) {
        setSaveError("Save failed — please try again");
      } else {
        setSavedMsg("Saved");
        setTimeout(() => setSavedMsg(""), 3000);
      }
    } catch {
      setSaving(false);
      setSaveError("Save failed — please try again");
    }
  }

  return (
    <div className="flex flex-col min-h-screen">
      <Nav active="perfect-for" subActive="seasonal" helpText={"Set the date windows for seasonal occasions like Mother's Day and Valentine's Day.\nWhy Choose This and Perfect For entries marked as seasonal will only appear on products during these dates."} />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-8">

          <p className="text-sm text-gray-500 mb-5">
            Set the date window for each seasonal occasion. When a product has that occasion ticked
            and today falls within the range, the seasonal phrase will automatically appear as one of its
            Perfect For items, swapping out a regular one. Leave the dates blank to keep an occasion
            switched off entirely.
          </p>

          {loadingSettings ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-3">
              {SEASONS.map(({ key, label }) => {
                const range = settings?.dateRanges[key] ?? { start: "", end: "" };
                return (
                  <div key={key} className="bg-white border border-gray-200 rounded-lg p-4">
                    <p className="font-medium text-sm text-gray-800 mb-3">{label}</p>
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Start</label>
                        <input
                          type="date"
                          value={range.start ?? ""}
                          onChange={(e) => setDate(key, "start", e.target.value)}
                          className={`w-full px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${range.start ? "text-gray-800" : "text-gray-300"}`}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">End</label>
                        <input
                          type="date"
                          value={range.end ?? ""}
                          onChange={(e) => setDate(key, "end", e.target.value)}
                          className={`w-full px-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${range.end ? "text-gray-800" : "text-gray-300"}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={handleSave}
              disabled={saving || loadingSettings}
              className="px-6 py-2 bg-black text-white text-sm font-semibold rounded-md hover:bg-gray-900 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {savedMsg && <span className="text-emerald-600 text-sm">{savedMsg}</span>}
            {saveError && <span className="text-red-500 text-sm">{saveError}</span>}
          </div>

        </div>
      </div>
    </div>
  );
}
