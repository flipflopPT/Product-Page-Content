import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { shopifyGraphQL } from "@/lib/shopify";
import type { ProductSummary } from "@/lib/types";

const LIST_PRODUCTS = `
  query ListProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          handle
          tags
          featuredImage { url }
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

type StatusValue = "complete" | "partial" | "missing";

function classifyStatus(node: { productTypePt: { value: string } | null; productStylePt: { value: string } | null }): StatusValue {
  const hasType  = !!node.productTypePt?.value;
  const hasStyle = !!node.productStylePt?.value;
  if (hasType && hasStyle) return "complete";
  if (hasType || hasStyle)  return "partial";
  return "missing";
}

function contentStatus(node: { productSummary: MF; wctBullet1: MF; pfBullet1: MF; seasonalMD: MF; seasonalFD: MF; seasonalVD: MF }): StatusValue {
  const summary = node.productSummary?.value ?? "";
  const wct = node.wctBullet1?.value ?? "";
  const pf = node.pfBullet1?.value ?? "";
  const seasonal = node.seasonalMD?.value === "true" || node.seasonalFD?.value === "true" || node.seasonalVD?.value === "true";
  if (summary && wct && pf) return "complete";
  if (summary || wct || pf || seasonal) return "partial";
  return "missing";
}

function matchesFilter(filter: string, cs: StatusValue, contentSt: StatusValue): boolean {
  if (!filter) return true;
  if (filter === "needs-classify")    return cs !== "complete";
  if (filter === "ready-to-populate") return cs === "complete" && contentSt !== "complete";
  if (filter === "complete")          return cs === "complete" && contentSt === "complete";
  // Legacy values used by the products page
  if (filter === "missing")     return cs === "missing" && contentSt === "missing";
  if (filter === "partial")     return (cs !== "missing" || contentSt !== "missing") && !(cs === "complete" && contentSt === "complete");
  if (filter === "has-content")      return contentSt !== "missing";
  if (filter === "content-partial")  return contentSt === "partial";
  if (filter === "content-complete") return contentSt === "complete";
  return true;
}

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { searchParams } = req.nextUrl;
  const cursor = searchParams.get("cursor") ?? undefined;
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const limitParam = parseInt(searchParams.get("limit") ?? "10", 10);
  const PAGE_SIZE = Math.min(Math.max(limitParam, 1), 100);

  const bestseller = searchParams.get("bestseller") === "true";
  const statusFilter = status;

  const queryParts: string[] = [];
  queryParts.push(`-tag:hidden`);
  if (search) queryParts.push(`title:*${search}*`);
  if (bestseller) queryParts.push(`tag:*bestseller*`);
  const query = queryParts.join(" AND ");

  type MF = { value: string } | null;
  type RawEdge = {
    node: {
      id: string; title: string; handle: string; tags: string[];
      featuredImage: { url: string } | null;
      productTypePt: MF; productStylePt: MF;
      productSummary: MF; wctBullet1: MF; pfBullet1: MF;
      seasonalMD: MF; seasonalFD: MF; seasonalVD: MF;
    };
    cursor: string;
  };

  // When filtering by status, Shopify can't filter by metafield value so we loop
  // through pages until we accumulate PAGE_SIZE matching products.
  // Each matched item tracks its cursor so the next request resumes from exactly
  // after the last returned product.
  const matched: Array<{ product: ProductSummary; cursor: string }> = [];
  let scanCursor: string | null = cursor || null;
  let hasMore = true;
  // When filtering, fetch 250 (Shopify's max) per call so we usually only need one round-trip.
  // Cap at 3 iterations to avoid serverless timeout (covers up to 750 products).
  const SHOPIFY_BATCH = statusFilter ? 250 : PAGE_SIZE;
  const MAX_ITERATIONS = statusFilter ? 10 : 1;
  let iterations = 0;

  while (matched.length < PAGE_SIZE && hasMore && iterations < MAX_ITERATIONS) {
    iterations++;
    const data = await shopifyGraphQL<{
      products: { edges: RawEdge[]; pageInfo: { hasNextPage: boolean } };
    }>(LIST_PRODUCTS, { first: SHOPIFY_BATCH, after: scanCursor, query });

    for (const edge of data.products.edges) {
      if (matched.length >= PAGE_SIZE) break;
      if (edge.node.tags.includes("hidden")) continue;
      const cs        = classifyStatus(edge.node);
      const contentSt = contentStatus(edge.node);
      if (!statusFilter || matchesFilter(statusFilter, cs, contentSt)) {
        matched.push({
          product: {
            id: edge.node.id,
            title: edge.node.title,
            handle: edge.node.handle,
            featuredImage: edge.node.featuredImage?.url ?? null,
            productTypePt: edge.node.productTypePt?.value ?? "",
            productStylePt: edge.node.productStylePt?.value ?? "",
            classifyStatus: cs,
            contentStatus: contentSt,
          },
          cursor: edge.cursor,
        });
      }
    }

    hasMore = data.products.pageInfo.hasNextPage;
    if (hasMore && data.products.edges.length > 0) {
      scanCursor = data.products.edges[data.products.edges.length - 1].cursor;
    }
  }

  const products = matched.map((e) => e.product);
  // Use the last returned product's cursor as the next page token so that
  // subsequent requests resume from exactly after where we stopped.
  const nextCursor = matched.length >= PAGE_SIZE ? matched[matched.length - 1].cursor : null;

  return NextResponse.json({ products, nextCursor });
}
