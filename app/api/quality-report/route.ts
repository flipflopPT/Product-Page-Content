import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import type { QualityRow, QualityIssue } from "@/lib/content-quality-checks";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a content quality checker for Penelope Tom, a UK gift retailer. Evaluate product content for quality problems and respond only with valid JSON — no other text.`;

const BATCH_SIZE = 5;

interface AiBatchResult {
  productId: string;
  boringSummary: boolean;
  boringDetail: string | null;
  contextIssues: string[];
}

async function checkBatch(rows: QualityRow[]): Promise<AiBatchResult[]> {
  const productsList = rows
    .map((row, i) => {
      const pfList = row.pfBullets.filter((b) => b.trim()).join("; ");
      return `Product ${i + 1}:
ID: ${row.productId}
Title: ${row.title}
Type: ${row.productTypePt || "(not classified)"}
Summary: "${row.summary || "(no summary)"}"
Perfect For phrases: ${pfList || "(none)"}`;
    })
    .join("\n\n");

  const userMessage = `Evaluate the following products for content quality issues.

For each product check TWO things:

1. BORING_SUMMARY: Is the summary generic, AI-sounding, or template-like?
   Flag if it contains clichéd phrases like: "perfect gift", "sure to delight", "elevate your", "thoughtfully designed", "thoughtfully crafted", "timeless", "make a statement", "whether you're looking", "a must-have", "truly special", "ideal for", "without trying too hard", "loved by all". Also flag if the summary sounds vague and could apply to any product rather than this specific one, or if it reads like marketing filler rather than a genuine product description.

2. CONTEXT_MISMATCH: Does any content describe the product in a way that doesn't fit its product type?
   Examples of problems: wearing/outfit language (wear, worn, wearing) on products that aren't jewellery or bags; treating a Greetings Card as "the perfect gift" rather than a card to send alongside a gift; describing a practical household item as a gift in a way that sounds odd; content that clearly belongs to a different product category entirely.

Respond ONLY with a JSON array with exactly ${rows.length} entries in the same order as the input. No other text before or after the JSON:
[
  {
    "productId": "...",
    "boringSummary": false,
    "boringDetail": null,
    "contextIssues": []
  }
]

boringDetail: a very short phrase identifying the specific problem (e.g. "contains 'perfect gift'"), or null if no issue.
contextIssues: array of short descriptions of specific mismatches found, or empty array if none.

Products:

${productsList}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "[]";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return rows.map((r) => ({ productId: r.productId, boringSummary: false, boringDetail: null, contextIssues: [] }));

  try {
    return JSON.parse(jsonMatch[0]) as AiBatchResult[];
  } catch {
    return rows.map((r) => ({ productId: r.productId, boringSummary: false, boringDetail: null, contextIssues: [] }));
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Anthropic API key not configured", results: [] }, { status: 400 });
  }

  const body = await req.json() as { rows: Pick<QualityRow, "productId" | "title" | "productTypePt" | "summary" | "pfBullets">[] };
  const rows = body.rows ?? [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ results: [] });
  }

  const rowsWithContent = rows.filter((r) => r.summary.trim());
  const results: { productId: string; issues: QualityIssue[] }[] = [];

  for (let i = 0; i < rowsWithContent.length; i += BATCH_SIZE) {
    const batch = rowsWithContent.slice(i, i + BATCH_SIZE);
    try {
      const batchResults = await checkBatch(batch);
      for (const result of batchResults) {
        const issues: QualityIssue[] = [];
        if (result.boringSummary) {
          issues.push({
            checkId: "boring-summary",
            label: "AI summary",
            detail: result.boringDetail ?? "Summary sounds generic or AI-generated",
            severity: "warning",
          });
        }
        for (const contextIssue of result.contextIssues) {
          issues.push({
            checkId: "context-mismatch",
            label: "Context mismatch",
            detail: contextIssue,
            severity: "warning",
          });
        }
        if (issues.length > 0) {
          results.push({ productId: result.productId, issues });
        }
      }
    } catch (err: unknown) {
      const e = err as { status?: number; error?: { type?: string } };
      if (e?.status === 402 || e?.error?.type === "credit_balance_too_low") {
        return NextResponse.json({ results, creditsExhausted: true, error: "Your Anthropic account has run out of credits." });
      }
      if (e?.status === 429) {
        return NextResponse.json({ results, error: "Rate limited — partial results returned." });
      }
      console.error("AI quality batch failed:", err);
    }
  }

  return NextResponse.json({ results });
}
