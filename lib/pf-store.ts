import pfPhrasesBase from "@/data/pf-phrases.json";
import pfApplicabilityBase from "@/data/pf-applicability.json";
import {
  getLibraryEdits,
  upsertPFPhraseEdit,
  deletePFPhraseEdit,
  upsertPFApplicabilityEdit,
  deletePFApplicabilityEdit,
  type PFPhraseEdit,
  type PFApplicabilityEdit,
} from "./library-edits-store";
import type { PFPhrase, PFApplicability, PerfectForEntry } from "./types";

const basePhrases = pfPhrasesBase as PFPhrase[];
const baseApplicability = pfApplicabilityBase as PFApplicability[];

// ── Read helpers ──────────────────────────────────────────────────────────────

// Returns the merged phrase map: base phrases overridden by any phrase-level edits
async function buildPhraseMap(): Promise<Map<string, PFPhrase>> {
  const edits = await getLibraryEdits();
  const map = new Map<string, PFPhrase>();

  for (const p of basePhrases) {
    const edit = edits.pfPhrases[p.id];
    if (edit?.deleted) continue; // phrase has been deleted
    map.set(p.id, {
      ...p,
      phrase: edit?.phrase ?? p.phrase,
      icon: edit?.icon ?? p.icon,
      ...(edit?.category !== undefined && { category: edit.category as PFPhrase["category"] }),
      ...(edit?.timeSensitive !== undefined && { timeSensitive: edit.timeSensitive as PFPhrase["timeSensitive"] }),
      ...(edit?.filterByInterest !== undefined && { filterByInterest: edit.filterByInterest }),
      ...(edit?.minPrice !== undefined ? { minPrice: edit.minPrice } : p.minPrice !== undefined ? { minPrice: p.minPrice } : {}),
      ...(edit?.maxPrice !== undefined ? { maxPrice: edit.maxPrice } : p.maxPrice !== undefined ? { maxPrice: p.maxPrice } : {}),
    });
  }

  // Add new custom phrases (skip deleted ones)
  for (const edit of Object.values(edits.pfPhrases)) {
    if (edit.isNew && !edit.deleted) {
      map.set(edit.id, {
        id: edit.id,
        phrase: edit.phrase,
        icon: edit.icon,
        category: (edit.category ?? "Occasion") as PFPhrase["category"],
        timeSensitive: (edit.timeSensitive ?? null) as PFPhrase["timeSensitive"],
        filterByInterest: edit.filterByInterest ?? false,
        ...(edit.minPrice !== undefined && { minPrice: edit.minPrice }),
        ...(edit.maxPrice !== undefined && { maxPrice: edit.maxPrice }),
      });
    }
  }

  return map;
}

// Returns all applicability rows: base rows (minus deleted) + new custom rows
async function buildApplicabilityList(): Promise<PFApplicability[]> {
  const edits = await getLibraryEdits();
  const list: PFApplicability[] = [];

  // Include base rows, skipping any marked deleted
  for (const app of baseApplicability) {
    if (edits.pfApplicability[app.id]?.deleted) continue;
    list.push(app);
  }

  for (const edit of Object.values(edits.pfApplicability)) {
    if (edit.isNew && !edit.deleted) {
      list.push({
        id: edit.id,
        phraseId: edit.phraseId,
        productType: edit.productType,
        productStyle: edit.productStyle,
        applicabilityCount: edit.applicabilityCount,
      });
    }
  }
  return list;
}

// ── Public read API ───────────────────────────────────────────────────────────

// The flat joined view used by the assignment engine and all content routes
export async function getPfLibrary(): Promise<PerfectForEntry[]> {
  const [phraseMap, applicabilityList] = await Promise.all([
    buildPhraseMap(),
    buildApplicabilityList(),
  ]);

  const result: PerfectForEntry[] = [];
  for (const app of applicabilityList) {
    const phrase = phraseMap.get(app.phraseId);
    if (!phrase) continue;
    result.push({
      id: app.id,
      phraseId: phrase.id,
      productType: app.productType,
      productStyle: app.productStyle,
      category: phrase.category,
      phrase: phrase.phrase,
      filterByInterest: phrase.filterByInterest,
      timeSensitive: phrase.timeSensitive,
      applicabilityCount: app.applicabilityCount,
      icon: phrase.icon,
      ...(phrase.minPrice !== undefined && { minPrice: phrase.minPrice }),
      ...(phrase.maxPrice !== undefined && { maxPrice: phrase.maxPrice }),
    });
  }
  return result;
}

// Phrase-centric view for the library management UI
export interface PFPhraseRow extends PFPhrase {
  applicabilities: PFApplicability[];
  _edit: PFPhraseEdit | null;
}

export async function getPfPhraseRows(filters?: {
  productType?: string;
  productStyle?: string;
  category?: string;
  search?: string;
}): Promise<PFPhraseRow[]> {
  const edits = await getLibraryEdits();
  const phraseMap = await buildPhraseMap();
  const applicabilityList = await buildApplicabilityList();

  // Group applicabilities by phraseId
  const appsByPhrase = new Map<string, PFApplicability[]>();
  for (const app of applicabilityList) {
    const group = appsByPhrase.get(app.phraseId) ?? [];
    group.push(app);
    appsByPhrase.set(app.phraseId, group);
  }

  let rows: PFPhraseRow[] = [];
  for (const [phraseId, phrase] of phraseMap.entries()) {
    const applicabilities = appsByPhrase.get(phraseId) ?? [];
    if (applicabilities.length === 0) continue; // don't show orphaned phrases

    rows.push({
      ...phrase,
      applicabilities,
      _edit: edits.pfPhrases[phraseId] ?? null,
    });
  }

  // Apply filters
  if (filters?.productType) {
    rows = rows.filter((r) =>
      r.applicabilities.some(
        (a) => a.productType === filters.productType
      )
    );
  }
  if (filters?.productStyle) {
    rows = rows.filter((r) =>
      r.applicabilities.some(
        (a) => a.productStyle === filters.productStyle || a.productStyle === "ALL"
      )
    );
  }
  if (filters?.category) {
    rows = rows.filter((r) => r.category === filters.category);
  }
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    rows = rows.filter((r) => r.phrase.toLowerCase().includes(s));
  }

  return rows;
}

// Look up a phrase and its edit by applicability ID or phrase ID
export async function findPhraseForEntry(id: string): Promise<{
  phrase: PFPhrase;
  edit: PFPhraseEdit | null;
} | null> {
  const edits = await getLibraryEdits();
  const phraseMap = await buildPhraseMap();
  const applicabilityList = await buildApplicabilityList();

  // Try as phraseId first
  if (phraseMap.has(id)) {
    return { phrase: phraseMap.get(id)!, edit: edits.pfPhrases[id] ?? null };
  }

  // Try as applicability ID
  const app = applicabilityList.find((a) => a.id === id);
  if (!app) return null;
  const phrase = phraseMap.get(app.phraseId);
  if (!phrase) return null;
  return { phrase, edit: edits.pfPhrases[app.phraseId] ?? null };
}

// Find the phrase ID for a given phrase text (used during icon updates by phrase text)
export async function findPhraseIdByText(phraseText: string): Promise<string | null> {
  const phraseMap = await buildPhraseMap();
  for (const [id, p] of phraseMap.entries()) {
    if (p.phrase === phraseText) return id;
  }
  return null;
}

// ── Write API ─────────────────────────────────────────────────────────────────

// Upsert a phrase definition edit (phrase text, icon, category, seasonal, filterByInterest)
export async function savePhraseEdit(phraseId: string, fields: Partial<PFPhraseEdit>): Promise<void> {
  const edits = await getLibraryEdits();
  const existing = edits.pfPhrases[phraseId];

  const phraseMap = await buildPhraseMap();
  const base = phraseMap.get(phraseId);

  const updated: PFPhraseEdit = {
    id: phraseId,
    phrase: fields.phrase ?? existing?.phrase ?? base?.phrase ?? "",
    icon: fields.icon ?? existing?.icon ?? base?.icon ?? "",
    searchPhrase: fields.searchPhrase ?? existing?.searchPhrase ?? base?.phrase ?? "",
    isNew: fields.isNew ?? existing?.isNew ?? false,
    ...(fields.category !== undefined && { category: fields.category }),
    ...(fields.timeSensitive !== undefined && { timeSensitive: fields.timeSensitive }),
    ...(fields.filterByInterest !== undefined && { filterByInterest: fields.filterByInterest }),
    ...(fields.minPrice !== undefined && { minPrice: fields.minPrice }),
    ...(fields.maxPrice !== undefined && { maxPrice: fields.maxPrice }),
  };

  await upsertPFPhraseEdit(updated);
}

// Update the icon for a phrase (used by PATCH /api/library)
export async function savePhraseIcon(phraseId: string, icon: string): Promise<void> {
  const edits = await getLibraryEdits();
  const existing = edits.pfPhrases[phraseId];
  const phraseMap = await buildPhraseMap();
  const base = phraseMap.get(phraseId);

  if (!base) return;

  await upsertPFPhraseEdit({
    id: phraseId,
    phrase: existing?.phrase ?? base.phrase,
    icon,
    searchPhrase: existing?.searchPhrase ?? base.phrase,
    isNew: existing?.isNew ?? false,
    ...(existing?.category !== undefined && { category: existing.category }),
    ...(existing?.timeSensitive !== undefined && { timeSensitive: existing.timeSensitive }),
    ...(existing?.filterByInterest !== undefined && { filterByInterest: existing.filterByInterest }),
    ...(existing?.minPrice !== undefined && { minPrice: existing.minPrice }),
    ...(existing?.maxPrice !== undefined && { maxPrice: existing.maxPrice }),
  });
}

// Add a new applicability row (type/style assignment for an existing or new phrase)
export async function addApplicability(
  phraseId: string,
  productType: string,
  productStyle: string
): Promise<string> {
  const id = `pf-custom-${Date.now()}`;
  await upsertPFApplicabilityEdit({
    id, phraseId, productType, productStyle, applicabilityCount: 0, isNew: true,
  });
  return id;
}

// Remove an applicability row — works for both custom and base-data rows
export async function removeApplicability(appId: string): Promise<void> {
  const edits = await getLibraryEdits();
  const isCustom = edits.pfApplicability[appId]?.isNew;
  if (isCustom) {
    // Custom row: just delete the edit entry
    await deletePFApplicabilityEdit(appId);
  } else {
    // Base-data row: mark as deleted so it's excluded from the merged view
    const base = baseApplicability.find((a) => a.id === appId);
    if (!base) return;
    await upsertPFApplicabilityEdit({
      id: appId,
      phraseId: base.phraseId,
      productType: base.productType,
      productStyle: base.productStyle,
      applicabilityCount: base.applicabilityCount,
      isNew: false,
      deleted: true,
    });
  }
}

// Delete a phrase entirely (marks it deleted in edits; also deletes all its applicabilities)
export async function deletePhrase(phraseId: string): Promise<void> {
  const edits = await getLibraryEdits();
  const existingEdit = edits.pfPhrases[phraseId];
  const base = basePhrases.find((p) => p.id === phraseId);

  // Mark the phrase as deleted
  await upsertPFPhraseEdit({
    id: phraseId,
    phrase: existingEdit?.phrase ?? base?.phrase ?? "",
    icon: existingEdit?.icon ?? base?.icon ?? "",
    searchPhrase: existingEdit?.searchPhrase ?? base?.phrase ?? "",
    isNew: existingEdit?.isNew ?? false,
    deleted: true,
  });

  // Mark all its applicability rows as deleted
  const allApplicabilities = await buildApplicabilityList();
  const ownApplicabilities = allApplicabilities.filter((a) => a.phraseId === phraseId);
  for (const app of ownApplicabilities) {
    await removeApplicability(app.id);
  }
}

// Create a brand new phrase + its first applicability row
export async function createPhrase(
  phrase: string,
  icon: string,
  category: PFPhrase["category"],
  timeSensitive: PFPhrase["timeSensitive"],
  filterByInterest: boolean,
  typeStylePairs: { type: string; style: string }[],
  minPrice?: number,
  maxPrice?: number
): Promise<string> {
  const phraseId = `phrase-custom-${Date.now()}`;

  await upsertPFPhraseEdit({
    id: phraseId,
    phrase,
    icon,
    searchPhrase: "",
    isNew: true,
    category,
    timeSensitive,
    filterByInterest,
    ...(minPrice !== undefined && { minPrice }),
    ...(maxPrice !== undefined && { maxPrice }),
  });

  for (const pair of typeStylePairs) {
    const appId = `pf-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await upsertPFApplicabilityEdit({
      id: appId,
      phraseId,
      productType: pair.type,
      productStyle: pair.style || "ALL",
      applicabilityCount: 0,
      isNew: true,
    });
  }

  return phraseId;
}

// Mark a phrase as pushed (update searchPhrase to current phrase text)
export { markPFPhrasePushed } from "./library-edits-store";
