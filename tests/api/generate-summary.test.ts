import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ getProductWithMetafields: vi.fn() }));
vi.mock("@/lib/generate-summary", () => ({ generateProductSummary: vi.fn() }));

import { POST } from "@/app/api/generate-summary/route";
import { getProductWithMetafields } from "@/lib/metafields";
import { generateProductSummary } from "@/lib/generate-summary";
import { requireAuth } from "@/lib/auth";

function mockProduct(type = "Home", style = "Minimal") {
  vi.mocked(getProductWithMetafields).mockResolvedValue({
    product: {
      id: "gid://shopify/Product/1",
      title: "Ceramic Vase",
      handle: "ceramic-vase",
      descriptionHtml: "<p>A beautiful ceramic vase.</p>",
      featuredImage: null,
      price: 0,
    },
    metafields: {
      productTypePt: type,
      productStylePt: style,
      productSummary: "",
      whyChooseThis: { bullet1: "", bullet2: "", bullet3: "", bullet4: "" },
      perfectFor: { bullet1: "", bullet2: "", bullet3: "", bullet4: "", icon1: "", icon2: "", icon3: "", icon4: "" },
      seasonalOverrides: { mothersDay: false, fathersDay: false, valentinesDay: false },
    },
  });
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(generateProductSummary).mockResolvedValue({
    options: ["A beautiful ceramic vase.", "The perfect minimalist piece.", "Elevate any home."],
  });
  mockProduct();
});

describe("POST /api/generate-summary", () => {
  it("returns options array for a classified product", async () => {
    const req = new NextRequest("http://localhost/api/generate-summary", {
      method: "POST",
      body: JSON.stringify({ productId: "gid://shopify/Product/1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("options");
    expect(Array.isArray(body.options)).toBe(true);
    expect(body.options).toHaveLength(3);
  });

  it("returns 400 when product has no type", async () => {
    mockProduct("", "Minimal");
    const req = new NextRequest("http://localhost/api/generate-summary", {
      method: "POST",
      body: JSON.stringify({ productId: "gid://shopify/Product/1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when product has no style", async () => {
    mockProduct("Home", "");
    const req = new NextRequest("http://localhost/api/generate-summary", {
      method: "POST",
      body: JSON.stringify({ productId: "gid://shopify/Product/1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 422 when generateProductSummary returns an error", async () => {
    vi.mocked(generateProductSummary).mockResolvedValueOnce({
      error: { type: "credits_exhausted", message: "Credits exhausted" },
    });
    const req = new NextRequest("http://localhost/api/generate-summary", {
      method: "POST",
      body: JSON.stringify({ productId: "gid://shopify/Product/1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it("passes correct product details to generateProductSummary", async () => {
    const req = new NextRequest("http://localhost/api/generate-summary", {
      method: "POST",
      body: JSON.stringify({ productId: "gid://shopify/Product/1" }),
      headers: { "content-type": "application/json" },
    });
    await POST(req);
    expect(vi.mocked(generateProductSummary)).toHaveBeenCalledWith(
      expect.objectContaining({ productType: "Home", productStyle: "Minimal" })
    );
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const req = new NextRequest("http://localhost/api/generate-summary", {
      method: "POST",
      body: JSON.stringify({ productId: "gid://shopify/Product/1" }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
