import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { shopifyGraphQL } from "@/lib/shopify";

const COUNT_PRODUCTS = `
  query CountProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          tags
          productTypePt: metafield(namespace: "product", key: "product_type_pt") { value }
          productStylePt: metafield(namespace: "product", key: "product_style_pt") { value }
          productSummary: metafield(namespace: "product", key: "product_summary") { value }
          wctBullet1: metafield(namespace: "why-choose-this", key: "bullet_1") { value }
          pfBullet1: metafield(namespace: "perfect-for", key: "perfect_bullet_1") { value }
          seasonalMD: metafield(namespace: "seasonal-override", key: "mothers_day") { value }
          seasonalFD: metafield(namespace: "seasonal-override", key: "fathers_day") { value }
          seasonalVD: metafield(namespace: "seasonal-override", key: "valentines_day") { value }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

type MF = { value: string } | null;
type RawNode = { tags: string[]; productTypePt: MF; productStylePt: MF; productSummary: MF; wctBullet1: MF; pfBullet1: MF; seasonalMD: MF; seasonalFD: MF; seasonalVD: MF };

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
  const seasonal = node.seasonalMD?.value === "true" || node.seasonalFD?.value === "true" || node.seasonalVD?.value === "true";
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

  const bestseller   = searchParams.get("bestseller") === "true";
  const statusFilter = status;

  const queryParts = ["-tag:hidden"];
  if (search) queryParts.push(`title:*${search}*`);
  if (bestseller) queryParts.push(`tag:*bestseller*`);
  const query = queryParts.join(" AND ");

  let count = 0;
  let cursor: string | null = null;
  let hasMore = true;
  const MAX_ITERATIONS = 10;
  let iterations = 0;

  while (hasMore && iterations < MAX_ITERATIONS) {
    iterations++;
    const data = await shopifyGraphQL<{
      products: { edges: { node: RawNode; cursor: string }[]; pageInfo: { hasNextPage: boolean } };
    }>(COUNT_PRODUCTS, { first: 250, after: cursor, query });

    for (const edge of data.products.edges) {
      if (edge.node.tags.includes("hidden")) continue;
      const cs        = classifyStatus(edge.node);
      const contentSt = contentStatus(edge.node);
      if (!statusFilter || matchesFilter(statusFilter, cs, contentSt)) {
        count++;
      }
    }

    hasMore = data.products.pageInfo.hasNextPage;
    if (hasMore && data.products.edges.length > 0) {
      cursor = data.products.edges[data.products.edges.length - 1].cursor;
    }
  }

  return NextResponse.json({ count });
}
