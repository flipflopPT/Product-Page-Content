import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProductWithMetafields } from "@/lib/metafields";

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productIds } = await req.json() as { productIds: string[] };

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return NextResponse.json({ error: "No products" }, { status: 400 });
  }

  const results = await Promise.all(
    productIds.map(async (productId) => {
      try {
        const { product, metafields } = await getProductWithMetafields(productId);
        return {
          productId,
          title: product.title,
          imageUrl: product.featuredImage?.url ?? null,
          productTypePt: metafields.productTypePt,
          productStylePt: metafields.productStylePt,
          summary: metafields.productSummary,
          wctBullets: [
            metafields.whyChooseThis.bullet1,
            metafields.whyChooseThis.bullet2,
            metafields.whyChooseThis.bullet3,
            metafields.whyChooseThis.bullet4,
          ] as [string, string, string, string],
          pfBullets: [
            metafields.perfectFor.bullet1,
            metafields.perfectFor.bullet2,
            metafields.perfectFor.bullet3,
            metafields.perfectFor.bullet4,
          ] as [string, string, string, string],
          pfIcons: [
            metafields.perfectFor.icon1,
            metafields.perfectFor.icon2,
            metafields.perfectFor.icon3,
            metafields.perfectFor.icon4,
          ] as [string, string, string, string],
          seasonalOverrides: metafields.seasonalOverrides,
          skip: false,
          regenerating: false,
        };
      } catch {
        return null;
      }
    })
  );

  const rows = results.filter((r): r is NonNullable<typeof r> => r !== null);
  return NextResponse.json({ rows });
}
