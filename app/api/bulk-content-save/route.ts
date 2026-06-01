import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { setProductMetafields } from "@/lib/metafields";

interface ContentRowSave {
  productId: string;
  summary: string;
  wctBullets: [string, string, string, string];
  pfBullets: [string, string, string, string];
  pfIcons: [string, string, string, string];
  productTypePt?: string;
  productStylePt?: string;
  seasonalOverrides?: { mothersDay: boolean; fathersDay: boolean; valentinesDay: boolean };
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { rows } = await req.json() as { rows: ContentRowSave[] };

  let saved = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await setProductMetafields(row.productId, {
        ...(row.productTypePt !== undefined && { productTypePt: row.productTypePt }),
        ...(row.productStylePt !== undefined && { productStylePt: row.productStylePt }),
        ...(row.seasonalOverrides !== undefined && { seasonalOverrides: row.seasonalOverrides }),
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
      });
      saved++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ saved, failed });
}
