import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { shopifyGraphQL } from "@/lib/shopify";

const COUNT_PRODUCTS = `
  query CountProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          tags
          productTypePt: metafield(namespace: "product", key: "product_type") { value }
          productStylePt: metafield(namespace: "product", key: "product_style") { value }
          productSummary: metafield(namespace: "product", key: "product_summary") { value }
          humanReviewed: metafield(namespace: "product", key: "approved") { value }
          wctBullet1: metafield(namespace: "why-choose-this", key: "bullet_1") { value }
          pfBullet1: metafield(namespace: "perfect-for", key: "perfect_bullet_1") { value }
          seasonalMdPhrase: metafield(namespace: "seasonal", key: "mothers_day_phrase")    { value }
          seasonalFdPhrase: metafield(namespace: "seasonal", key: "fathers_day_phrase")    { value }
          seasonalVdPhrase: metafield(namespace: "seasonal", key: "valentines_day_phrase") { value }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

type MF = { value: string } | null;
type RawNode = { tags: string[]; productTypePt: MF; productStylePt: MF; humanReviewed: MF; productSummary: MF; wctBullet1: MF; pfBullet1: MF; seasonalMdPhrase: MF; seasonalFdPhrase: MF; seasonalVdPhrase: MF };
type CountResult = { products: { edges: { node: RawNode; cursor: string }[]; pageInfo: { hasNextPage: boolean } } };

function classifyStatus(node: RawNode) {
  const hasType  = !!node.productTypePt?.value;
  const hasStyle = !!node.productStylePt?.value;
  if (hasType && hasStyle) return "complete";
  if (hasType || hasStyle) return "partial";
  return "missing";
}

function contentStatus(node: RawNode) {
  const summary  = node.productSummary?.value ?? "";
  const wct      = node.wctBullet1?.value ?? "";
  const pf       = node.pfBullet1?.value ?? "";
  const seasonal = !!(node.seasonalMdPhrase?.value || node.seasonalFdPhrase?.value || node.seasonalVdPhrase?.value);
  if (summary && wct && pf) return "complete";
  if (summary || wct || pf || seasonal) return "partial";
  return "missing";
}

function matchesFilter(filter: string, cs: string, contentSt: string): boolean {
  if (!filter) return true;
  if (filter === "needs-classify")    return cs !== "complete";
  if (filter === "ready-to-populate") return cs === "complete" && contentSt !== "complete";
  if (filter === "complete")          return cs === "complete" && contentSt === "complete";
  if (filter === "missing")           return cs === "missing" && contentSt === "missing";
  if (filter === "partial")           return (cs !== "missing" || contentSt !== "missing") && !(cs === "complete" && contentSt === "complete");
  if (filter === "has-content")      return contentSt !== "missing";
  if (filter === "content-partial")  return contentSt === "partial";
  if (filter === "content-complete") return contentSt === "complete";
  return true;
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const typeFilter  = searchParams.get("type")  ?? "";
  const styleFilter = searchParams.get("style") ?? "";

  const bestseller     = searchParams.get("bestseller") === "true";
  const christmas      = searchParams.get("christmas") === "true";
  const reviewedFilter = searchParams.get("reviewed") ?? "";
  const statusFilter   = status;

  const queryParts = ["-status:archived", "-tag:hidden", christmas ? "tag:christmas" : "-tag:christmas"];
  if (search) queryParts.push(`title:*${search}*`);
  if (bestseller) queryParts.push(`tag:*bestseller*`);
  const query = queryParts.join(" AND ");

  let count = 0;
  let cursor: string | null = null;
  let hasMore = true;
  const MAX_ITERATIONS = 10;
  let iterations = 0;

  try {
    while (hasMore && iterations < MAX_ITERATIONS) {
      iterations++;
      const data: CountResult = await shopifyGraphQL<CountResult>(COUNT_PRODUCTS, { first: 250, after: cursor, query });

      for (const edge of data.products.edges) {
        if (edge.node.tags.includes("hidden")) continue;
        const isChristmas = edge.node.tags.some((t: string) => t.toLowerCase() === "christmas");
        if (christmas !== isChristmas) continue;
        const cs        = classifyStatus(edge.node);
        const contentSt = contentStatus(edge.node);
        if (typeFilter && (edge.node.productTypePt?.value ?? "") !== typeFilter) continue;
        if (styleFilter) {
          const styles = (edge.node.productStylePt?.value ?? "").split(",").map((s: string) => s.trim());
          if (!styles.includes(styleFilter)) continue;
        }
        const isHumanReviewed = (edge.node.humanReviewed?.value ?? "") === "true";
        if (reviewedFilter === "true"  && !isHumanReviewed) continue;
        if (reviewedFilter === "false" && isHumanReviewed) continue;
        if (!statusFilter || matchesFilter(statusFilter, cs, contentSt)) {
          count++;
        }
      }

      hasMore = data.products.pageInfo.hasNextPage;
      if (hasMore && data.products.edges.length > 0) {
        cursor = data.products.edges[data.products.edges.length - 1].cursor;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to count products: ${message}` }, { status: 502 });
  }

  return NextResponse.json({ count });
}
