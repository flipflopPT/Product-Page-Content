import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";
import type { QualityRow, QualityIssue } from "@/lib/content-quality-checks";
import { isCreditsExhaustedError } from "@/lib/anthropic-errors";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a content quality checker for Penelope Tom, a UK gift retailer. Evaluate product content for quality problems and respond only with valid JSON — no other text.`;

const BATCH_SIZE = 5;

interface AiBatchResult {
  productId: string;
  boringSummary: boolean;
  boringDetail: string | null;
  contextIssues: string[];
}

async function checkBatch(rows: Pick<QualityRow, "productId" | "title" | "productTypePt" | "summary" | "wctBullets" | "pfBullets">[]): Promise<AiBatchResult[]> {
  const productsList = rows
    .map((row, i) => {
      const wctList = row.wctBullets.map((b) => b.replace(/<[^>]+>/g, " ").trim()).filter(Boolean).join("; ");
      const pfList = row.pfBullets.filter((b) => b.trim()).join("; ");
      return `Product ${i + 1}:
ID: ${row.productId}
Title: ${row.title}
Type: ${row.productTypePt || "(not classified)"}
Summary: "${row.summary || "(no summary)"}"
Why Choose This bullets: ${wctList || "(none)"}
Perfect For phrases: ${pfList || "(none)"}`;
    })
    .join("\n\n");

  const userMessage = `Evaluate the following products for content quality issues.

For each product check TWO things:

1. BORING_SUMMARY: Is the summary generic, AI-sounding, unnatural, or awkwardly phrased?
   Flag if ANY of the following apply:
   - Vague and could apply to any product rather than this specific one
   - Reads like marketing filler rather than a genuine product description
   - Contains an odd turn of phrase, clunky construction, or forced word order that no human copywriter would naturally write
   - Uses stilted or unnatural-sounding language — phrasing that feels assembled rather than written
   - Combines words or ideas in a way that sounds slightly off even if technically correct
   Be specific in boringDetail: name the exact phrase or construction that sounds wrong (e.g. "odd phrasing: 'renders it uniquely personal'").

2. CONTEXT_MISMATCH: Does any content field (summary, Why Choose This bullets, or Perfect For phrases) use language or assign phrases that would only make sense for a different product type, target audience, or use context?
   Flag if content feels like it belongs to a different product.
   NOTE: "Why Choose This" bullets are reusable library entries intentionally shared across many products of the same type — do NOT flag them for being identical or repetitive across products. Only flag a WCT bullet if it is genuinely wrong for this specific product type (e.g. uses wearable language for a non-wearable product).

Respond ONLY with a JSON array with exactly ${rows.length} entries in the same order as the input. No other text before or after the JSON:
[
  {
    "productId": "...",
    "boringSummary": false,
    "boringDetail": null,
    "contextIssues": []
  }
]

boringDetail: a very short phrase identifying the specific problem (e.g. "odd phrasing: 'renders it uniquely personal'"), or null if no issue.
contextIssues: array of short descriptions of specific mismatches found, or empty array if none.

Products:

${productsList}`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1600,
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

  const body = await req.json() as { rows: Pick<QualityRow, "productId" | "title" | "productTypePt" | "summary" | "wctBullets" | "pfBullets">[] };
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
      if (isCreditsExhaustedError(err)) {
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
