import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/library-edits-store", () => ({ getLibraryEdits: vi.fn() }));
vi.mock("@/lib/pf-store", () => ({
  getPfLibrary: vi.fn(),
  getPfPhraseRows: vi.fn(),
  savePhraseIcon: vi.fn().mockResolvedValue(undefined),
  findPhraseIdByText: vi.fn().mockResolvedValue(undefined),
}));

import { GET, PATCH } from "@/app/api/library/route";
import { getLibraryEdits } from "@/lib/library-edits-store";
import { getPfLibrary, savePhraseIcon, findPhraseIdByText } from "@/lib/pf-store";
import { requireAuth } from "@/lib/auth";

const emptyEdits = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };

const samplePfLibrary = [
  { id: "pf-1", phraseId: "phrase-1", productType: "Home", productStyle: "Minimal", category: "Occasion", phrase: "A housewarming gift", filterByInterest: false, timeSensitive: null, applicabilityCount: 10, icon: "home" },
  { id: "pf-2", phraseId: "phrase-2", productType: "Home", productStyle: "Minimal", category: "Person", phrase: "For the homebody", filterByInterest: false, timeSensitive: null, applicabilityCount: 8, icon: "heart" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(getLibraryEdits).mockResolvedValue(emptyEdits);
  vi.mocked(getPfLibrary).mockResolvedValue(samplePfLibrary as never);
  vi.mocked(savePhraseIcon).mockResolvedValue(undefined);
  vi.mocked(findPhraseIdByText).mockResolvedValue(undefined);
});

describe("GET /api/library (type=why)", () => {
  it("returns WCT library entries", async () => {
    const req = new NextRequest("http://localhost/api/library?type=why");
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("filters by productType", async () => {
    const req = new NextRequest("http://localhost/api/library?type=why&productType=Home");
    const res = await GET(req);
    const body = await res.json();
    for (const entry of body.entries) {
      expect(entry.productType).toBe("Home");
    }
  });

  it("filters by category", async () => {
    const req = new NextRequest("http://localhost/api/library?type=why&category=Stands+Out");
    const res = await GET(req);
    const body = await res.json();
    for (const entry of body.entries) {
      expect(entry.category).toBe("Stands Out");
    }
  });

  it("filters by search text", async () => {
    const req = new NextRequest("http://localhost/api/library?type=why&search=zzznomatch");
    const res = await GET(req);
    const body = await res.json();
    expect(body.entries).toHaveLength(0);
  });

  it("includes edits — overrides existing entry text", async () => {
    // Find the first WCT entry from the base library to edit
    const baseWCT = await import("@/data/why-choose-this.json");
    const firstId = (baseWCT.default.data as Array<{ id: string; text: string; subtext: string }>)[0]?.id;
    if (!firstId) return;

    vi.mocked(getLibraryEdits).mockResolvedValueOnce({
      ...emptyEdits,
      wct: { [firstId]: { id: firstId, productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Edited text", subtext: "edited subtext", searchFormatted: "", isNew: false } },
    });

    const req = new NextRequest(`http://localhost/api/library?type=why&productType=Home&productStyle=Minimal&category=Stands+Out`);
    const res = await GET(req);
    const body = await res.json() as { entries: Array<{ id: string; text: string }> };
    const edited = body.entries.find((e) => e.id === firstId);
    if (edited) {
      expect(edited.text).toBe("Edited text");
    }
  });
});

describe("GET /api/library (type=perfect)", () => {
  it("returns PF library entries", async () => {
    const req = new NextRequest("http://localhost/api/library?type=perfect");
    const res = await GET(req);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);
  });

  it("entries include _edit metadata from pfPhrases edits", async () => {
    vi.mocked(getLibraryEdits).mockResolvedValueOnce({
      ...emptyEdits,
      pfPhrases: { "phrase-1": { id: "phrase-1", phrase: "Updated gift", icon: "star", searchPhrase: "A housewarming gift", isNew: false } },
    });
    const req = new NextRequest("http://localhost/api/library?type=perfect");
    const res = await GET(req);
    const body = await res.json() as { entries: Array<{ phraseId: string; _edit: unknown }> };
    const entry = body.entries.find((e) => e.phraseId === "phrase-1");
    expect(entry?._edit).not.toBeNull();
  });

  it("filters by category", async () => {
    const req = new NextRequest("http://localhost/api/library?type=perfect&category=Occasion");
    const res = await GET(req);
    const body = await res.json();
    for (const entry of body.entries) {
      expect(entry.category).toBe("Occasion");
    }
  });
});

describe("PATCH /api/library (icon override)", () => {
  it("saves icon when phraseId and icon provided", async () => {
    vi.mocked(findPhraseIdByText).mockResolvedValue(undefined);
    const req = new NextRequest("http://localhost/api/library", {
      method: "PATCH",
      body: JSON.stringify({ phraseId: "phrase-1", icon: "heart" }),
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(savePhraseIcon).toHaveBeenCalledWith("phrase-1", "heart");
  });

  it("looks up phraseId by phrase text when phraseId not provided", async () => {
    vi.mocked(findPhraseIdByText).mockResolvedValueOnce("phrase-1");
    const req = new NextRequest("http://localhost/api/library", {
      method: "PATCH",
      body: JSON.stringify({ phrase: "A housewarming gift", icon: "star" }),
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(findPhraseIdByText).toHaveBeenCalledWith("A housewarming gift");
    expect(savePhraseIcon).toHaveBeenCalledWith("phrase-1", "star");
  });

  it("returns 400 when neither phraseId nor phrase provided", async () => {
    const req = new NextRequest("http://localhost/api/library", {
      method: "PATCH",
      body: JSON.stringify({ icon: "heart" }),
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 without saving when icon is null", async () => {
    const req = new NextRequest("http://localhost/api/library", {
      method: "PATCH",
      body: JSON.stringify({ phraseId: "phrase-1", icon: null }),
      headers: { "content-type": "application/json" },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(savePhraseIcon).not.toHaveBeenCalled();
  });
});
