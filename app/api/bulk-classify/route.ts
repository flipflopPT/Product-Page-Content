import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";
import { getProductWithMetafields } from "@/lib/metafields";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";

const SYSTEM_PROMPT = `You are a product taxonomy classifier for Penelope Tom (PT), a UK gift retailer.
Choose exactly one Type and 1–2 Styles from the taxonomy below.

TAXONOMY:
Bags & Purses: Elegant, Personalised, Practical, Bold/Colourful
Home: Bold/Colourful, Classic/Timeless, Earthy/Natural, Minimal, Playful, EcoFriendly
Women's Jewellery: Dainty, Minimal, Personalised, Statement
Children's Jewellery: Dainty, Minimal, Personalised
Men's Jewellery & Accessories: Classic, Modern, Personalised
Children: Classic/Timeless, Playful, Creative
Books & Stationery: Illustrated, Inspirational, Practical
Personalised Accessories: Classic, Novelty
Candles / Diffusers: Novelty, Premium
Greetings Cards: Nature, Novelty/Humorous
Fairy Lights: Minimal, Decorative, Colourful
Furniture & Lighting: Minimal, Scandi, Statement, Contemporary Classic
Christmas Themed Products: Traditional, Minimal, Novelty

RULES:
1. Type MUST be an exact string from the list above.
2. Styles MUST come from that Type's valid styles only.
3. Choose 1 Style (2 only if the product genuinely exhibits both).
4. Return ONLY valid JSON — no prose, no markdown.
5. Format: {"type": "...", "styles": ["..."]}`;

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 800);
}

async function classifyProduct(
  client: Anthropic,
  gid: string
): Promise<{
  title: string;
  imageUrl: string | null;
  existingType: string;
  existingStyle: string;
  suggestedType: string;
  suggestedStyles: string[];
  error?: string;
}> {
  const { product, metafields } = await getProductWithMetafields(gid);
  const imageUrl = product.featuredImage?.url ?? null;
  const description = stripHtml(product.descriptionHtml);

  const userMessage = `Product title: ${product.title}
Product description: ${description || "(no description available)"}

Classify this product.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text.trim() : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as { type?: string; styles?: string[] };

    const rawType = typeof parsed.type === "string" ? parsed.type : "";
    const rawStyles = Array.isArray(parsed.styles) ? parsed.styles.filter((s) => typeof s === "string") : [];

    const validType = rawType in PRODUCT_TAXONOMY ? rawType : "";
    const validStyles = validType
      ? rawStyles.filter((s) => (PRODUCT_TAXONOMY[validType] ?? []).includes(s))
      : [];

    return {
      title: product.title,
      imageUrl,
      existingType: metafields.productTypePt,
      existingStyle: metafields.productStylePt,
      suggestedType: validType,
      suggestedStyles: validStyles,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Classification failed";
    return {
      title: product.title,
      imageUrl,
      existingType: metafields.productTypePt,
      existingStyle: metafields.productStylePt,
      suggestedType: "",
      suggestedStyles: [],
      error: message,
    };
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { productIds } = await req.json() as { productIds: string[] };

  if (!Array.isArray(productIds) || productIds.length === 0) {
    return new Response(JSON.stringify({ error: "No products selected" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        for (const productId of productIds) {
          send({ type: "result", productId, title: productId, suggestedType: "", suggestedStyles: [],
            existingType: "", existingStyle: "", error: "ANTHROPIC_API_KEY is not configured" });
        }
        send({ type: "done", total: productIds.length, succeeded: 0, failed: productIds.length });
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      let succeeded = 0;
      let failed = 0;

      for (const productId of productIds) {
        try {
          const result = await classifyProduct(client, productId);
          if (result.error) {
            failed++;
          } else {
            succeeded++;
          }
          send({ type: "result", productId, ...result });
        } catch (err) {
          failed++;
          const message = err instanceof Error ? err.message : "Failed to fetch product";
          send({ type: "result", productId, title: productId, imageUrl: null, suggestedType: "", suggestedStyles: [],
            existingType: "", existingStyle: "", error: message });
        }
      }

      send({ type: "done", total: productIds.length, succeeded, failed });
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
