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

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productIds, readOnly } = await req.json() as { productIds: string[]; readOnly?: boolean };

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return NextResponse.json({ error: "No products" }, { status: 400 });
  }

  let pfLibrary: Awaited<ReturnType<typeof getPfLibrary>>;
  let products: Awaited<ReturnType<typeof getProductsBatchWithMetafields>>;
  let settings: Awaited<ReturnType<typeof getSettings>> | null;
  let libraryEdits: Awaited<ReturnType<typeof getLibraryEdits>> | null;

  try {
    [pfLibrary, products, settings, libraryEdits] = await Promise.all([
      getPfLibrary(),
      getProductsBatchWithMetafields(productIds),
      readOnly ? Promise.resolve(null) : getSettings(),
      readOnly ? Promise.resolve(null) : getLibraryEdits(),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to load data: ${message}` }, { status: 500 });
  }

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

  // First pass: build rows for products that don't need generation, and collect
  // summary inputs for those that do. WCT + PF are synchronous so computed here.
  type PendingRow = {
    productId: string;
    title: string;
    imageUrl: string | null;
    productTypePt: string;
    productStylePt: string | null;
    existingSummary: string | null;
    summaryInput: Parameters<typeof generateProductSummary>[0] | null;
    wctBullets: [string, string, string, string];
    pfBullets: [string, string, string, string];
    pfIcons: [string, string, string, string];
  };

  const settled: ReturnType<typeof storedRow>[] = [];
  const pending: PendingRow[] = [];

  for (const { product, metafields } of products) {
    const hasSummary = !!metafields.productSummary;
    const hasWct = !!metafields.whyChooseThis.bullet1;
    const hasPf = !!metafields.perfectFor.bullet1;

    if (hasSummary && hasWct && hasPf) {
      settled.push(storedRow(product, metafields, "existing"));
      continue;
    }

    if (readOnly) {
      settled.push(storedRow(product, metafields, "existing"));
      continue;
    }

    const type   = metafields.productTypePt;
    const styles = metafields.productStylePt
      ? metafields.productStylePt.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    if (!type || styles.length === 0) {
      settled.push(storedRow(product, metafields, "needs-classify"));
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

    pending.push({
      productId: product.id,
      title: product.title,
      imageUrl: product.featuredImage?.url ?? null,
      productTypePt: type,
      productStylePt: metafields.productStylePt,
      existingSummary: metafields.productSummary,
      summaryInput: hasSummary ? null : {
        title: product.title,
        descriptionHtml: product.descriptionHtml,
        productType: type,
        productStyle: styles.join(", "),
      },
      wctBullets: wct
        ? [wct.bullet1, wct.bullet2, wct.bullet3, wct.bullet4]
        : [metafields.whyChooseThis.bullet1, metafields.whyChooseThis.bullet2, metafields.whyChooseThis.bullet3, metafields.whyChooseThis.bullet4],
      pfBullets: pf
        ? [pf.bullets[0] ?? "", pf.bullets[1] ?? "", pf.bullets[2] ?? "", pf.bullets[3] ?? ""]
        : [metafields.perfectFor.bullet1, metafields.perfectFor.bullet2, metafields.perfectFor.bullet3, metafields.perfectFor.bullet4],
      pfIcons: pf
        ? [pf.icons[0] ?? "", pf.icons[1] ?? "", pf.icons[2] ?? "", pf.icons[3] ?? ""]
        : syncedPfIcons(
            [metafields.perfectFor.bullet1, metafields.perfectFor.bullet2, metafields.perfectFor.bullet3, metafields.perfectFor.bullet4],
            [metafields.perfectFor.icon1, metafields.perfectFor.icon2, metafields.perfectFor.icon3, metafields.perfectFor.icon4]
          ),
    });
  }

  // Generate summaries in batches of 3 to avoid Anthropic rate limits
  const BATCH_SIZE = 3;
  const summaryResults: Array<{ summary: string | null; summaryError?: { message: string; billingUrl?: string } }> = [];

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        if (!p.summaryInput) return { summary: p.existingSummary, summaryError: undefined };
        try {
          const result = await generateProductSummary(p.summaryInput);
          if (!("error" in result)) return { summary: result.options[0] ?? "", summaryError: undefined };
          return { summary: null, summaryError: { message: result.error.message, billingUrl: result.error.billingUrl } };
        } catch {
          return { summary: null, summaryError: undefined };
        }
      })
    );
    summaryResults.push(...batchResults);
  }

  // Second pass: assemble final rows
  const rows = [
    ...settled,
    ...pending.map((p, i) => ({
      productId: p.productId,
      title: p.title,
      imageUrl: p.imageUrl,
      productTypePt: p.productTypePt,
      productStylePt: p.productStylePt,
      summary: summaryResults[i].summary,
      summaryError: summaryResults[i].summaryError,
      wctBullets: p.wctBullets as [string, string, string, string],
      pfBullets: p.pfBullets as [string, string, string, string],
      pfIcons: p.pfIcons as [string, string, string, string],
      source: "generated" as const,
      skip: false,
      regenerating: false,
    })),
  ];

  return NextResponse.json({ rows });
}
