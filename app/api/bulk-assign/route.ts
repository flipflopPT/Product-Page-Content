import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getProductWithMetafields, setProductMetafields } from "@/lib/metafields";
import { assignWhyChooseThis, assignPerfectFor } from "@/lib/assignment-engine";
import { getSettings } from "@/lib/settings-store";
import { resolveIconForMetafield } from "@/lib/icons";
import { generateProductSummary } from "@/lib/generate-summary";
import wctData from "@/data/why-choose-this.json";
import pfData from "@/data/perfect-for.json";
import type { WhyChooseThisEntry, PerfectForEntry } from "@/lib/types";

const wctLibrary = wctData as WhyChooseThisEntry[];
const pfLibrary = pfData as PerfectForEntry[];

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productIds, skipComplete = false } = await req.json() as {
    productIds: string[];
    skipComplete?: boolean;
  };

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return new Response(JSON.stringify({ error: "No products selected" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const settings = await getSettings();
  const today = new Date();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let succeeded = 0;
      let skipped = 0;
      let failed = 0;

      for (const productGid of productIds) {
        try {
          const { product, metafields } = await getProductWithMetafields(productGid);

          const type = metafields.productTypePt;
          const styles = metafields.productStylePt
            ? metafields.productStylePt.split(",").map((s) => s.trim()).filter(Boolean)
            : [];

          if (!type || styles.length === 0) {
            skipped++;
            send({ type: "progress", productId: productGid, title: product.title, status: "skipped", message: "No type/style set" });
            continue;
          }

          if (skipComplete) {
            const isComplete =
              metafields.productSummary &&
              metafields.whyChooseThis.bullet1 &&
              metafields.perfectFor.bullet1;
            if (isComplete) {
              skipped++;
              send({ type: "progress", productId: productGid, title: product.title, status: "skipped", message: "Already complete" });
              continue;
            }
          }

          const ctx = {
            title: product.title,
            descriptionText: product.descriptionHtml.replace(/<[^>]+>/g, " ").trim(),
            productType: type,
            productStyles: styles,
          };

          const wct = assignWhyChooseThis(ctx, wctLibrary);
          const pf = assignPerfectFor(ctx, pfLibrary, settings.dateRanges, today);

          const summaryResult = await generateProductSummary({
            title: product.title,
            descriptionHtml: product.descriptionHtml,
            productType: type,
            productStyle: styles.join(", "),
          });
          const summaryText = "options" in summaryResult ? summaryResult.options[0] : undefined;
          const summaryStatus = summaryText ? "generated" : "failed";

          await setProductMetafields(productGid, {
            productTypePt: type,
            productStylePt: styles.join(","),
            whyChooseThis: wct,
            perfectFor: {
              bullet1: pf.bullets[0] ?? "",
              bullet2: pf.bullets[1] ?? "",
              bullet3: pf.bullets[2] ?? "",
              bullet4: pf.bullets[3] ?? "",
              icon1: resolveIconForMetafield(pf.icons[0] ?? ""),
              icon2: resolveIconForMetafield(pf.icons[1] ?? ""),
              icon3: resolveIconForMetafield(pf.icons[2] ?? ""),
              icon4: resolveIconForMetafield(pf.icons[3] ?? ""),
            },
            ...(summaryText ? { productSummary: summaryText } : {}),
          });

          succeeded++;
          send({ type: "progress", productId: productGid, title: product.title, status: "ok", summaryStatus });
        } catch (err) {
          failed++;
          const message = err instanceof Error ? err.message : "Unknown error";
          send({ type: "progress", productId: productGid, title: productGid, status: "error", message });
        }
      }

      send({ type: "done", total: productIds.length, succeeded, skipped, failed });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
