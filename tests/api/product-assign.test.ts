import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ setProductMetafields: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/taxonomy-store", () => ({ getTaxonomy: vi.fn() }));
vi.mock("@/lib/assignment-engine", () => ({
  assignSeasonalPhrases: vi.fn().mockReturnValue({
    mothersDay: null,
    fathersDay: null,
    valentinesDay: null,
  }),
}));
vi.mock("@/lib/pf-store", () => ({ getPfLibrary: vi.fn().mockResolvedValue([]) }));

import { POST } from "@/app/api/products/[id]/assign/route";
import { setProductMetafields } from "@/lib/metafields";
import { getTaxonomy } from "@/lib/taxonomy-store";
import { requireAuth } from "@/lib/auth";

const validTaxonomy = { Home: ["Minimal", "Bold/Colourful", "Scandi"] };

const defaultBody = {
  productSummary: "A lovely vase.",
  productTypePt: "Home",
  productStylesPt: ["Minimal"],
  humanReviewed: true,
  whyChooseThis: { bullet1: "b1", bullet2: "b2", bullet3: "b3", bullet4: "b4" },
  perfectFor: {
    bullet1: "p1", bullet2: "p2", bullet3: "p3", bullet4: "p4",
    icon1: "i1", icon2: "i2", icon3: "i3", icon4: "i4",
  },
};

const params = { params: Promise.resolve({ id: "123" }) };

function makeReq(body = defaultBody) {
  return new NextRequest("http://localhost/api/products/123/assign", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(getTaxonomy).mockResolvedValue(validTaxonomy);
  vi.mocked(setProductMetafields).mockResolvedValue(undefined);
});

describe("POST /api/products/[id]/assign", () => {
  it("returns { ok: true } on successful save", async () => {
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("calls setProductMetafields with correct product GID", async () => {
    await POST(makeReq(), params);
    expect(vi.mocked(setProductMetafields)).toHaveBeenCalledWith(
      "gid://shopify/Product/123",
      expect.any(Object)
    );
  });

  it("calls setProductMetafields with summary, type, style, WCT and PF fields", async () => {
    await POST(makeReq(), params);
    expect(vi.mocked(setProductMetafields)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        productSummary: "A lovely vase.",
        productTypePt: "Home",
        productStylePt: "Minimal",
        whyChooseThis: defaultBody.whyChooseThis,
        perfectFor: expect.objectContaining({ bullet1: "p1" }),
      })
    );
  });

  it("includes seasonal overrides from assignSeasonalPhrases", async () => {
    const { assignSeasonalPhrases } = await import("@/lib/assignment-engine");
    vi.mocked(assignSeasonalPhrases).mockReturnValueOnce({
      mothersDay: { phrase: "For mum", icon: "flower" },
      fathersDay: null,
      valentinesDay: null,
    });
    await POST(makeReq(), params);
    expect(vi.mocked(setProductMetafields)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        seasonalOverrides: expect.objectContaining({
          mothersDay: { phrase: "For mum", icon: "flower" },
        }),
      })
    );
  });

  it("returns 400 when style is not valid for the given type", async () => {
    const body = { ...defaultBody, productStylesPt: ["NotAStyle"] };
    const res = await POST(makeReq(body), params);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("NotAStyle");
  });

  it("returns 500 when setProductMetafields throws", async () => {
    vi.mocked(setProductMetafields).mockRejectedValueOnce(new Error("Shopify error"));
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Shopify error");
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const res = await POST(makeReq(), params);
    expect(res.status).toBe(401);
  });
});
