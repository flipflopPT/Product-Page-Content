import { describe, it, expect } from "vitest";
import { classifyStatus, contentStatus, matchesFilter } from "@/lib/product-filters";

function mf(value: string) { return { value }; }
const nullMF = null;

// ── classifyStatus ─────────────────────────────────────────────────────────

describe("classifyStatus", () => {
  it("returns complete when both type and style are set", () => {
    expect(classifyStatus({ productTypePt: mf("Home"), productStylePt: mf("Minimal") })).toBe("complete");
  });
  it("returns partial when only type is set", () => {
    expect(classifyStatus({ productTypePt: mf("Home"), productStylePt: nullMF })).toBe("partial");
  });
  it("returns partial when only style is set", () => {
    expect(classifyStatus({ productTypePt: nullMF, productStylePt: mf("Minimal") })).toBe("partial");
  });
  it("returns missing when neither is set", () => {
    expect(classifyStatus({ productTypePt: nullMF, productStylePt: nullMF })).toBe("missing");
  });
  it("returns missing when values are empty strings", () => {
    expect(classifyStatus({ productTypePt: mf(""), productStylePt: mf("") })).toBe("missing");
  });
});

// ── contentStatus ──────────────────────────────────────────────────────────

describe("contentStatus", () => {
  function node(overrides: Record<string, string | null>) {
    return {
      productSummary:    overrides.summary ? mf(overrides.summary) : nullMF,
      wctBullet1:        overrides.wct     ? mf(overrides.wct)     : nullMF,
      pfBullet1:         overrides.pf      ? mf(overrides.pf)      : nullMF,
      seasonalMdPhrase:  overrides.md      ? mf(overrides.md)      : nullMF,
      seasonalFdPhrase:  overrides.fd      ? mf(overrides.fd)      : nullMF,
      seasonalVdPhrase:  overrides.vd      ? mf(overrides.vd)      : nullMF,
    };
  }

  it("complete when summary + wct + pf all set", () => {
    expect(contentStatus(node({ summary: "s", wct: "w", pf: "p" }))).toBe("complete");
  });
  it("partial when only summary is set", () => {
    expect(contentStatus(node({ summary: "s" }))).toBe("partial");
  });
  it("partial when only wct is set", () => {
    expect(contentStatus(node({ wct: "w" }))).toBe("partial");
  });
  it("partial when only pf is set", () => {
    expect(contentStatus(node({ pf: "p" }))).toBe("partial");
  });
  it("partial when mothers day seasonal override is true", () => {
    expect(contentStatus(node({ md: "true" }))).toBe("partial");
  });
  it("partial when fathers day seasonal override is true", () => {
    expect(contentStatus(node({ fd: "true" }))).toBe("partial");
  });
  it("partial when valentines day seasonal override is true", () => {
    expect(contentStatus(node({ vd: "true" }))).toBe("partial");
  });
  it("missing when nothing is set", () => {
    expect(contentStatus(node({}))).toBe("missing");
  });
  it("partial not complete when summary + wct but no pf", () => {
    expect(contentStatus(node({ summary: "s", wct: "w" }))).toBe("partial");
  });
});

// ── matchesFilter ──────────────────────────────────────────────────────────

describe("matchesFilter", () => {
  it("empty filter always returns true", () => {
    expect(matchesFilter("", "missing", "missing")).toBe(true);
    expect(matchesFilter("", "complete", "complete")).toBe(true);
  });

  it("needs-classify: true when classify is not complete", () => {
    expect(matchesFilter("needs-classify", "missing", "missing")).toBe(true);
    expect(matchesFilter("needs-classify", "partial", "missing")).toBe(true);
    expect(matchesFilter("needs-classify", "complete", "missing")).toBe(false);
    expect(matchesFilter("needs-classify", "complete", "complete")).toBe(false);
  });

  it("ready-to-populate: true when classified complete but content not complete", () => {
    expect(matchesFilter("ready-to-populate", "complete", "missing")).toBe(true);
    expect(matchesFilter("ready-to-populate", "complete", "partial")).toBe(true);
    expect(matchesFilter("ready-to-populate", "complete", "complete")).toBe(false);
    expect(matchesFilter("ready-to-populate", "partial", "missing")).toBe(false);
  });

  it("complete: true only when both are complete", () => {
    expect(matchesFilter("complete", "complete", "complete")).toBe(true);
    expect(matchesFilter("complete", "complete", "partial")).toBe(false);
    expect(matchesFilter("complete", "partial", "complete")).toBe(false);
  });

  it("missing: true only when both are missing", () => {
    expect(matchesFilter("missing", "missing", "missing")).toBe(true);
    expect(matchesFilter("missing", "partial", "missing")).toBe(false);
    expect(matchesFilter("missing", "missing", "partial")).toBe(false);
  });

  it("partial: excludes all-missing and all-complete", () => {
    expect(matchesFilter("partial", "missing", "missing")).toBe(false);
    expect(matchesFilter("partial", "complete", "complete")).toBe(false);
    expect(matchesFilter("partial", "partial", "missing")).toBe(true);
    expect(matchesFilter("partial", "complete", "partial")).toBe(true);
    expect(matchesFilter("partial", "missing", "partial")).toBe(true);
  });

  it("has-content: true when content is not missing", () => {
    expect(matchesFilter("has-content", "missing", "partial")).toBe(true);
    expect(matchesFilter("has-content", "complete", "complete")).toBe(true);
    expect(matchesFilter("has-content", "missing", "missing")).toBe(false);
  });

  it("content-partial: true only when content is partial", () => {
    expect(matchesFilter("content-partial", "missing", "partial")).toBe(true);
    expect(matchesFilter("content-partial", "complete", "partial")).toBe(true);
    expect(matchesFilter("content-partial", "complete", "complete")).toBe(false);
    expect(matchesFilter("content-partial", "missing", "missing")).toBe(false);
  });

  it("content-complete: true only when content is complete", () => {
    expect(matchesFilter("content-complete", "missing", "complete")).toBe(true);
    expect(matchesFilter("content-complete", "complete", "complete")).toBe(true);
    expect(matchesFilter("content-complete", "complete", "partial")).toBe(false);
  });

  it("unknown filter returns true", () => {
    expect(matchesFilter("unknown-filter", "missing", "missing")).toBe(true);
  });
});
