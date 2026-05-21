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
          featuredImage { url }
          productTypePt: metafield(namespace: "product", key: "product_type_pt") { value }
          productStylePt: metafield(namespace: "product", key: "product_style_pt") { value }
          productSummary: metafield(namespace: "product", key: "product_summary") { value }
          wctBullet1: metafield(namespace: "why-choose-this", key: "bullet_1") { value }
          pfBullet1: metafield(namespace: "perfect-for", key: "perfect_bullet_1") { value }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

function contentStatus(node: { productSummary: { value: string } | null; wctBullet1: { value: string } | null; pfBullet1: { value: string } | null }): ProductSummary["contentStatus"] {
  const summary = node.productSummary?.value ?? "";
  const wct = node.wctBullet1?.value ?? "";
  const pf = node.pfBullet1?.value ?? "";
  if (summary && wct && pf) return "complete";
  if (summary || wct || pf) return "partial";
  return "missing";
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

  const bestseller = status === "bestseller";
  const statusFilter = bestseller ? "" : status;

  const queryParts: string[] = [];
  if (search) queryParts.push(`title:*${search}*`);
  if (bestseller) queryParts.push(`tag:*bestseller*`);
  const query = queryParts.join(" AND ");

  type MF = { value: string } | null;
  type RawEdge = {
    node: {
      id: string; title: string; handle: string;
      featuredImage: { url: string } | null;
      productTypePt: MF; productStylePt: MF;
      productSummary: MF; wctBullet1: MF; pfBullet1: MF;
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
  const MAX_ITERATIONS = statusFilter ? 3 : 1;
  let iterations = 0;

  while (matched.length < PAGE_SIZE && hasMore && iterations < MAX_ITERATIONS) {
    iterations++;
    const data = await shopifyGraphQL<{
      products: { edges: RawEdge[]; pageInfo: { hasNextPage: boolean } };
    }>(LIST_PRODUCTS, { first: SHOPIFY_BATCH, after: scanCursor, query });

    for (const edge of data.products.edges) {
      if (matched.length >= PAGE_SIZE) break;
      const cs = contentStatus(edge.node);
      if (!statusFilter || cs === statusFilter) {
        matched.push({
          product: {
            id: edge.node.id,
            title: edge.node.title,
            handle: edge.node.handle,
            featuredImage: edge.node.featuredImage?.url ?? null,
            productTypePt: edge.node.productTypePt?.value ?? "",
            productStylePt: edge.node.productStylePt?.value ?? "",
            contentStatus: cs,
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
