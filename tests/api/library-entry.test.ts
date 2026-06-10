import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/library-edits-store", () => ({
  upsertWCTEdit: vi.fn(),
  deleteWCTEdit: vi.fn(),
}));
vi.mock("@/lib/pf-store", () => ({
  createPhrase: vi.fn().mockResolvedValue("pf-phrase-123"),
  savePhraseEdit: vi.fn().mockResolvedValue(undefined),
  addApplicability: vi.fn().mockResolvedValue("pf-app-456"),
  removeApplicability: vi.fn().mockResolvedValue(undefined),
  deletePhrase: vi.fn().mockResolvedValue(undefined),
  findPhraseForEntry: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/library/entry/route";
import { upsertWCTEdit, deleteWCTEdit } from "@/lib/library-edits-store";
import { createPhrase, deletePhrase, removeApplicability } from "@/lib/pf-store";
import { requireAuth } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(null);
  vi.mocked(upsertWCTEdit).mockResolvedValue(undefined);
  vi.mocked(deleteWCTEdit).mockResolvedValue(undefined);
});

describe("POST /api/library/entry (WCT)", () => {
  it("creates new WCT entry with generated id starting wct-custom-", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "POST",
      body: JSON.stringify({
        type: "wct",
        entry: { productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "New text", subtext: "new sub" },
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^wct-custom-/);
    expect(upsertWCTEdit).toHaveBeenCalled();
  });

  it("updates existing base WCT entry preserving searchFormatted from base library", async () => {
    const baseWCT = await import("@/data/why-choose-this.json");
    const firstId = (baseWCT.default as Array<{ id: string; text: string; subtext: string }>)[0]?.id;
    if (!firstId) return;

    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "POST",
      body: JSON.stringify({
        type: "wct",
        entry: { id: firstId, productType: "Home", productStyle: "Minimal", category: "Stands Out", text: "Updated", subtext: "updated" },
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(firstId);
    const call = vi.mocked(upsertWCTEdit).mock.calls[0][0];
    expect(call.searchFormatted).toBeTruthy();
  });
});

describe("POST /api/library/entry (PF — create new phrase)", () => {
  it("creates new phrase with typeStylePairs and returns phraseId", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "POST",
      body: JSON.stringify({
        type: "pf",
        entry: {
          phrase: "New phrase", icon: "home", category: "Occasion",
          timeSensitive: null, filterByInterest: false,
          typeStylePairs: [{ type: "Home", style: "Minimal" }],
        },
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.phraseId).toBeDefined();
    expect(createPhrase).toHaveBeenCalled();
  });

  it("returns 400 when phrase text is missing", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "POST",
      body: JSON.stringify({
        type: "pf",
        entry: { icon: "home", category: "Occasion", typeStylePairs: [{ type: "Home", style: "Minimal" }] },
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when typeStylePairs is empty", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "POST",
      body: JSON.stringify({
        type: "pf",
        entry: { phrase: "New phrase", icon: "home", category: "Occasion", typeStylePairs: [] },
      }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/library/entry (invalid type)", () => {
  it("returns 400 for unrecognised type", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "POST",
      body: JSON.stringify({ type: "unknown", entry: {} }),
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/library/entry", () => {
  it("calls deleteWCTEdit for type=wct", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "DELETE",
      body: JSON.stringify({ type: "wct", id: "wct-custom-123" }),
      headers: { "content-type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(deleteWCTEdit).toHaveBeenCalledWith("wct-custom-123");
  });

  it("calls deletePhrase for type=pf-phrase", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "DELETE",
      body: JSON.stringify({ type: "pf-phrase", id: "pf-phrase-456" }),
      headers: { "content-type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(deletePhrase).toHaveBeenCalledWith("pf-phrase-456");
  });

  it("calls removeApplicability for type=pf-applicability", async () => {
    const req = new NextRequest("http://localhost/api/library/entry", {
      method: "DELETE",
      body: JSON.stringify({ type: "pf-applicability", id: "app-789" }),
      headers: { "content-type": "application/json" },
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
    expect(removeApplicability).toHaveBeenCalledWith("app-789");
  });
});
