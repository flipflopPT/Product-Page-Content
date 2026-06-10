import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/metafields", () => ({ getProductWithMetafields: vi.fn() }));
vi.mock("@/lib/settings-store", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/assignment-engine", () => ({
  assignWhyChooseThis: vi.fn().mockReturnValue({ bullet1: "b1", bullet2: "b2", bullet3: "b3", bullet4: "b4" }),
  assignPerfectFor: vi.fn().mockReturnValue({ bullets: ["p1", "p2", "p3", "p4"], icons: ["i1", "i2", "i3", "i4"] }),
}));
vi.mock("@/lib/pf-store", () => ({ getPfLibrary: vi.fn() }));
vi.mock("@/data/why-choose-this.json", () => ({ default: [] }));

import { GET } from "@/app/api/products/[id]/route";
import { getProductWithMetafields } from "@/lib/metafields";
import { getSettings } from "@/lib/settings-store";
import { getPfLibrary } from "@/lib/pf-store";
import { requireAuth } from "@/lib/auth";

const defaultSettings = {
  dateRanges: { mothersDay: null, fathersDay: null, valentinesDay: null },
  interestKeywords: {},
};

const defaultPfLibrary = [
  { id: "pf-1", phraseId: "p1", productType: "ALL", productStyle: "ALL", category: "Occasion", phrase: "p1", filterByInterest: false, timeSensitive: null, applicabilityCount: 5, icon: "gift" },
];

function mockProduct(type = "Home", style = "Minimal") {
  vi.mocked(getProductWithMetafields).mockResolvedValue({
    product: {
      id: "gid://shopify/Product/123",
      title: "Ceramic Vase",
      handle: "ceramic-vase",
      descriptionHtml: "<p>A beautiful minimal vase.</p>",
      featuredImage: null,
      price: 25,
    },
    metafields: {
      productTypePt: type,
      productStylePt: style,
      productSummary: "A nice vase.",
      whyChooseThis: { bullet1: "", bullet2: "", bullet3: "", bullet4: "" },
      perfectFor: { bullet1: "A housewarming gift", bullet2: "", bullet3: "", bullet4: "", icon1: "", icon2: "", icon3: "", icon4: "" },
      seasonalOverrides: { mothersDay: false, fathersDay: false, valentinesDay: false },
    },
  });
}

const params = { params: Promise.resolve({ id: "123" }) };

beforeEach(() => {
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(getSettings).mockResolvedValue(defaultSettings);
  vi.mocked(getPfLibrary).mockResolvedValue(defaultPfLibrary as never);
  mockProduct();
});

describe("GET /api/products/[id]", () => {
  it("returns product, metafields and preview for a classified product", async () => {
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("product");
    expect(body).toHaveProperty("metafields");
    expect(body).toHaveProperty("preview");
    expect(body.preview).not.toBeNull();
  });

  it("preview includes whyChooseThis, perfectFor, wctHasAlternatives, wctSlotCounts, pfSwapCount", async () => {
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    const body = await res.json();
    expect(body.preview).toHaveProperty("whyChooseThis");
    expect(body.preview).toHaveProperty("perfectFor");
    expect(body.preview).toHaveProperty("wctHasAlternatives");
    expect(body.preview).toHaveProperty("wctSlotCounts");
    expect(body.preview).toHaveProperty("pfSwapCount");
    expect(Array.isArray(body.preview.wctSlotCounts)).toBe(true);
    expect(body.preview.wctSlotCounts).toHaveLength(4);
  });

  it("returns preview: null when product has no type", async () => {
    mockProduct("", "Minimal");
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    const body = await res.json();
    expect(body.preview).toBeNull();
  });

  it("returns preview: null when product has no style", async () => {
    mockProduct("Home", "");
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    const body = await res.json();
    expect(body.preview).toBeNull();
  });

  it("fills empty icon fields from pfLibrary by phrase match", async () => {
    vi.mocked(getPfLibrary).mockResolvedValue([
      { ...defaultPfLibrary[0], phrase: "A housewarming gift", icon: "home-icon" },
    ] as never);
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    const body = await res.json();
    expect(body.metafields.perfectFor.icon1).toBe("home-icon");
  });

  it("does not overwrite an icon that is already set", async () => {
    vi.mocked(getProductWithMetafields).mockResolvedValueOnce({
      product: { id: "gid://shopify/Product/123", title: "Vase", handle: "vase", descriptionHtml: "", featuredImage: null, price: 0 },
      metafields: {
        productTypePt: "Home",
        productStylePt: "Minimal",
        productSummary: "",
        whyChooseThis: { bullet1: "", bullet2: "", bullet3: "", bullet4: "" },
        perfectFor: { bullet1: "A housewarming gift", bullet2: "", bullet3: "", bullet4: "", icon1: "existing-icon", icon2: "", icon3: "", icon4: "" },
        seasonalOverrides: { mothersDay: false, fathersDay: false, valentinesDay: false },
      },
    });
    vi.mocked(getPfLibrary).mockResolvedValue([
      { ...defaultPfLibrary[0], phrase: "A housewarming gift", icon: "library-icon" },
    ] as never);
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    const body = await res.json();
    expect(body.metafields.perfectFor.icon1).toBe("existing-icon");
  });

  it("returns 500 when getProductWithMetafields throws", async () => {
    vi.mocked(getProductWithMetafields).mockRejectedValueOnce(new Error("Shopify down"));
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    expect(res.status).toBe(500);
  });

  it("returns 401 when auth fails", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
    const req = new NextRequest("http://localhost/api/products/123");
    const res = await GET(req, params);
    expect(res.status).toBe(401);
  });
});
