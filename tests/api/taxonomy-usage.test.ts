import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/shopify", () => ({ shopifyGraphQL: vi.fn() }));

import { GET } from "@/app/api/taxonomy/usage/route";
import { shopifyGraphQL } from "@/lib/shopify";
import { requireAuth } from "@/lib/auth";

function makePage(
  edges: { title: string; productTypePt: string | null; productStylePt: string | null }[],
  hasNextPage = false,
  cursorPrefix = "c"
) {
  return {
    products: {
      edges: edges.map((node, i) => ({
        node: {
          title: node.title,
          productTypePt: node.productTypePt ? { value: node.productTypePt } : null,
          productStylePt: node.productStylePt ? { value: node.productStylePt } : null,
        },
        cursor: `${cursorPrefix}-${i}`,
      })),
      pageInfo: { hasNextPage },
    },
  };
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
});

describe("GET /api/taxonomy/usage", () => {
  it("returns count and sorted product titles when no filter", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makePage([
        { title: "Zebra Mug", productTypePt: "Home", productStylePt: "Minimal" },
        { title: "Apple Vase", productTypePt: "Home", productStylePt: "Minimal" },
      ])
    );
    const req = new NextRequest("http://localhost/api/taxonomy/usage");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.products).toEqual(["Apple Vase", "Zebra Mug"]); // sorted alphabetically
  });

  it("filters products by type query param", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makePage([
        { title: "Vase", productTypePt: "Home", productStylePt: "Minimal" },
        { title: "Handbag", productTypePt: "Bags & Purses", productStylePt: "Elegant" },
      ])
    );
    const req = new NextRequest("http://localhost/api/taxonomy/usage?type=Home");
    const res = await GET(req);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.products).toEqual(["Vase"]);
  });

  it("filters products by style query param (comma-separated styles)", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makePage([
        { title: "Vase", productTypePt: "Home", productStylePt: "Minimal, Bold/Colourful" },
        { title: "Mug", productTypePt: "Home", productStylePt: "Scandi" },
      ])
    );
    const req = new NextRequest("http://localhost/api/taxonomy/usage?style=Minimal");
    const res = await GET(req);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.products).toEqual(["Vase"]);
  });

  it("combines type and style filters", async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValueOnce(
      makePage([
        { title: "Vase", productTypePt: "Home", productStylePt: "Minimal" },
        { title: "Bag", productTypePt: "Bags & Purses", productStylePt: "Minimal" },
        { title: "Mug", productTypePt: "Home", productStylePt: "Bold/Colourful" },
      ])
    );
    const req = new NextRequest("http://localhost/api/taxonomy/usage?type=Home&style=Minimal");
    const res = await GET(req);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.products).toEqual(["Vase"]);
  });

  it("handles multi-page pagination and combines results", async () => {
    vi.mocked(shopifyGraphQL)
      .mockResolvedValueOnce(
        makePage(
          [{ title: "Page One Product", productTypePt: "Home", productStylePt: "Minimal" }],
          true,
          "page1"
        )
      )
      .mockResolvedValueOnce(
        makePage(
          [{ title: "Page Two Product", productTypePt: "Home", productStylePt: "Minimal" }],
          false,
          "page2"
        )
      );
    const req = new NextRequest("http://localhost/api/taxonomy/usage");
    const res = await GET(req);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.products).toContain("Page One Product");
    expect(body.products).toContain("Page Two Product");
  });

  it("returns 502 when shopifyGraphQL throws", async () => {
    vi.mocked(shopifyGraphQL).mockRejectedValueOnce(new Error("Shopify down"));
    const req = new NextRequest("http://localhost/api/taxonomy/usage");
    const res = await GET(req);
    expect(res.status).toBe(502);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const req = new NextRequest("http://localhost/api/taxonomy/usage");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
