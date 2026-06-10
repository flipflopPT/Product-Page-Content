import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ setProductsMetafieldsBatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/pf-store", () => ({ getPfLibrary: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/assignment-engine", () => ({
  assignSeasonalPhrases: vi.fn().mockReturnValue({ mothersDay: null, fathersDay: null, valentinesDay: null }),
}));

import { POST } from "@/app/api/bulk-content-save/route";
import { setProductsMetafieldsBatch } from "@/lib/metafields";
import { requireAuth } from "@/lib/auth";

const sampleRow = {
  productId: "gid://shopify/Product/1",
  summary: "A nice vase.",
  wctBullets: ["b1", "b2", "b3", "b4"] as [string, string, string, string],
  pfBullets: ["pf1", "pf2", "pf3", "pf4"] as [string, string, string, string],
  pfIcons: ["home", "heart", "star", "baby"] as [string, string, string, string],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(setProductsMetafieldsBatch).mockResolvedValue(undefined);
});

describe("POST /api/bulk-content-save", () => {
  it("saves rows and returns saved/failed counts", async () => {
    const req = new NextRequest("http://localhost/api/bulk-content-save", {
      method: "POST",
      body: JSON.stringify({ rows: [sampleRow] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(0);
    const batchCall = vi.mocked(setProductsMetafieldsBatch).mock.calls[0][0];
    expect(batchCall[0].productGid).toBe(sampleRow.productId);
    expect(batchCall[0].data).toMatchObject({ productSummary: sampleRow.summary });
  });

  it("includes productTypePt and seasonalOverrides when productTypePt is in the row", async () => {
    const rowWithOptionals = {
      ...sampleRow,
      productTypePt: "Home",
      productStylePt: "Minimal",
    };
    const req = new NextRequest("http://localhost/api/bulk-content-save", {
      method: "POST",
      body: JSON.stringify({ rows: [rowWithOptionals] }),
      headers: { "content-type": "application/json" },
    });
    await POST(req);
    const batchCall = vi.mocked(setProductsMetafieldsBatch).mock.calls[0][0];
    expect(batchCall[0].data).toHaveProperty("productTypePt", "Home");
    expect(batchCall[0].data).toHaveProperty("seasonalOverrides");
  });

  it("does not include productTypePt or seasonalOverrides when productTypePt is absent", async () => {
    const req = new NextRequest("http://localhost/api/bulk-content-save", {
      method: "POST",
      body: JSON.stringify({ rows: [sampleRow] }),
      headers: { "content-type": "application/json" },
    });
    await POST(req);
    const batchCall = vi.mocked(setProductsMetafieldsBatch).mock.calls[0][0];
    expect(batchCall[0].data).not.toHaveProperty("productTypePt");
    expect(batchCall[0].data).not.toHaveProperty("seasonalOverrides");
  });

  it("counts all rows as failed when setProductsMetafieldsBatch throws", async () => {
    vi.mocked(setProductsMetafieldsBatch).mockRejectedValueOnce(new Error("Shopify error"));
    const req = new NextRequest("http://localhost/api/bulk-content-save", {
      method: "POST",
      body: JSON.stringify({ rows: [sampleRow] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.saved).toBe(0);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const req = new NextRequest("http://localhost/api/bulk-content-save", {
      method: "POST",
      body: JSON.stringify({ rows: [sampleRow] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
