import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setProductMetafields } from "@/lib/metafields";
import { getTaxonomy } from "@/lib/taxonomy-store";
import { assignSeasonalPhrases } from "@/lib/assignment-engine";
import { getPfLibrary } from "@/lib/pf-store";

interface AssignBody {
  productSummary: string;
  productTypePt: string;
  productStylesPt: string[];
  humanReviewed?: boolean;
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

  if (!body.perfectFor) {
    return NextResponse.json({ error: "perfectFor is required" }, { status: 400 });
  }

  const styles = body.productStylesPt ?? [];
  if (body.productTypePt && styles.length > 0) {
    const taxonomy = await getTaxonomy();
    const validStyles = taxonomy[body.productTypePt] ?? [];
    const invalid = styles.find((s) => !validStyles.includes(s));
    if (invalid) {
      return NextResponse.json(
        { error: `"${invalid}" is not a valid style for "${body.productTypePt}"` },
        { status: 400 }
      );
    }
  }

  try {
    const pfLibrary = await getPfLibrary();
    const ctx = { title: "", descriptionText: "", productType: body.productTypePt, productStyles: styles };
    const assignedBullets = [
      body.perfectFor.bullet1,
      body.perfectFor.bullet2,
      body.perfectFor.bullet3,
      body.perfectFor.bullet4,
    ].filter(Boolean);
    const seasonal = assignSeasonalPhrases(ctx, pfLibrary, undefined, assignedBullets);

    await setProductMetafields(productGid, {
      productSummary: body.productSummary,
      productTypePt: body.productTypePt,
      productStylePt: styles.join(","),
      ...(body.humanReviewed !== undefined && { humanReviewed: body.humanReviewed === true ? "true" : "false" }),
      seasonalOverrides: {
        mothersDay:    seasonal.mothersDay    ?? { phrase: "", icon: "" },
        fathersDay:    seasonal.fathersDay    ?? { phrase: "", icon: "" },
        valentinesDay: seasonal.valentinesDay ?? { phrase: "", icon: "" },
      },
      whyChooseThis: body.whyChooseThis,
      perfectFor: {
        bullet1: body.perfectFor.bullet1,
        bullet2: body.perfectFor.bullet2,
        bullet3: body.perfectFor.bullet3,
        bullet4: body.perfectFor.bullet4,
        icon1: body.perfectFor.icon1,
        icon2: body.perfectFor.icon2,
        icon3: body.perfectFor.icon3,
        icon4: body.perfectFor.icon4,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
