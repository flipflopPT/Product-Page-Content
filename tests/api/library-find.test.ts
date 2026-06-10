import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("@/lib/library-edits-store", () => ({ getLibraryEdits: vi.fn() }));
vi.mock("@/lib/pf-store", () => ({ findPhraseForEntry: vi.fn() }));
vi.mock("@/data/why-choose-this.json", () => ({ default: [] }));

import { POST } from "@/app/api/library/find/route";
import { shopifyGraphQL } from "@/lib/shopify";
import { getLibraryEdits } from "@/lib/library-edits-store";
import { findPhraseForEntry } from "@/lib/pf-store";
import { requireAuth } from "@/lib/auth";

const emptyEdits = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };

function shopifyPage(nodes: Array<{ id: string; title: string; typePt?: string | null; stylePt?: string | null; wct1?: string; pf1?: string }>, hasNextPage = false) {
  const mf = (v?: string | null) => (v ? { value: v } : null);
  return {
    products: {
      edges: nodes.map((n) => ({
        node: {
          id: n.id, title: n.title,
          typePt: mf(n.typePt ?? "Home"), stylePt: mf(n.stylePt ?? "Minimal"),
          wct1: mf(n.wct1), wct2: null, wct3: null, wct4: null,
          pf1: mf(n.pf1), pf2: null, pf3: null, pf4: null,
        },
        cursor: n.id,
      })),
      pageInfo: { hasNextPage },
    },
  };
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
});

describe("POST /api/library/find (WCT)", () => {
  it("returns products whose WCT bullet matches searchFormatted or newFormatted", async () => {
    const oldFormatted = "<strong>Old text</strong> old sub";
    const newFormatted = "<strong>New text</strong> new sub";
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: { "wct-1": { id: "wct-1", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "New text", subtext: "new sub", searchFormatted: oldFormatted, isNew: false } },
    });
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([
      { id: "gid://shopify/Product/1", title: "Has old text", wct1: oldFormatted },
      { id: "gid://shopify/Product/2", title: "Has new text", wct1: newFormatted },
      { id: "gid://shopify/Product/3", title: "No match", wct1: "<strong>Unrelated</strong> text" },
    ]));
    const req = new NextRequest("http://localhost/api/library/find", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "wct-1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.products).toHaveLength(2);
    const titles = body.products.map((p: { title: string }) => p.title);
    expect(titles).toContain("Has old text");
    expect(titles).toContain("Has new text");
  });

  it("returns 404 when WCT entry is not found in edits or base library", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValue(emptyEdits);
    const req = new NextRequest("http://localhost/api/library/find", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "nonexistent" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("filters WCT matches by product type and style", async () => {
    const oldFormatted = "<strong>Old</strong> text";
    vi.mocked(getLibraryEdits).mockResolvedValue({
      ...emptyEdits,
      wct: { "wct-1": { id: "wct-1", productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "New", subtext: "text", searchFormatted: oldFormatted, isNew: false } },
    });
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([
      { id: "p1", title: "Right type/style", typePt: "Home", stylePt: "Minimal", wct1: oldFormatted },
      { id: "p2", title: "Wrong type", typePt: "Bags & Purses", stylePt: "Elegant", wct1: oldFormatted },
    ]));
    const req = new NextRequest("http://localhost/api/library/find", {
      method: "POST",
      body: JSON.stringify({ type: "wct", id: "wct-1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.products).toHaveLength(1);
    expect(body.products[0].title).toBe("Right type/style");
  });
});

describe("POST /api/library/find (PF)", () => {
  it("returns products whose PF bullet matches the phrase's searchPhrase or current phrase", async () => {
    const oldPhrase = "Old phrase";
    const newPhrase = "New phrase";
    vi.mocked(findPhraseForEntry).mockResolvedValue({
      phrase: { id: "pf-1", phraseId: "pf-1", productType: "ALL", productStyle: "ALL", category: "Occasion", phrase: newPhrase, filterByInterest: false, timeSensitive: null, applicabilityCount: 0, icon: "home" },
      edit: { id: "pf-1", phrase: newPhrase, icon: "home", searchPhrase: oldPhrase, isNew: false },
    } as never);
    vi.mocked(shopifyGraphQL).mockResolvedValue(shopifyPage([
      { id: "p1", title: "Match (old)", pf1: oldPhrase },
      { id: "p2", title: "Match (new)", pf1: newPhrase },
      { id: "p3", title: "No match", pf1: "Different phrase" },
    ]));
    const req = new NextRequest("http://localhost/api/library/find", {
      method: "POST",
      body: JSON.stringify({ type: "pf", id: "pf-1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.products).toHaveLength(2);
  });

  it("returns 404 when PF phrase entry is not found", async () => {
    vi.mocked(findPhraseForEntry).mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/library/find", {
      method: "POST",
      body: JSON.stringify({ type: "pf", id: "nonexistent" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });
});
