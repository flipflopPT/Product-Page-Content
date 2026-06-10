import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { collectSSE } from "@/tests/api/helpers";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: vi.fn() }));
vi.mock("@/lib/metafields", () => ({ setProductMetafields: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pf-store", () => ({ getPfLibrary: vi.fn().mockResolvedValue([]) }));

import { POST } from "@/app/api/library/replace/route";
import { shopifyGraphQL } from "@/lib/shopify";
import { setProductMetafields } from "@/lib/metafields";
import { getPfLibrary } from "@/lib/pf-store";
import { requireAuth } from "@/lib/auth";

function makeScanPage(
  products: {
    id?: string;
    title?: string;
    typePt?: string;
    stylePt?: string;
    pf1?: string;
    pf2?: string;
    pf3?: string;
    pf4?: string;
  }[],
  hasNextPage = false
) {
  return {
    products: {
      edges: products.map((p, i) => ({
        node: {
          id: p.id ?? `gid://shopify/Product/${i + 1}`,
          title: p.title ?? `Product ${i + 1}`,
          typePt: p.typePt ? { value: p.typePt } : null,
          stylePt: p.stylePt ? { value: p.stylePt } : null,
          pf1: p.pf1 ? { value: p.pf1 } : null,
          pf2: p.pf2 ? { value: p.pf2 } : null,
          pf3: p.pf3 ? { value: p.pf3 } : null,
          pf4: p.pf4 ? { value: p.pf4 } : null,
        },
        cursor: `cursor-${i}`,
      })),
      pageInfo: { hasNextPage },
    },
  };
}

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/library/replace", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(setProductMetafields).mockResolvedValue(undefined);
  vi.mocked(getPfLibrary).mockResolvedValue([]);
});

describe("POST /api/library/replace", () => {
  it("returns 400 when oldPhrase is missing", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValue(makeScanPage([]));
    const res = await POST(makeReq({ newPhrase: "New phrase" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when newPhrase is missing", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValue(makeScanPage([]));
    const res = await POST(makeReq({ oldPhrase: "Old phrase" }));
    expect(res.status).toBe(400);
  });

  it("swaps oldPhrase with newPhrase in matching product", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makeScanPage([{ id: "gid://shopify/Product/1", title: "Vase", pf1: "Old phrase", pf2: "Other" }])
    );
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase" }));
    expect(vi.mocked(setProductMetafields)).toHaveBeenCalledWith(
      "gid://shopify/Product/1",
      expect.objectContaining({
        perfectFor: expect.objectContaining({ bullet1: "New phrase", bullet2: "Other" }),
      })
    );
  });

  it("streams a progress event for each updated product", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makeScanPage([
        { title: "Vase", pf1: "Old phrase" },
        { title: "Mug", pf1: "Old phrase" },
      ])
    );
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase" }));
    const events = await collectSSE(res);
    const progress = events.filter((e: unknown) => (e as { type: string }).type === "progress");
    expect(progress).toHaveLength(2);
    expect(progress[0]).toMatchObject({ type: "progress", status: "updated" });
  });

  it("skips products that do not contain oldPhrase", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makeScanPage([
        { title: "Match", pf1: "Old phrase" },
        { title: "No Match", pf1: "Something else" },
      ])
    );
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase" }));
    const events = await collectSSE(res);
    const done = events.find((e: unknown) => (e as { type: string }).type === "done") as { skipped: number };
    expect(done.skipped).toBe(1);
  });

  it("done event has correct swapped and skipped counts", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makeScanPage([
        { pf1: "Old phrase" },
        { pf1: "Other phrase" },
        { pf1: "Old phrase" },
      ])
    );
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase" }));
    const events = await collectSSE(res);
    const done = events.find((e: unknown) => (e as { type: string }).type === "done") as {
      swapped: number; skipped: number; updated: number; total: number; alternated: number; failed: number;
    };
    expect(done.swapped).toBe(2);
    expect(done.skipped).toBe(1);
    expect(done.updated).toBe(2);
    expect(done.total).toBe(3);
    expect(done.alternated).toBe(0);
    expect(done.failed).toBe(0);
  });

  it("uses library alternative when newPhrase already present in product bullets (alternated)", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makeScanPage([{ id: "gid://shopify/Product/1", title: "Vase", typePt: "Home", stylePt: "Minimal", pf1: "Old phrase", pf2: "New phrase" }])
    );
    vi.mocked(getPfLibrary).mockResolvedValueOnce([
      {
        id: "alt-1", phraseId: "alt", productType: "Home", productStyle: "Minimal",
        category: "Occasion", phrase: "Alternative phrase", filterByInterest: false,
        timeSensitive: null, applicabilityCount: 5, icon: "gift",
      },
    ] as never);
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase" }));
    const events = await collectSSE(res);
    const done = events.find((e: unknown) => (e as { type: string }).type === "done") as { alternated: number };
    expect(done.alternated).toBe(1);
    expect(vi.mocked(setProductMetafields)).toHaveBeenCalledWith(
      "gid://shopify/Product/1",
      expect.objectContaining({
        perfectFor: expect.objectContaining({ bullet1: "Alternative phrase" }),
      })
    );
  });

  it("filters out products whose type does not match productType param", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makeScanPage([
        { title: "Vase", typePt: "Home", pf1: "Old phrase" },
        { title: "Bag", typePt: "Bags & Purses", pf1: "Old phrase" },
      ])
    );
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase", productType: "Home" }));
    const events = await collectSSE(res);
    const done = events.find((e: unknown) => (e as { type: string }).type === "done") as {
      swapped: number; skipped: number;
    };
    expect(done.swapped).toBe(1);
    expect(done.skipped).toBe(1);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const res = await POST(makeReq({ oldPhrase: "Old phrase", newPhrase: "New phrase" }));
    expect(res.status).toBe(401);
  });
});
