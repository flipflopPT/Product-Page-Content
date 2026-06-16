import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ setProductMetafields: vi.fn() }));
vi.mock("@/lib/taxonomy-store", async () => {
  const { PRODUCT_TAXONOMY } = await import("@/data/taxonomy");
  return { getTaxonomy: vi.fn().mockResolvedValue(PRODUCT_TAXONOMY) };
});

import { POST } from "@/app/api/bulk-classify/save/route";
import { setProductMetafields } from "@/lib/metafields";
import { requireAuth } from "@/lib/auth";

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(setProductMetafields).mockResolvedValue(undefined);
});

describe("POST /api/bulk-classify/save", () => {
  it("saves valid assignments and returns saved/failed counts", async () => {
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({
        assignments: [{ productId: "gid://shopify/Product/1", type: "Home", styles: ["Minimal"] }],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(0);
    expect(setProductMetafields).toHaveBeenCalled();
  });

  it("fails assignment with type not in taxonomy", async () => {
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({
        assignments: [{ productId: "gid://shopify/Product/1", type: "FakeType", styles: ["Style1"] }],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.saved).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.errors[0].message).toContain("Invalid type");
  });

  it("fails assignment with no valid styles for type", async () => {
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({
        assignments: [{ productId: "gid://shopify/Product/1", type: "Home", styles: ["NotAStyle"] }],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.errors[0].message).toContain("No valid styles");
  });

  it("fails assignment when setProductMetafields throws", async () => {
    vi.mocked(setProductMetafields).mockRejectedValueOnce(new Error("Shopify error"));
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({
        assignments: [{ productId: "gid://shopify/Product/1", type: "Home", styles: ["Minimal"] }],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.failed).toBe(1);
  });

  it("returns 400 for empty assignments", async () => {
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({ assignments: [] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("handles mixed valid/invalid assignments correctly", async () => {
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({
        assignments: [
          { productId: "gid://shopify/Product/1", type: "Home", styles: ["Minimal"] },
          { productId: "gid://shopify/Product/2", type: "FakeType", styles: ["Style1"] },
        ],
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(1);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const req = new NextRequest("http://localhost/api/bulk-classify/save", {
      method: "POST",
      body: JSON.stringify({ assignments: [{ productId: "p1", type: "Home", styles: ["Minimal"] }] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
