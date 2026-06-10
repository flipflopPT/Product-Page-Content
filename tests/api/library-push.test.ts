import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { collectSSE } from "./helpers";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("@/lib/metafields", () => ({ setProductMetafields: vi.fn() }));
vi.mock("@/lib/library-edits-store", () => ({
  getLibraryEdits: vi.fn(),
  markWCTPushed: vi.fn(),
}));
vi.mock("@/lib/pf-store", () => ({
  findPhraseForEntry: vi.fn(),
  markPFPhrasePushed: vi.fn(),
}));

import { POST } from "@/app/api/library/push/route";
import { shopifyGraphQL } from "@/lib/shopify";
import { setProductMetafields } from "@/lib/metafields";
import { getLibraryEdits, markWCTPushed } from "@/lib/library-edits-store";
import { findPhraseForEntry, markPFPhrasePushed } from "@/lib/pf-store";
import { requireAuth } from "@/lib/auth";

const emptyEdits = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };

function shopifyPage(nodes: Array<{ id: string; title: string; typePt?: string; stylePt?: string; wct1?: string; pf1?: string; pfIcon1?: string }>, hasNextPage = false) {
  const mf = (v?: string) => (v ? { value: v } : null);
  return {
    products: {
      edges: nodes.map((n) => ({
        node: {
          id: n.id, title: n.title,
          typePt: mf(n.typePt ?? "Home"), stylePt: mf(n.stylePt ?? "Minimal"),
          wct1: mf(n.wct1), wct2: null, wct3: null, wct4: null,
          pf1: mf(n.pf1), pf2: null, pf3: null, pf4: null,
          pfIcon1: mf(n.pfIcon1), pfIcon2: null, pfIcon3: null, pfIcon4: null,
        },
        cursor: n.id,
      })),
      pageInfo: { hasNextPage },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(setProductMetafields).mockResolvedValue(undefined);
  vi.mocked(markWCTPushed).mockResolvedValue(undefined);
  vi.mocked(markPFPhrasePushed).mockResolvedValue(undefined);
});

describe("POST /api/library/push (WCT)", () => {
  it("replaces old bullet with new in matched products", async () => {
    const oldFormatted = "<strong>Old</strong> text";
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: { "wct-1": { id: "wct-1", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "New", subtext: "text", searchFormatted: oldFormatted, isNew: false } },
    });
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([
      { id: "p1", title: "Match", wct1: oldFormatted },
    ]));
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "wct-1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; status?: string; updated?: number }>;
    const progress = events.filter((e) => e.type === "progress");
    expect(progress[0].status).toBe("updated");
    expect(setProductMetafields).toHaveBeenCalled();
  });

  it("returns done with zero updates when entry has no searchFormatted (new entry)", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: { "wct-new": { id: "wct-new", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "t", subtext: "s", searchFormatted: "", isNew: true } },
    });
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([]));
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "wct-new" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; updated?: number }>;
    const done = events.find((e) => e.type === "done")!;
    expect(done.updated).toBe(0);
  });

  it("calls markWCTPushed when at least one product was updated", async () => {
    const oldFormatted = "<strong>Old</strong> sub";
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: { "wct-1": { id: "wct-1", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "New", subtext: "sub", searchFormatted: oldFormatted, isNew: false } },
    });
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([{ id: "p1", title: "Match", wct1: oldFormatted }]));
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "wct-1" }),
      headers: { "content-type": "application/json" },
    });
    await POST(req).then(collectSSE);
    expect(markWCTPushed).toHaveBeenCalled();
  });

  it("done event totals are correct", async () => {
    const oldFormatted = "<strong>Old</strong> s";
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: { "wct-1": { id: "wct-1", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "New", subtext: "s", searchFormatted: oldFormatted, isNew: false } },
    });
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([
      { id: "p1", title: "Match", typePt: "Home", stylePt: "Minimal", wct1: oldFormatted },
      { id: "p2", title: "Skip (no match)", typePt: "Home", stylePt: "Minimal", wct1: "<strong>Other</strong> bullet" },
      { id: "p3", title: "Skip (wrong type)", typePt: "Bags & Purses", stylePt: "Elegant", wct1: oldFormatted },
    ]));
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "wct-1" }),
      headers: { "content-type": "application/json" },
    });
    const events = await POST(req).then(collectSSE) as Array<{ type: string; updated?: number; skipped?: number; failed?: number }>;
    const done = events.find((e) => e.type === "done")!;
    expect(done.updated).toBe(1);
    expect(done.skipped).toBe(2);
    expect(done.failed).toBe(0);
  });

  it("sends done event with zeros when WCT entry does not exist in edits", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue(emptyEdits);
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "nonexistent" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; updated?: number }>;
    const done = events.find((e) => e.type === "done")!;
    expect(done.updated).toBe(0);
    expect(shopifyGraphQL).not.toHaveBeenCalled();
  });
});

describe("POST /api/library/push (PF)", () => {
  it("replaces old phrase with new in matched PF bullets", async () => {
    const oldPhrase = "Old phrase";
    vi.mocked(findPhraseForEntry).mockResolvedValue({
      phrase: { id: "pf-1", phraseId: "pf-1", productType: "ALL", productStyle: "ALL", category: "Occasion", phrase: "New phrase", filterByInterest: false, timeSensitive: null, applicabilityCount: 0, icon: "home" },
      edit: { id: "pf-1", phrase: "New phrase", icon: "home", searchPhrase: oldPhrase, isNew: false },
    } as never);
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([
      { id: "p1", title: "Match", pf1: oldPhrase },
    ]));
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "pf", id: "pf-1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; status?: string }>;
    const progress = events.filter((e) => e.type === "progress");
    expect(progress[0].status).toBe("updated");
    expect(markPFPhrasePushed).toHaveBeenCalled();
  });

  it("sends done with zeros when PF phrase has no searchPhrase (new phrase)", async () => {
    vi.mocked(findPhraseForEntry).mockResolvedValue({
      phrase: { id: "pf-new", phraseId: "pf-new", productType: "ALL", productStyle: "ALL", category: "Occasion", phrase: "New phrase", filterByInterest: false, timeSensitive: null, applicabilityCount: 0, icon: "home" },
      edit: { id: "pf-new", phrase: "New phrase", icon: "home", searchPhrase: "", isNew: true },
    } as never);
    const req = new NextRequest("http://localhost/api/library/push", {
      method: "POST",
      body: JSON.stringify({ type: "pf", id: "pf-new" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; updated?: number }>;
    const done = events.find((e) => e.type === "done")!;
    expect(done.updated).toBe(0);
  });
});
