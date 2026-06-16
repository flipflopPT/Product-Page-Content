import { describe, it, expect, vi, beforeEach } from "vitest";

const emptyEdits = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };

vi.mock("@/lib/library-edits-store", () => ({ getLibraryEdits: vi.fn() }));

import { getWctLibrary } from "@/lib/wct-store";
import { getLibraryEdits } from "@/lib/library-edits-store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWctLibrary — reads straight from edits.wct, no base-file merge", () => {
  it("maps every stored entry, including custom ones, to a WhyChooseThisEntry", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: {
        "wct-001": { id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Base text", subtext: "Base subtext", searchFormatted: "", isNew: false },
        "wct-custom-1": { id: "wct-custom-1", productType: "Home", productStyle: "Bold", category: "Gift Impact", text: "Custom text", subtext: "Custom subtext", searchFormatted: "", isNew: true },
      },
    });

    const result = await getWctLibrary();

    expect(result).toHaveLength(2);
    expect(result.find((e) => e.id === "wct-001")).toEqual({
      id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Base text", subtext: "Base subtext",
    });
    expect(result.find((e) => e.id === "wct-custom-1")).toEqual({
      id: "wct-custom-1", productType: "Home", productStyle: "Bold", category: "Gift Impact", text: "Custom text", subtext: "Custom subtext",
    });
  });

  it("returns an empty array when there are no entries", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue(emptyEdits);
    expect(await getWctLibrary()).toEqual([]);
  });
});
