import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/taxonomy-store", () => ({
  getTaxonomy: vi.fn(),
  saveTaxonomy: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/taxonomy/route";
import { getTaxonomy, saveTaxonomy } from "@/lib/taxonomy-store";
import { requireAuth } from "@/lib/auth";

const sampleTaxonomy = {
  Home: ["Minimal", "Bold/Colourful"],
  "Bags & Purses": ["Elegant", "Casual"],
};

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(getTaxonomy).mockResolvedValue(sampleTaxonomy);
  vi.mocked(saveTaxonomy).mockResolvedValue(undefined);
});

describe("GET /api/taxonomy", () => {
  it("returns the current taxonomy", async () => {
    const req = new NextRequest("http://localhost/api/taxonomy");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ taxonomy: sampleTaxonomy });
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const req = new NextRequest("http://localhost/api/taxonomy");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/taxonomy", () => {
  it("saves taxonomy and returns { ok: true }", async () => {
    const req = new NextRequest("http://localhost/api/taxonomy", {
      method: "POST",
      body: JSON.stringify({ taxonomy: sampleTaxonomy }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(vi.mocked(saveTaxonomy)).toHaveBeenCalledWith(sampleTaxonomy);
  });

  it("returns 500 when saveTaxonomy throws", async () => {
    vi.mocked(saveTaxonomy).mockRejectedValueOnce(new Error("Shopify unavailable"));
    const req = new NextRequest("http://localhost/api/taxonomy", {
      method: "POST",
      body: JSON.stringify({ taxonomy: sampleTaxonomy }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Shopify unavailable");
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const req = new NextRequest("http://localhost/api/taxonomy", {
      method: "POST",
      body: JSON.stringify({ taxonomy: sampleTaxonomy }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});
