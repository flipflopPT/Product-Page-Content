import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setProductsMetafieldsBatch } from "@/lib/metafields";
import { assignSeasonalPhrases } from "@/lib/assignment-engine";
import { getPfLibrary } from "@/lib/pf-store";

interface ContentRowSave {
  productId: string;
  summary: string;
  wctBullets: [string, string, string, string];
  pfBullets: [string, string, string, string];
  pfIcons: [string, string, string, string];
  productTypePt?: string;
  productStylePt?: string;
  humanReviewed?: boolean;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { rows } = await req.json() as { rows: ContentRowSave[] };

  const pfLibrary = await getPfLibrary();

  const batchRows = rows.map((row) => {
    const seasonal = row.productTypePt !== undefined
      ? assignSeasonalPhrases(
          { title: "", descriptionText: "", productType: row.productTypePt, productStyles: row.productStylePt ? row.productStylePt.split(",").map((s) => s.trim()).filter(Boolean) : [] },
          pfLibrary
        )
      : null;

    return {
      productGid: row.productId,
      data: {
        ...(row.productTypePt !== undefined && { productTypePt: row.productTypePt }),
        ...(row.productStylePt !== undefined && { productStylePt: row.productStylePt }),
        ...(seasonal && {
          seasonalOverrides: {
            mothersDay:    seasonal.mothersDay    ?? { phrase: "", icon: "" },
            fathersDay:    seasonal.fathersDay    ?? { phrase: "", icon: "" },
            valentinesDay: seasonal.valentinesDay ?? { phrase: "", icon: "" },
          },
        }),
        humanReviewed: row.humanReviewed === true ? "true" : "false",
        productSummary: row.summary,
        whyChooseThis: {
          bullet1: row.wctBullets[0],
          bullet2: row.wctBullets[1],
          bullet3: row.wctBullets[2],
          bullet4: row.wctBullets[3],
        },
        perfectFor: {
          bullet1: row.pfBullets[0],
          bullet2: row.pfBullets[1],
          bullet3: row.pfBullets[2],
          bullet4: row.pfBullets[3],
          icon1: row.pfIcons[0],
          icon2: row.pfIcons[1],
          icon3: row.pfIcons[2],
          icon4: row.pfIcons[3],
        },
      },
    };
  });

  try {
    await setProductsMetafieldsBatch(batchRows);
    return NextResponse.json({ saved: rows.length, failed: 0 });
  } catch {
    return NextResponse.json({ saved: 0, failed: rows.length });
  }
}
