import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { collectSSE } from "./helpers";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ getProductWithMetafields: vi.fn() }));
vi.mock("@/lib/taxonomy-store", async () => {
  const { PRODUCT_TAXONOMY } = await import("@/data/taxonomy");
  return { getTaxonomy: vi.fn().mockResolvedValue(PRODUCT_TAXONOMY) };
});
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

import { POST } from "@/app/api/bulk-classify/route";
import { getProductWithMetafields } from "@/lib/metafields";
import { requireAuth } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

function getMockCreate() {
  const instance = vi.mocked(Anthropic).mock.results[0]?.value as { messages: { create: ReturnType<typeof vi.fn> } } | undefined;
  return instance?.messages?.create;
}

function mockProduct(gid: string) {
  vi.mocked(getProductWithMetafields).mockResolvedValueOnce({
    product: { id: gid, title: "Test Product", handle: "test", descriptionHtml: "<p>desc</p>", featuredImage: null, price: 0 },
    metafields: {
      productTypePt: "Home", productStylePt: "Minimal", productSummary: "",
      whyChooseThis: { bullet1: "", bullet2: "", bullet3: "", bullet4: "" },
      perfectFor: { bullet1: "", bullet2: "", bullet3: "", bullet4: "", icon1: "", icon2: "", icon3: "", icon4: "" },
      seasonalOverrides: { mothersDay: false, fathersDay: false, valentinesDay: false },
    },
  });
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  process.env.ANTHROPIC_API_KEY = "test-key";
  vi.mocked(Anthropic).mockClear();
});

describe("POST /api/bulk-classify", () => {
  it("returns 400 for empty productIds", async () => {
    const req = new NextRequest("http://localhost/api/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ productIds: [] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("streams result events with error when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const req = new NextRequest("http://localhost/api/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; error?: string }>;
    const result = events.find((e) => e.type === "result")!;
    expect(result.error).toBeTruthy();
  });

  it("streams result event with suggested type and styles for classified product", async () => {
    mockProduct("gid://shopify/Product/1");
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ type: "Home", styles: ["Minimal"] }) }],
    });
    // Must use `function` (not arrow) — constructor mocks need [[Construct]]
    vi.mocked(Anthropic).mockImplementation(function(this: unknown) {
      (this as Record<string, unknown>).messages = { create: mockCreate };
    } as unknown as typeof Anthropic);

    const req = new NextRequest("http://localhost/api/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; suggestedType?: string; suggestedStyles?: string[] }>;
    const result = events.find((e) => e.type === "result")!;
    expect(result.suggestedType).toBe("Home");
    expect(result.suggestedStyles).toContain("Minimal");
  });

  it("strips invalid type from taxonomy", async () => {
    mockProduct("gid://shopify/Product/1");
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ type: "FakeType", styles: ["Style1"] }) }],
    });
    vi.mocked(Anthropic).mockImplementation(function(this: unknown) {
      (this as Record<string, unknown>).messages = { create: mockCreate };
    } as unknown as typeof Anthropic);

    const req = new NextRequest("http://localhost/api/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; suggestedType?: string }>;
    const result = events.find((e) => e.type === "result")!;
    expect(result.suggestedType).toBe("");
  });

  it("done event has correct succeeded/failed counts", async () => {
    mockProduct("gid://shopify/Product/1");
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ type: "Home", styles: ["Minimal"] }) }],
    });
    vi.mocked(Anthropic).mockImplementation(function(this: unknown) {
      (this as Record<string, unknown>).messages = { create: mockCreate };
    } as unknown as typeof Anthropic);

    const req = new NextRequest("http://localhost/api/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const events = await collectSSE(res) as Array<{ type: string; succeeded?: number; failed?: number }>;
    const done = events.find((e) => e.type === "done")!;
    expect(done.succeeded).toBe(1);
    expect(done.failed).toBe(0);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const req = new NextRequest("http://localhost/api/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ productIds: ["gid://shopify/Product/1"] }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
