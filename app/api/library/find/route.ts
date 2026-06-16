import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { shopifyGraphQL } from "@/lib/shopify";
import { getLibraryEdits } from "@/lib/library-edits-store";
import { findPhraseForEntry } from "@/lib/pf-store";

const SCAN_QUERY = `
  query ScanProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id title
          typePt:  metafield(namespace: "product",         key: "product_type")  { value }
          stylePt: metafield(namespace: "product",         key: "product_style") { value }
          wct1:    metafield(namespace: "why-choose-this", key: "bullet_1")          { value }
          wct2:    metafield(namespace: "why-choose-this", key: "bullet_2")          { value }
          wct3:    metafield(namespace: "why-choose-this", key: "bullet_3")          { value }
          wct4:    metafield(namespace: "why-choose-this", key: "bullet_4")          { value }
          pf1:     metafield(namespace: "perfect-for",     key: "perfect_bullet_1") { value }
          pf2:     metafield(namespace: "perfect-for",     key: "perfect_bullet_2") { value }
          pf3:     metafield(namespace: "perfect-for",     key: "perfect_bullet_3") { value }
          pf4:     metafield(namespace: "perfect-for",     key: "perfect_bullet_4") { value }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

type MF = { value: string } | null;
type ScanNode = {
  id: string; title: string;
  typePt: MF; stylePt: MF;
  wct1: MF; wct2: MF; wct3: MF; wct4: MF;
  pf1: MF; pf2: MF; pf3: MF; pf4: MF;
};
type ScanResult = {
  products: { edges: { node: ScanNode; cursor: string }[]; pageInfo: { hasNextPage: boolean } };
};

function formatWCT(text: string, subtext: string) {
  return `<strong>${text}</strong> ${subtext}`;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const body = await req.json() as {
    type: "wct" | "pf" | "pf-scoped";
    id: string;
    // pf-scoped: find by raw phrase text, optionally filtered by type/style
    phraseText?: string;
    filterType?: string;
    filterStyle?: string;
    // Not-yet-committed edits being previewed — search using these as the
    // "new" value instead of whatever is currently saved in the library.
    pendingText?: string;
    pendingSubtext?: string;
    pendingPhrase?: string;
  };
  const { type, id, pendingText, pendingSubtext, pendingPhrase } = body;

  const edits = await getLibraryEdits();
  const matches: { id: string; title: string }[] = [];
  let cursor: string | null = null;

  if (type === "wct") {
    const wctEntry = edits.wct[id];

    if (!wctEntry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const entryProductType = wctEntry.productType;
    const entryProductStyle = wctEntry.productStyle;

    const newFormatted = formatWCT(pendingText ?? wctEntry.text, pendingSubtext ?? wctEntry.subtext);
    const oldFormatted = wctEntry.searchFormatted || newFormatted;

    // Only search for old text when it differs from new — products already on new text
    // are already up to date and would show as "0 updated" in the push step.
    const searchFor = oldFormatted !== newFormatted
      ? new Set([oldFormatted])
      : new Set([oldFormatted, newFormatted].filter(Boolean));

    while (true) {
      const data: ScanResult = await shopifyGraphQL<ScanResult>(SCAN_QUERY, { first: 250, after: cursor });

      for (const { node } of data.products.edges) {
        const productType = node.typePt?.value ?? "";
        const productStyle = node.stylePt?.value ?? "";
        if (productType !== entryProductType || !productStyle.split(",").map((s: string) => s.trim()).includes(entryProductStyle)) continue;

        const bullets = [node.wct1?.value ?? "", node.wct2?.value ?? "", node.wct3?.value ?? "", node.wct4?.value ?? ""];
        if (bullets.some((b) => searchFor.has(b))) {
          matches.push({ id: node.id, title: node.title });
        }
      }

      if (!data.products.pageInfo.hasNextPage) break;
      cursor = data.products.edges[data.products.edges.length - 1]?.cursor ?? null;
    }
  } else if (type === "pf-scoped") {
    // Find by raw phrase text, optionally filtered to a specific type/style
    const phraseText = body.phraseText;
    if (!phraseText) return NextResponse.json({ products: [] });
    const filterType = body.filterType;
    const filterStyle = body.filterStyle;

    while (true) {
      const data: ScanResult = await shopifyGraphQL<ScanResult>(SCAN_QUERY, { first: 250, after: cursor });

      for (const { node } of data.products.edges) {
        const nodeType = node.typePt?.value ?? "";
        const nodeStyle = node.stylePt?.value ?? "";
        if (filterType && nodeType !== filterType) continue;
        if (filterStyle && filterStyle !== "ALL") {
          if (!nodeStyle.split(",").map((s: string) => s.trim()).includes(filterStyle)) continue;
        }
        const bullets = [node.pf1?.value ?? "", node.pf2?.value ?? "", node.pf3?.value ?? "", node.pf4?.value ?? ""];
        if (bullets.some((b) => b === phraseText)) {
          matches.push({ id: node.id, title: node.title });
        }
      }

      if (!data.products.pageInfo.hasNextPage) break;
      cursor = data.products.edges[data.products.edges.length - 1]?.cursor ?? null;
    }
  } else {
    // PF: id is a phraseId — find all products that currently have this phrase text in their bullets
    const found = await findPhraseForEntry(id);
    if (!found) return NextResponse.json({ error: "Phrase not found" }, { status: 404 });

    const newPhrase = pendingPhrase ?? found.phrase.phrase;
    const oldPhrase = found.edit?.searchPhrase;
    // Only search for old text when it differs from new — products already on new text
    // are already up to date and would show as "0 updated" in the push step.
    const searchFor = (oldPhrase && oldPhrase !== newPhrase)
      ? new Set([oldPhrase])
      : new Set([newPhrase]);

    while (true) {
      const data: ScanResult = await shopifyGraphQL<ScanResult>(SCAN_QUERY, { first: 250, after: cursor });

      for (const { node } of data.products.edges) {
        const bullets = [node.pf1?.value ?? "", node.pf2?.value ?? "", node.pf3?.value ?? "", node.pf4?.value ?? ""];
        if (bullets.some((b) => searchFor.has(b))) {
          matches.push({ id: node.id, title: node.title });
        }
      }

      if (!data.products.pageInfo.hasNextPage) break;
      cursor = data.products.edges[data.products.edges.length - 1]?.cursor ?? null;
    }
  }

  return NextResponse.json({ products: matches });
}
