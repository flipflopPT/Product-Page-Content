import { describe, it, expect } from "vitest";
import { mergeWct, mergePfPhrases, mergePfApplicability } from "@/scripts/lib/migrate-library-merge.mjs";

// ── mergeWct ──────────────────────────────────────────────────────────────────

describe("mergeWct", () => {
  const base = [
    { id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Base text", subtext: "Base subtext" },
  ];

  it("carries a base entry through unchanged when there is no existing edit, defaulting searchFormatted to empty", () => {
    const result = mergeWct(base, {});
    expect(result["wct-001"]).toEqual({
      id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out",
      text: "Base text", subtext: "Base subtext", searchFormatted: "", isNew: false,
    });
  });

  it("prefers the existing edit's fields over the base entry", () => {
    const existing = {
      "wct-001": { id: "wct-001", productType: "Home", productStyle: "Cosy", category: "Gift Impact", text: "Edited text", subtext: "Edited subtext", searchFormatted: "<strong>Edited text</strong> Edited subtext", isNew: false },
    };
    const result = mergeWct(base, existing);
    expect(result["wct-001"]).toEqual(existing["wct-001"]);
  });

  it("adds isNew custom entries that have no corresponding base row", () => {
    const existing = {
      "wct-custom-1": { id: "wct-custom-1", productType: "Home", productStyle: "Bold", category: "Worth Keeping", text: "Custom text", subtext: "Custom subtext", searchFormatted: "", isNew: true },
    };
    const result = mergeWct(base, existing);
    expect(Object.keys(result).sort()).toEqual(["wct-001", "wct-custom-1"]);
    expect(result["wct-custom-1"]).toEqual(existing["wct-custom-1"]);
  });

  it("does not duplicate or drop entries when base and existing overlap fully", () => {
    const existing = {
      "wct-001": { id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Base text", subtext: "Base subtext", searchFormatted: "", isNew: false },
    };
    const result = mergeWct(base, existing);
    expect(Object.keys(result)).toEqual(["wct-001"]);
  });
});

// ── mergePfPhrases ────────────────────────────────────────────────────────────

describe("mergePfPhrases", () => {
  const base = [
    { id: "phrase-001", phrase: "Birthdays", icon: "cake", category: "Occasion", timeSensitive: null, filterByInterest: false },
  ];

  it("falls back to base fields entirely when there is no existing edit", () => {
    const result = mergePfPhrases(base, {});
    expect(result["phrase-001"]).toEqual({
      id: "phrase-001", phrase: "Birthdays", icon: "cake", searchPhrase: "Birthdays",
      isNew: false, category: "Occasion", timeSensitive: null, filterByInterest: false,
    });
  });

  it("applies edit overrides field-by-field and forces isNew false", () => {
    const existing = { "phrase-001": { id: "phrase-001", phrase: "Bday", icon: "gift", searchPhrase: "Birthdays", isNew: false, category: "Person", timeSensitive: "mothers-day", filterByInterest: true } };
    const result = mergePfPhrases(base, existing);
    expect(result["phrase-001"]).toMatchObject({ phrase: "Bday", icon: "gift", category: "Person", timeSensitive: "mothers-day", filterByInterest: true, isNew: false });
  });

  it("preserves deleted:true from an edit", () => {
    const existing = { "phrase-001": { id: "phrase-001", phrase: "Birthdays", icon: "cake", searchPhrase: "Birthdays", isNew: false, deleted: true } };
    const result = mergePfPhrases(base, existing);
    expect(result["phrase-001"].deleted).toBe(true);
  });

  it("omits minPrice/maxPrice entirely when neither base nor edit defines them", () => {
    const result = mergePfPhrases(base, {});
    expect(result["phrase-001"]).not.toHaveProperty("minPrice");
    expect(result["phrase-001"]).not.toHaveProperty("maxPrice");
  });

  it("takes minPrice/maxPrice from base when no edit override exists", () => {
    const baseWithPrice = [{ ...base[0], minPrice: 10, maxPrice: 50 }];
    const result = mergePfPhrases(baseWithPrice, {});
    expect(result["phrase-001"].minPrice).toBe(10);
    expect(result["phrase-001"].maxPrice).toBe(50);
  });

  it("takes minPrice/maxPrice from the edit when present, overriding base", () => {
    const baseWithPrice = [{ ...base[0], minPrice: 10, maxPrice: 50 }];
    const existing = { "phrase-001": { id: "phrase-001", phrase: "Birthdays", icon: "cake", searchPhrase: "Birthdays", isNew: false, minPrice: 20, maxPrice: 100 } };
    const result = mergePfPhrases(baseWithPrice, existing);
    expect(result["phrase-001"].minPrice).toBe(20);
    expect(result["phrase-001"].maxPrice).toBe(100);
  });

  it("adds isNew custom phrases that have no corresponding base row", () => {
    const existing = { "phrase-custom-1": { id: "phrase-custom-1", phrase: "Custom Phrase", icon: "star", searchPhrase: "", isNew: true, category: "Occasion", timeSensitive: null, filterByInterest: false } };
    const result = mergePfPhrases(base, existing);
    expect(Object.keys(result).sort()).toEqual(["phrase-001", "phrase-custom-1"]);
    expect(result["phrase-custom-1"]).toEqual(existing["phrase-custom-1"]);
  });
});

// ── mergePfApplicability ──────────────────────────────────────────────────────

describe("mergePfApplicability", () => {
  const base = [
    { id: "pf-001", phraseId: "phrase-001", productType: "Home", productStyle: "Minimal", applicabilityCount: 4 },
  ];

  it("carries a base row through unchanged when there is no existing edit", () => {
    const result = mergePfApplicability(base, {});
    expect(result["pf-001"]).toEqual({
      id: "pf-001", phraseId: "phrase-001", productType: "Home", productStyle: "Minimal", applicabilityCount: 4, isNew: false,
    });
  });

  it("applies a style-rename edit override and forces isNew false", () => {
    const existing = { "pf-001": { id: "pf-001", phraseId: "phrase-001", productType: "Home", productStyle: "Cosy", applicabilityCount: 4, isNew: false } };
    const result = mergePfApplicability(base, existing);
    expect(result["pf-001"].productStyle).toBe("Cosy");
    expect(result["pf-001"].isNew).toBe(false);
  });

  it("preserves deleted:true from an edit", () => {
    const existing = { "pf-001": { id: "pf-001", phraseId: "phrase-001", productType: "Home", productStyle: "Minimal", applicabilityCount: 4, isNew: false, deleted: true } };
    const result = mergePfApplicability(base, existing);
    expect(result["pf-001"].deleted).toBe(true);
  });

  it("adds isNew custom applicability rows that have no corresponding base row", () => {
    const existing = { "pf-custom-1": { id: "pf-custom-1", phraseId: "phrase-001", productType: "Home", productStyle: "Bold", applicabilityCount: 0, isNew: true } };
    const result = mergePfApplicability(base, existing);
    expect(Object.keys(result).sort()).toEqual(["pf-001", "pf-custom-1"]);
    expect(result["pf-custom-1"]).toEqual(existing["pf-custom-1"]);
  });
});

// ── Idempotency: running the merge twice in a row should be a no-op ────────────

describe("idempotency", () => {
  it("re-merging the output of a previous merge produces the same result", () => {
    const wctBase = [{ id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Base text", subtext: "Base subtext" }];
    const firstPass = mergeWct(wctBase, {});
    const secondPass = mergeWct(wctBase, firstPass);
    expect(secondPass).toEqual(firstPass);
  });
});
