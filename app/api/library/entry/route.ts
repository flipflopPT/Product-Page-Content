import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  upsertWCTEdit, deleteWCTEdit, getLibraryEdits,
  type WCTEdit,
} from "@/lib/library-edits-store";
import {
  createPhrase, savePhraseEdit, addApplicability, removeApplicability, deletePhrase,
  findPhraseForEntry,
} from "@/lib/pf-store";
import type { PFPhrase } from "@/lib/types";

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const body = await req.json() as {
    type: "wct" | "pf";
    entry: Partial<WCTEdit> & {
      id?: string;
      // PF phrase fields
      phrase?: string;
      icon?: string;
      category?: string;
      timeSensitive?: string | null;
      filterByInterest?: boolean;
      minPrice?: number | null;
      maxPrice?: number | null;
      searchPhrase?: string;
      // New phrase creation: list of type/style pairs
      typeStylePairs?: { type: string; style: string }[];
      // Adding applicability to existing phrase
      phraseId?: string;
      productType?: string;
      productStyle?: string;
    };
  };

  try {
    if (body.type === "wct") {
      const { id, productType, productStyle, category, text, subtext } = body.entry as WCTEdit;

      if (!category) return NextResponse.json({ error: "category is required" }, { status: 400 });

      const isNew = !id || id.startsWith("wct-custom-");
      const entryId = id || `wct-custom-${Date.now()}`;

      let searchFormatted = "";
      if (!isNew) {
        const existingEdits = await getLibraryEdits();
        searchFormatted = (body.entry as WCTEdit).searchFormatted
          || existingEdits.wct[entryId]?.searchFormatted
          || "";
      }

      await upsertWCTEdit({ id: entryId, productType: productType!, productStyle: productStyle!, category: category!, text: text!, subtext: subtext!, searchFormatted, isNew: !!isNew });
      return NextResponse.json({ ok: true, id: entryId });
    }

    if (body.type === "pf") {
      const { id, phrase, icon, category, timeSensitive, filterByInterest, minPrice, maxPrice, searchPhrase, phraseId, productType, productStyle, typeStylePairs } = body.entry;

      if (!id && !phraseId) {
        // ── CREATE NEW PHRASE + applicabilities ───────────────────────────────
        if (!phrase?.trim()) return NextResponse.json({ error: "phrase required" }, { status: 400 });
        if (!category) return NextResponse.json({ error: "category required" }, { status: 400 });
        if (!typeStylePairs?.length) return NextResponse.json({ error: "at least one type/style required" }, { status: 400 });

        const newPhraseId = await createPhrase(
          phrase.trim(),
          icon ?? "",
          category as PFPhrase["category"],
          (timeSensitive ?? null) as PFPhrase["timeSensitive"],
          filterByInterest ?? false,
          typeStylePairs,
          minPrice ?? undefined,
          maxPrice ?? undefined
        );
        return NextResponse.json({ ok: true, phraseId: newPhraseId });
      }

      if (phraseId && !id) {
        // ── ADD APPLICABILITY to existing phrase ──────────────────────────────
        if (!productType) return NextResponse.json({ error: "productType required" }, { status: 400 });
        const appId = await addApplicability(phraseId, productType, productStyle ?? "ALL");
        return NextResponse.json({ ok: true, id: appId });
      }

      // ── EDIT EXISTING PHRASE definition ────────────────────────────────────
      // id here is a phraseId (from the phrase row)
      const resolvedPhraseId = id!;
      const found = await findPhraseForEntry(resolvedPhraseId);
      if (!found) return NextResponse.json({ error: "phrase not found" }, { status: 404 });

      const currentPhrase = found.phrase;
      const currentEdit = found.edit;

      await savePhraseEdit(resolvedPhraseId, {
        phrase: phrase ?? currentPhrase.phrase,
        icon: icon ?? currentEdit?.icon ?? currentPhrase.icon,
        searchPhrase: searchPhrase ?? currentEdit?.searchPhrase ?? currentPhrase.phrase,
        isNew: currentEdit?.isNew ?? false,
        ...(category !== undefined && { category }),
        ...(timeSensitive !== undefined && { timeSensitive }),
        ...(filterByInterest !== undefined && { filterByInterest }),
        ...(minPrice !== undefined && { minPrice }),
        ...(maxPrice !== undefined && { maxPrice }),
      });

      return NextResponse.json({ ok: true, id: resolvedPhraseId });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { type, id } = await req.json() as { type: "wct" | "pf-phrase" | "pf-applicability"; id: string };

  try {
    if (type === "wct") {
      await deleteWCTEdit(id);
    } else if (type === "pf-applicability") {
      await removeApplicability(id);
    } else if (type === "pf-phrase") {
      await deletePhrase(id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
