import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setProductMetafields } from "@/lib/metafields";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";

interface Assignment {
  productId: string;
  type: string;
  styles: string[];
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { assignments } = await req.json() as { assignments: Assignment[] };

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return NextResponse.json({ error: "No assignments provided" }, { status: 400 });
  }

  let saved = 0;
  let failed = 0;
  const errors: { productId: string; message: string }[] = [];

  for (const { productId, type, styles } of assignments) {
    if (!(type in PRODUCT_TAXONOMY)) {
      failed++;
      errors.push({ productId, message: `Invalid type: "${type}"` });
      continue;
    }
    const validStyles = styles.filter((s) => (PRODUCT_TAXONOMY[type] ?? []).includes(s));
    if (validStyles.length === 0) {
      failed++;
      errors.push({ productId, message: `No valid styles for type "${type}"` });
      continue;
    }

    try {
      await setProductMetafields(productId, {
        productTypePt: type,
        productStylePt: validStyles.join(","),
        humanReviewed: "false",
      });
      saved++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : "Save failed";
      errors.push({ productId, message });
    }
  }

  return NextResponse.json({ saved, failed, errors });
}
