import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProductWithMetafields } from "@/lib/metafields";
import { assignWhyChooseThis, assignPerfectFor } from "@/lib/assignment-engine";
import { getSettings } from "@/lib/settings-store";
import { getPfLibrary } from "@/lib/pf-store";
import { getWctLibrary } from "@/lib/wct-store";

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productId, styles } = await req.json() as { productId: string; styles: string[] };

  if (!styles || styles.length === 0) {
    return NextResponse.json({ error: "No styles provided" }, { status: 400 });
  }

  const { product, metafields } = await getProductWithMetafields(productId);
  const type = metafields.productTypePt;

  if (!type) {
    return NextResponse.json({ error: "No product type set" }, { status: 400 });
  }

  const ctx = {
    title: product.title,
    descriptionText: product.descriptionHtml.replace(/<[^>]+>/g, " ").trim(),
    productType: type,
    productStyles: styles,
  };

  const [settings, pfLibrary, wctLibrary] = await Promise.all([getSettings(), getPfLibrary(), getWctLibrary()]);
  const today = new Date();

  const wct = assignWhyChooseThis(ctx, wctLibrary);
  const pf = assignPerfectFor(ctx, pfLibrary, settings.dateRanges, today, undefined, undefined, settings.interestKeywords);

  return NextResponse.json({
    wctBullets: [wct.bullet1, wct.bullet2, wct.bullet3, wct.bullet4] as [string, string, string, string],
    pfBullets: [
      pf.bullets[0] ?? "",
      pf.bullets[1] ?? "",
      pf.bullets[2] ?? "",
      pf.bullets[3] ?? "",
    ] as [string, string, string, string],
    pfIcons: [
      pf.icons[0] ?? "",
      pf.icons[1] ?? "",
      pf.icons[2] ?? "",
      pf.icons[3] ?? "",
    ] as [string, string, string, string],
  });
}
