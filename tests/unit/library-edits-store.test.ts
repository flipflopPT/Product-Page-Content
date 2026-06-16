import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("fs/promises", () => ({ default: { readFile: vi.fn().mockRejectedValue(new Error("ENOENT")) } }));

import { shopifyGraphQL } from "@/lib/shopify";
import fs from "fs/promises";

// The store keeps module-level cache/nodeId state, so every test needs a fresh
// module instance to avoid bleeding state (and mock call counts) across tests.
async function freshStore() {
  vi.resetModules();
  return import("@/lib/library-edits-store");
}

function metaobjectResponse(fields: Array<{ key: string; value: string }>) {
  return { metaobjects: { nodes: [{ id: "gid://shopify/Metaobject/1", fields }] } };
}

const wctEntry = {
  id: "wct-001", productType: "Home", productStyle: "Minimal", category: "Stands Out",
  text: "Made to last", subtext: "Built with care", searchFormatted: "<strong>Made to last</strong> Built with care", isNew: false,
};
const phraseEntry = { id: "phrase-001", phrase: "Birthdays", icon: "cake", searchPhrase: "Birthdays", isNew: false };
const applicabilityEntry = { id: "pf-001", phraseId: "phrase-001", productType: "Home", productStyle: "Minimal", applicabilityCount: 4, isNew: false };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"));
});

describe("getLibraryEdits — two-field read", () => {
  it("merges wct from edits_json and phrases/applicability/icons from pf_json", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(metaobjectResponse([
      { key: "edits_json", value: JSON.stringify({ wct: { [wctEntry.id]: wctEntry } }) },
      { key: "pf_json", value: JSON.stringify({ pfPhrases: { [phraseEntry.id]: phraseEntry }, pfApplicability: { [applicabilityEntry.id]: applicabilityEntry }, uploadedIcons: [{ name: "star", svg: "<svg/>" }] }) },
    ]));

    const store = await freshStore();
    const edits = await store.getLibraryEdits();

    expect(edits.wct).toEqual({ [wctEntry.id]: wctEntry });
    expect(edits.pfPhrases).toEqual({ [phraseEntry.id]: phraseEntry });
    expect(edits.pfApplicability).toEqual({ [applicabilityEntry.id]: applicabilityEntry });
    expect(edits.uploadedIcons).toEqual([{ name: "star", svg: "<svg/>" }]);
  });

  it("treats a missing pf_json field as empty PF data (back-compat before the field existed)", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(metaobjectResponse([
      { key: "edits_json", value: JSON.stringify({ wct: { [wctEntry.id]: wctEntry } }) },
      // no pf_json field on the node at all
    ]));

    const store = await freshStore();
    const edits = await store.getLibraryEdits();

    expect(edits.wct).toEqual({ [wctEntry.id]: wctEntry });
    expect(edits.pfPhrases).toEqual({});
    expect(edits.pfApplicability).toEqual({});
    expect(edits.uploadedIcons).toEqual([]);
  });

  it("treats an empty pf_json value as empty PF data", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(metaobjectResponse([
      { key: "edits_json", value: JSON.stringify({ wct: { [wctEntry.id]: wctEntry } }) },
      { key: "pf_json", value: "" },
    ]));

    const store = await freshStore();
    const edits = await store.getLibraryEdits();

    expect(edits.wct).toEqual({ [wctEntry.id]: wctEntry });
    expect(edits.pfPhrases).toEqual({});
  });

  it("falls back to the local seed file when no metaobject node exists, splitting it across both halves", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce({ metaobjects: { nodes: [] } });
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
      wct: { [wctEntry.id]: wctEntry },
      pfPhrases: { [phraseEntry.id]: phraseEntry },
      pfApplicability: { [applicabilityEntry.id]: applicabilityEntry },
      uploadedIcons: [],
    }));

    const store = await freshStore();
    const edits = await store.getLibraryEdits();

    expect(edits.wct).toEqual({ [wctEntry.id]: wctEntry });
    expect(edits.pfPhrases).toEqual({ [phraseEntry.id]: phraseEntry });
  });

  it("returns a fully empty store when Shopify is unreachable and no seed file exists", async () => {
    vi.mocked(shopifyGraphQL).mockRejectedValueOnce(new Error("network down"));
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"));

    const store = await freshStore();
    const edits = await store.getLibraryEdits();

    expect(edits).toEqual({ wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] });
  });
});

describe("persist — two-field write", () => {
  it("splits wct into edits_json and phrases/applicability/icons into pf_json on save", async () => {
    vi.mocked(shopifyGraphQL)
      .mockResolvedValueOnce(metaobjectResponse([
        { key: "edits_json", value: JSON.stringify({ wct: {} }) },
        { key: "pf_json", value: JSON.stringify({ pfPhrases: { [phraseEntry.id]: phraseEntry }, pfApplicability: {}, uploadedIcons: [] }) },
      ]))
      .mockResolvedValueOnce({ metaobjectUpdate: { metaobject: { id: "gid://shopify/Metaobject/1" }, userErrors: [] } });

    const store = await freshStore();
    await store.upsertWCTEdit(wctEntry);

    const [, variables] = vi.mocked(shopifyGraphQL).mock.calls[1];
    const fields = (variables as { f: Array<{ key: string; value: string }> }).f;
    const edits_json = fields.find((f) => f.key === "edits_json")!;
    const pf_json = fields.find((f) => f.key === "pf_json")!;

    expect(JSON.parse(edits_json.value)).toEqual({ wct: { [wctEntry.id]: wctEntry } });
    // pf_json should still carry the phrase that was already in the store — untouched by a wct-only edit
    expect(JSON.parse(pf_json.value)).toEqual({ pfPhrases: { [phraseEntry.id]: phraseEntry }, pfApplicability: {}, uploadedIcons: [] });
  });

  it("throws when Shopify returns userErrors on update", async () => {
    vi.mocked(shopifyGraphQL)
      .mockResolvedValueOnce(metaobjectResponse([
        { key: "edits_json", value: JSON.stringify({ wct: {} }) },
        { key: "pf_json", value: JSON.stringify({ pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] }) },
      ]))
      .mockResolvedValueOnce({ metaobjectUpdate: { metaobject: null, userErrors: [{ message: "boom" }] } });

    const store = await freshStore();
    await expect(store.upsertWCTEdit(wctEntry)).rejects.toThrow(/boom/);
  });
});

describe("renameStyleInLibrary", () => {
  it("renames matching wct and pfApplicability entries, leaves non-matching entries untouched, and persists", async () => {
    const otherWct = { ...wctEntry, id: "wct-002", productStyle: "Bold" };
    const otherApp = { ...applicabilityEntry, id: "pf-002", productStyle: "Bold" };

    vi.mocked(shopifyGraphQL)
      .mockResolvedValueOnce(metaobjectResponse([
        { key: "edits_json", value: JSON.stringify({ wct: { [wctEntry.id]: wctEntry, [otherWct.id]: otherWct } }) },
        { key: "pf_json", value: JSON.stringify({ pfPhrases: {}, pfApplicability: { [applicabilityEntry.id]: applicabilityEntry, [otherApp.id]: otherApp }, uploadedIcons: [] }) },
      ]))
      .mockResolvedValueOnce({ metaobjectUpdate: { metaobject: { id: "gid://shopify/Metaobject/1" }, userErrors: [] } });

    const store = await freshStore();
    const result = await store.renameStyleInLibrary("Home", "Minimal", "Cosy");

    expect(result).toEqual({ wctUpdated: 1, pfUpdated: 1 });

    const [, variables] = vi.mocked(shopifyGraphQL).mock.calls[1];
    const fields = (variables as { f: Array<{ key: string; value: string }> }).f;
    const edits_json = JSON.parse(fields.find((f) => f.key === "edits_json")!.value);
    const pf_json = JSON.parse(fields.find((f) => f.key === "pf_json")!.value);

    expect(edits_json.wct["wct-001"].productStyle).toBe("Cosy");
    expect(edits_json.wct["wct-002"].productStyle).toBe("Bold"); // untouched — different style
    expect(pf_json.pfApplicability["pf-001"].productStyle).toBe("Cosy");
    expect(pf_json.pfApplicability["pf-002"].productStyle).toBe("Bold");
  });

  it("does not persist when no entries match the old type/style", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(metaobjectResponse([
      { key: "edits_json", value: JSON.stringify({ wct: { [wctEntry.id]: wctEntry } }) },
      { key: "pf_json", value: JSON.stringify({ pfPhrases: {}, pfApplicability: { [applicabilityEntry.id]: applicabilityEntry }, uploadedIcons: [] }) },
    ]));

    const store = await freshStore();
    const result = await store.renameStyleInLibrary("Home", "DoesNotExist", "Cosy");

    expect(result).toEqual({ wctUpdated: 0, pfUpdated: 0 });
    // Only the initial read query — no update/create mutation fired
    expect(vi.mocked(shopifyGraphQL)).toHaveBeenCalledTimes(1);
  });
});
