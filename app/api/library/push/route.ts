import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { shopifyGraphQL } from "@/lib/shopify";
import { setProductMetafields } from "@/lib/metafields";
import { getLibraryEdits, upsertWCTEdit, upsertPFPhraseEdit } from "@/lib/library-edits-store";
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
          pfIcon1: metafield(namespace: "perfect-for",     key: "icon_1") { value }
          pfIcon2: metafield(namespace: "perfect-for",     key: "icon_2") { value }
          pfIcon3: metafield(namespace: "perfect-for",     key: "icon_3") { value }
          pfIcon4: metafield(namespace: "perfect-for",     key: "icon_4") { value }
        }
        cursor
      }
      pageInfo { hasNextPage }
    }
  }
`;

const NODES_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
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
        pfIcon1: metafield(namespace: "perfect-for",     key: "icon_1") { value }
        pfIcon2: metafield(namespace: "perfect-for",     key: "icon_2") { value }
        pfIcon3: metafield(namespace: "perfect-for",     key: "icon_3") { value }
        pfIcon4: metafield(namespace: "perfect-for",     key: "icon_4") { value }
      }
    }
  }
`;

type MF = { value: string } | null;
type ScanNode = {
  id: string; title: string;
  typePt: MF; stylePt: MF;
  wct1: MF; wct2: MF; wct3: MF; wct4: MF;
  pf1: MF; pf2: MF; pf3: MF; pf4: MF;
  pfIcon1: MF; pfIcon2: MF; pfIcon3: MF; pfIcon4: MF;
};
type ScanResult = {
  products: { edges: { node: ScanNode; cursor: string }[]; pageInfo: { hasNextPage: boolean } };
};
type NodesResult = { nodes: (ScanNode | null)[] };

function formatWCT(text: string, subtext: string) {
  return `<strong>${text}</strong> ${subtext}`;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { type, id, retryIds, revertIds, revertIcons, pendingText, pendingSubtext, pendingPhrase, pendingIcon, pendingCategory, pendingTimeSensitive, pendingFilterByInterest, pendingMinPrice, pendingMaxPrice } = await req.json() as {
    type: "wct" | "pf";
    id: string;
    retryIds?: string[];
    revertIds?: string[];
    revertIcons?: Record<string, string>;
    // Not-yet-committed edits — the entry/phrase isn't saved to the library until
    // this push completes cleanly (or the user explicitly skips updating products).
    pendingText?: string;
    pendingSubtext?: string;
    pendingPhrase?: string;
    pendingIcon?: string;
    pendingCategory?: string;
    pendingTimeSensitive?: string | null;
    pendingFilterByInterest?: boolean;
    pendingMinPrice?: number | null;
    pendingMaxPrice?: number | null;
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      async function fetchNodes(ids: string[]): Promise<ScanNode[]> {
        const data = await shopifyGraphQL<NodesResult>(NODES_QUERY, { ids });
        return data.nodes.filter((n): n is ScanNode => n !== null);
      }

      async function* scanAll(): AsyncGenerator<ScanNode> {
        let cursor: string | null = null;
        while (true) {
          const data: ScanResult = await shopifyGraphQL<ScanResult>(SCAN_QUERY, { first: 250, after: cursor });
          for (const { node } of data.products.edges) yield node;
          if (!data.products.pageInfo.hasNextPage) break;
          cursor = data.products.edges[data.products.edges.length - 1]?.cursor ?? null;
        }
      }

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      if (type === "wct") {
        const edits = await getLibraryEdits();
        const wctEntry = edits.wct[id];
        if (!wctEntry) {
          send({ type: "done", total: 0, updated: 0, skipped: 0, failed: 0 });
          controller.close();
          return;
        }

        const effectiveText = pendingText ?? wctEntry.text;
        const effectiveSubtext = pendingSubtext ?? wctEntry.subtext;
        const newFormatted = formatWCT(effectiveText, effectiveSubtext);
        const oldFormatted = wctEntry.searchFormatted || newFormatted;
        // Revert pushes oldFormatted back onto the given ids; otherwise old -> new.
        const [fromFormatted, toFormatted] = revertIds ? [newFormatted, oldFormatted] : [oldFormatted, newFormatted];

        const nodes = revertIds ? await fetchNodes(revertIds) : retryIds ? await fetchNodes(retryIds) : scanAll();

        for await (const node of nodes) {
          const productType = node.typePt?.value ?? "";
          const productStyle = node.stylePt?.value ?? "";

          if (!retryIds && !revertIds && (productType !== wctEntry.productType || !productStyle.split(",").map((s: string) => s.trim()).includes(wctEntry.productStyle))) {
            skipped++;
            continue;
          }

          const bullets = [
            node.wct1?.value ?? "", node.wct2?.value ?? "",
            node.wct3?.value ?? "", node.wct4?.value ?? "",
          ];

          const hasMatch = bullets.some((b) => b === fromFormatted);
          if (!hasMatch) { skipped++; continue; }

          try {
            const newBullets = bullets.map((b) => b === fromFormatted ? toFormatted : b);
            await setProductMetafields(node.id, {
              whyChooseThis: {
                bullet1: newBullets[0], bullet2: newBullets[1],
                bullet3: newBullets[2], bullet4: newBullets[3],
              },
            });
            updated++;
            send({ type: "progress", id: node.id, title: node.title, status: "updated" });
          } catch {
            failed++;
            send({ type: "progress", id: node.id, title: node.title, status: "error" });
          }
        }

        // Only commit the entry (new text/subtext + the "pushed" marker) once
        // this run is fully clean — a partial failure must leave both pointing
        // at the old value so a future Check Usage still finds the unfinished
        // products, and the edit modal's "Save" never actually persisted the
        // change ahead of the cascade. Never commit on revert. Note: gated on
        // failed===0 alone (not updated>0) — a retry batch that finds every
        // target already correct (updated===0, failed===0) still means nothing
        // is left outstanding, and should still commit rather than getting
        // stuck "unpushed" forever.
        if (!revertIds && failed === 0) {
          await upsertWCTEdit({ ...wctEntry, text: effectiveText, subtext: effectiveSubtext, searchFormatted: newFormatted });
        }

      } else {
        // PF: id is a phraseId
        const found = await findPhraseForEntry(id);
        if (!found || !found.edit?.searchPhrase) {
          send({ type: "done", total: 0, updated: 0, skipped: 0, failed: 0 });
          controller.close();
          return;
        }

        const oldPhrase = found.edit.searchPhrase;
        const newPhrase = pendingPhrase ?? found.phrase.phrase;
        const newIcon = pendingIcon ?? found.edit?.icon ?? found.phrase.icon;
        const [fromPhrase, toPhrase] = revertIds ? [newPhrase, oldPhrase] : [oldPhrase, newPhrase];

        const nodes = revertIds ? await fetchNodes(revertIds) : retryIds ? await fetchNodes(retryIds) : scanAll();

        for await (const node of nodes) {
          const bullets = [
            node.pf1?.value ?? "", node.pf2?.value ?? "",
            node.pf3?.value ?? "", node.pf4?.value ?? "",
          ];

          const hasMatch = bullets.some((b) => b === fromPhrase);
          if (!hasMatch) { skipped++; continue; }

          try {
            const icons = [
              node.pfIcon1?.value ?? "", node.pfIcon2?.value ?? "",
              node.pfIcon3?.value ?? "", node.pfIcon4?.value ?? "",
            ];
            const matchedIndex = bullets.findIndex((b) => b === fromPhrase);
            const originalIcon = matchedIndex >= 0 ? icons[matchedIndex] : undefined;
            const newBullets = bullets.map((b) => b === fromPhrase ? toPhrase : b);
            const newIcons = bullets.map((b, i) => {
              if (b !== fromPhrase) return icons[i];
              return revertIds ? (revertIcons?.[node.id] ?? icons[i]) : newIcon;
            });
            await setProductMetafields(node.id, {
              perfectFor: {
                bullet1: newBullets[0], bullet2: newBullets[1],
                bullet3: newBullets[2], bullet4: newBullets[3],
                icon1: newIcons[0], icon2: newIcons[1],
                icon3: newIcons[2], icon4: newIcons[3],
              },
            });
            updated++;
            send({
              type: "progress", id: node.id, title: node.title, status: "updated",
              ...(revertIds ? {} : { originalIcon }),
            });
          } catch {
            failed++;
            send({ type: "progress", id: node.id, title: node.title, status: "error" });
          }
        }

        // See the WCT branch above for why this is gated on failed===0 alone.
        if (!revertIds && failed === 0) {
          await upsertPFPhraseEdit({
            ...found.edit,
            phrase: newPhrase,
            icon: newIcon,
            searchPhrase: newPhrase,
            ...(pendingCategory !== undefined && { category: pendingCategory }),
            ...(pendingTimeSensitive !== undefined && { timeSensitive: pendingTimeSensitive }),
            ...(pendingFilterByInterest !== undefined && { filterByInterest: pendingFilterByInterest }),
            ...(pendingMinPrice !== undefined && { minPrice: pendingMinPrice }),
            ...(pendingMaxPrice !== undefined && { maxPrice: pendingMaxPrice }),
          });
        }
      }

      const total = updated + skipped + failed;
      send({ type: "done", total, updated, skipped, failed });
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
