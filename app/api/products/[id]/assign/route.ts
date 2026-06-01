import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setProductMetafields } from "@/lib/metafields";
import { isValidCombination } from "@/data/taxonomy";
import { resolveIconForMetafield } from "@/lib/icons";

interface AssignBody {
  productSummary: string;
  productTypePt: string;
  productStylesPt: string[];
  seasonalOverrides?: { mothersDay: boolean; fathersDay: boolean; valentinesDay: boolean };
  whyChooseThis: { bullet1: string; bullet2: string; bullet3: string; bullet4: string };
  perfectFor: {
    bullet1: string; bullet2: string; bullet3: string; bullet4: string;
    icon1: string; icon2: string; icon3: string; icon4: string;
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { id } = await params;
  const productGid = `gid://shopify/Product/${id}`;

  const body = (await req.json()) as AssignBody;

  const styles = body.productStylesPt ?? [];
  if (body.productTypePt && styles.length > 0) {
    const invalid = styles.find((s) => !isValidCombination(body.productTypePt, s));
    if (invalid) {
      return NextResponse.json(
        { error: `"${invalid}" is not a valid style for "${body.productTypePt}"` },
        { status: 400 }
      );
    }
  }

  try {
    await setProductMetafields(productGid, {
      productSummary: body.productSummary,
      productTypePt: body.productTypePt,
      productStylePt: styles.join(","),
      ...(body.seasonalOverrides !== undefined && { seasonalOverrides: body.seasonalOverrides }),
      whyChooseThis: body.whyChooseThis,
      perfectFor: {
        bullet1: body.perfectFor.bullet1,
        bullet2: body.perfectFor.bullet2,
        bullet3: body.perfectFor.bullet3,
        bullet4: body.perfectFor.bullet4,
        icon1: resolveIconForMetafield(body.perfectFor.icon1),
        icon2: resolveIconForMetafield(body.perfectFor.icon2),
        icon3: resolveIconForMetafield(body.perfectFor.icon3),
        icon4: resolveIconForMetafield(body.perfectFor.icon4),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
