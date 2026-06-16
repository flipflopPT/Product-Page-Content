import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getTaxonomy, saveTaxonomy } from "@/lib/taxonomy-store";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  try {
    const taxonomy = await getTaxonomy();
    return NextResponse.json({ taxonomy });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? "Failed to load taxonomy" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  const { taxonomy } = await req.json() as { taxonomy: Record<string, string[]> };
  try {
    await saveTaxonomy(taxonomy);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? "Failed to save" }, { status: 500 });
  }
}
