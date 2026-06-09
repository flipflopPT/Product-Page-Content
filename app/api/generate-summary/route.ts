import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProductWithMetafields } from "@/lib/metafields";
import { generateProductSummary } from "@/lib/generate-summary";

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productId } = await req.json() as { productId: string };

  const { product, metafields } = await getProductWithMetafields(productId);

  const type = metafields.productTypePt;
  const styles = metafields.productStylePt
    ? metafields.productStylePt.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  if (!type || styles.length === 0) {
    return NextResponse.json({ error: "No type/style set for this product" }, { status: 400 });
  }

  const result = await generateProductSummary({
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    productType: type,
    productStyle: styles.join(", "),
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  return NextResponse.json({ options: result.options });
}
