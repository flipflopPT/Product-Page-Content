import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ getProductsBatchWithMetafields: vi.fn() }));
vi.mock("@/lib/pf-store", () => ({ getPfLibrary: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/settings-store", () => ({ getSettings: vi.fn().mockResolvedValue({ dateRanges: { mothersDay: null, fathersDay: null, valentinesDay: null }, interestKeywords: {} }) }));
vi.mock("@/lib/library-edits-store", () => ({ getLibraryEdits: vi.fn().mockResolvedValue({ wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] }) }));
vi.mock("@/data/why-choose-this.json", () => ({ default: [] }));

import { POST } from "@/app/api/bulk-content-review/route";
import { getProductsBatchWithMetafields } from "@/lib/metafields";
import { requireAuth } from "@/lib/auth";

function makeProductBatch(gids: string[]) {
  return gids.map((gid) => ({
    product: { id: gid, title: `Product ${gid}`, handle: "p", descriptionHtml: "", featuredImage: { url: "https://cdn.shopify.com/img.jpg", altText: "" }, price: 0 },
    metafields: {
      productTypePt: "Home", productStylePt: "Minimal", productSummary: "A nice product",
      whyChooseThis: { bullet1: "b1", bullet2: "b2", bullet3: "b3", bullet4: "b4" },
      perfectFor: { bullet1: "pf1", bullet2: "pf2", bullet3: "pf3", bullet4: "pf4", icon1: "home", icon2: "heart", icon3: "star", icon4: "baby" },
      seasonalOverrides: { mothersDay: false, fathersDay: false, valentinesDay: false },
    },
  }));
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
});

describe("POST /api/bulk-content-review", () => {
  it("returns rows with product data and metafields", async () => {
    vi.mocked(getProductsBatchWithMetafields).mockResolvedValueOnce(
      makeProductBatch(["gid://shopify/Product/1"]) as never
    );
    const req = new NextRequest("http://localhost/api/bulk-content-review", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].title).toBe("Product gid://shopify/Product/1");
    expect(body.rows[0].wctBullets).toHaveLength(4);
    expect(body.rows[0].pfBullets).toHaveLength(4);
    expect(body.rows[0].pfIcons).toHaveLength(4);
  });

  it("silently excludes products that were not returned by the batch call", async () => {
    // getProductsBatchWithMetafields silently drops products it can't fetch
    vi.mocked(getProductsBatchWithMetafields).mockResolvedValueOnce(
      makeProductBatch(["gid://shopify/Product/1"]) as never
    );
    const req = new NextRequest("http://localhost/api/bulk-content-review", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1", "gid://shopify/Product/999"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
  });

  it("returns 400 for empty productIds", async () => {
    const req = new NextRequest("http://localhost/api/bulk-content-review", {
      method: "POST",
      body: JSON.stringify({ productIds: [] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const req = new NextRequest("http://localhost/api/bulk-content-review", {
      method: "POST",
      body: JSON.stringify({ productIds: ["p1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
