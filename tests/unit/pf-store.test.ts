import { describe, it, expect, vi, beforeEach } from "vitest";

const emptyEdits = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };

vi.mock("@/lib/library-edits-store", () => ({
  getLibraryEdits: vi.fn(),
  upsertPFPhraseEdit: vi.fn().mockResolvedValue(undefined),
  deletePFPhraseEdit: vi.fn().mockResolvedValue(undefined),
  upsertPFApplicabilityEdit: vi.fn().mockResolvedValue(undefined),
  deletePFApplicabilityEdit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/settings-store", () => ({
  getSettings: vi.fn().mockResolvedValue({ interestKeywords: {} }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

import {
  getPfLibrary, getPfPhraseRows, removeApplicability, deletePhrase, findPhraseIdByText,
} from "@/lib/pf-store";
import {
  getLibraryEdits, upsertPFApplicabilityEdit, deletePFApplicabilityEdit, upsertPFPhraseEdit,
} from "@/lib/library-edits-store";

const phrase = { id: "phrase-001", phrase: "Birthdays", icon: "cake", searchPhrase: "Birthdays", isNew: false, category: "Occasion" as const, timeSensitive: null, filterByInterest: false };
const deletedPhrase = { id: "phrase-002", phrase: "Old Phrase", icon: "gift", searchPhrase: "Old Phrase", isNew: false, deleted: true };
const app = { id: "pf-001", phraseId: "phrase-001", productType: "Home", productStyle: "Minimal", applicabilityCount: 4, isNew: false };
const deletedApp = { id: "pf-002", phraseId: "phrase-001", productType: "Home", productStyle: "Bold", applicabilityCount: 1, isNew: false, deleted: true };
const customApp = { id: "pf-custom-1", phraseId: "phrase-001", productType: "Home", productStyle: "Cosy", applicabilityCount: 0, isNew: true };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPfLibrary — reads straight from edits, no base-file merge", () => {
  it("joins phrases to applicability rows", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      pfPhrases: { [phrase.id]: phrase },
      pfApplicability: { [app.id]: app },
    });

    const result = await getPfLibrary();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "pf-001", phrase: "Birthdays", icon: "cake", productType: "Home", productStyle: "Minimal" });
  });

  it("excludes phrases marked deleted", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      pfPhrases: { [phrase.id]: phrase, [deletedPhrase.id]: deletedPhrase },
      pfApplicability: { [app.id]: app, "pf-003": { ...app, id: "pf-003", phraseId: deletedPhrase.id } },
    });

    const result = await getPfLibrary();
    expect(result.map((r) => r.phraseId)).toEqual(["phrase-001"]);
  });

  it("excludes applicability rows marked deleted", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      pfPhrases: { [phrase.id]: phrase },
      pfApplicability: { [app.id]: app, [deletedApp.id]: deletedApp },
    });

    const result = await getPfLibrary();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("pf-001");
  });

  it("includes custom (isNew) applicability rows alongside base-derived ones", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      pfPhrases: { [phrase.id]: phrase },
      pfApplicability: { [app.id]: app, [customApp.id]: customApp },
    });

    const result = await getPfLibrary();
    expect(result.map((r) => r.id).sort()).toEqual(["pf-001", "pf-custom-1"]);
  });
});

describe("getPfPhraseRows", () => {
  it("groups applicabilities by phrase and skips orphaned phrases with no rows", async () => {
    const orphan = { ...phrase, id: "phrase-orphan", phrase: "Orphan" };
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      pfPhrases: { [phrase.id]: phrase, [orphan.id]: orphan },
      pfApplicability: { [app.id]: app },
    });

    const rows = await getPfPhraseRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("phrase-001");
    expect(rows[0].applicabilities).toHaveLength(1);
  });
});

describe("findPhraseIdByText", () => {
  it("finds a phrase by its current text", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({ ...emptyEdits, pfPhrases: { [phrase.id]: phrase } });
    expect(await findPhraseIdByText("Birthdays")).toBe("phrase-001");
    expect(await findPhraseIdByText("Nope")).toBeNull();
  });
});

describe("removeApplicability — no base-data fallback", () => {
  it("deletes the edit outright when it is a custom (isNew) row", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({ ...emptyEdits, pfApplicability: { [customApp.id]: customApp } });
    await removeApplicability(customApp.id);
    expect(deletePFApplicabilityEdit).toHaveBeenCalledWith(customApp.id);
    expect(upsertPFApplicabilityEdit).not.toHaveBeenCalled();
  });

  it("marks a non-custom row as deleted in place, preserving its fields", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({ ...emptyEdits, pfApplicability: { [app.id]: app } });
    await removeApplicability(app.id);
    expect(upsertPFApplicabilityEdit).toHaveBeenCalledWith({ ...app, deleted: true });
    expect(deletePFApplicabilityEdit).not.toHaveBeenCalled();
  });

  it("is a no-op when the row does not exist in edits (no base data to fall back to)", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue(emptyEdits);
    await removeApplicability("does-not-exist");
    expect(upsertPFApplicabilityEdit).not.toHaveBeenCalled();
    expect(deletePFApplicabilityEdit).not.toHaveBeenCalled();
  });
});

describe("deletePhrase — no base-data fallback", () => {
  it("marks the phrase deleted using its stored edit fields", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      pfPhrases: { [phrase.id]: phrase },
      pfApplicability: { [app.id]: app },
    });

    await deletePhrase(phrase.id);

    expect(upsertPFPhraseEdit).toHaveBeenCalledWith(expect.objectContaining({ id: phrase.id, phrase: "Birthdays", deleted: true }));
    expect(upsertPFApplicabilityEdit).toHaveBeenCalledWith(expect.objectContaining({ id: app.id, deleted: true }));
  });
});
