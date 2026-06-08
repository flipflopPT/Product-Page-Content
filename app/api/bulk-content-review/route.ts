import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProductsBatchWithMetafields } from "@/lib/metafields";
import { assignWhyChooseThis, assignPerfectFor } from "@/lib/assignment-engine";
import { generateProductSummary } from "@/lib/generate-summary";
import { getSettings } from "@/lib/settings-store";
import { getLibraryEdits } from "@/lib/library-edits-store";
import wctData from "@/data/why-choose-this.json";
import { getPfLibrary } from "@/lib/pf-store";
import type { WhyChooseThisEntry } from "@/lib/types";

const wctBase = wctData as WhyChooseThisEntry[];

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productIds, readOnly } = await req.json() as { productIds: string[]; readOnly?: boolean };

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return NextResponse.json({ error: "No products" }, { status: 400 });
  }

  const [pfLibrary, products, settings, libraryEdits] = await Promise.all([
    getPfLibrary(),
    getProductsBatchWithMetafields(productIds),
    readOnly ? Promise.resolve(null) : getSettings(),
    readOnly ? Promise.resolve(null) : getLibraryEdits(),
  ]);

  // Map phrase text → current icon so stale stored icons are corrected on display
  const pfIconByPhrase = new Map(pfLibrary.map((e) => [e.phrase, e.icon]));

  function syncedPfIcons(bullets: [string, string, string, string], storedIcons: [string | undefined, string | undefined, string | undefined, string | undefined]): [string, string, string, string] {
    return bullets.map((phrase, i) => pfIconByPhrase.get(phrase) ?? storedIcons[i] ?? "") as [string, string, string, string];
  }

  function storedRow(product: { id: string; title: string; featuredImage?: { url: string } | null }, metafields: Awaited<ReturnType<typeof getProductsBatchWithMetafields>>[number]["metafields"], source: "existing" | "needs-classify") {
    return {
      productId: product.id,
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
      pfIcons: syncedPfIcons(
        [metafields.perfectFor.bullet1, metafields.perfectFor.bullet2, metafields.perfectFor.bullet3, metafields.perfectFor.bullet4],
        [metafields.perfectFor.icon1, metafields.perfectFor.icon2, metafields.perfectFor.icon3, metafields.perfectFor.icon4]
      ),
      source,
      skip: source === "needs-classify",
      regenerating: false,
    };
  }

  const wctLibrary: WhyChooseThisEntry[] = readOnly ? [] : (() => {
    const wctEditsMap = libraryEdits!.wct;
    return [
      ...wctBase.map((e) => wctEditsMap[e.id] ? { ...e, text: wctEditsMap[e.id].text, subtext: wctEditsMap[e.id].subtext } : e),
      ...Object.values(wctEditsMap).filter((e) => e.isNew).map((e) => ({
        id: e.id, productType: e.productType, productStyle: e.productStyle,
        category: e.category as WhyChooseThisEntry["category"], text: e.text, subtext: e.subtext,
      })),
    ];
  })();

  const today = new Date();

  const rows = [];
  for (const { product, metafields } of products) {
    const productId = product.id;

    const hasSummary = !!metafields.productSummary;
    const hasWct = !!metafields.whyChooseThis.bullet1;
    const hasPf = !!metafields.perfectFor.bullet1;

    // Everything already populated — return as-is
    if (hasSummary && hasWct && hasPf) {
      rows.push(storedRow(product, metafields, "existing"));
      continue;
    }

    // In read-only mode just return whatever is stored, no generation
    if (readOnly) {
      rows.push(storedRow(product, metafields, "existing"));
      continue;
    }

    // Need type + style to generate any missing content
    const type   = metafields.productTypePt;
    const styles = metafields.productStylePt
      ? metafields.productStylePt.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    if (!type || styles.length === 0) {
      rows.push(storedRow(product, metafields, "needs-classify"));
      continue;
    }

    const ctx = {
      title: product.title,
      descriptionText: product.descriptionHtml.replace(/<[^>]+>/g, " ").trim(),
      productType: type,
      productStyles: styles,
    };

    const wct = hasWct ? null : assignWhyChooseThis(ctx, wctLibrary);
    const pf  = hasPf  ? null : assignPerfectFor(ctx, pfLibrary, settings!.dateRanges, today, undefined, undefined, settings!.interestKeywords);

    let summary = metafields.productSummary;
    let summaryError: { message: string; billingUrl?: string } | undefined;
    if (!hasSummary) {
      try {
        const summaryResult = await generateProductSummary({
          title: product.title,
          descriptionHtml: product.descriptionHtml,
          productType: type,
          productStyle: styles.join(", "),
        });
        if (!("error" in summaryResult)) {
          summary = summaryResult.options[0] ?? "";
        } else {
          summaryError = { message: summaryResult.error.message, billingUrl: summaryResult.error.billingUrl };
        }
      } catch { /* leave blank if AI fails */ }
    }

    rows.push({
      productId,
      title: product.title,
      imageUrl: product.featuredImage?.url ?? null,
      productTypePt: type,
      productStylePt: metafields.productStylePt,
      summary,
      summaryError,
      wctBullets: wct
        ? [wct.bullet1, wct.bullet2, wct.bullet3, wct.bullet4] as [string, string, string, string]
        : [metafields.whyChooseThis.bullet1, metafields.whyChooseThis.bullet2, metafields.whyChooseThis.bullet3, metafields.whyChooseThis.bullet4] as [string, string, string, string],
      pfBullets: pf
        ? [pf.bullets[0] ?? "", pf.bullets[1] ?? "", pf.bullets[2] ?? "", pf.bullets[3] ?? ""] as [string, string, string, string]
        : [metafields.perfectFor.bullet1, metafields.perfectFor.bullet2, metafields.perfectFor.bullet3, metafields.perfectFor.bullet4] as [string, string, string, string],
      pfIcons: pf
        ? [pf.icons[0] ?? "", pf.icons[1] ?? "", pf.icons[2] ?? "", pf.icons[3] ?? ""] as [string, string, string, string]
        : syncedPfIcons(
            [metafields.perfectFor.bullet1, metafields.perfectFor.bullet2, metafields.perfectFor.bullet3, metafields.perfectFor.bullet4],
            [metafields.perfectFor.icon1, metafields.perfectFor.icon2, metafields.perfectFor.icon3, metafields.perfectFor.icon4]
          ),
      source: "generated" as const,
      skip: false,
      regenerating: false,
    });
  }

  return NextResponse.json({ rows });
}
