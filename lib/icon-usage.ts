import { shopifyGraphQL } from "./shopify";
import { getPfLibrary } from "./pf-store";
import { getBuiltinIcons, getBuiltinSvg, minifySvg } from "./icons";

const USAGE_QUERY = `
  query IconUsagePage($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        title
        pfIcon1: metafield(namespace: "perfect-for", key: "icon_1") { value }
        pfIcon2: metafield(namespace: "perfect-for", key: "icon_2") { value }
        pfIcon3: metafield(namespace: "perfect-for", key: "icon_3") { value }
        pfIcon4: metafield(namespace: "perfect-for", key: "icon_4") { value }
      }
    }
  }
`;

interface UsageQueryResult {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    nodes: Array<{
      title: string;
      pfIcon1: { value: string } | null;
      pfIcon2: { value: string } | null;
      pfIcon3: { value: string } | null;
      pfIcon4: { value: string } | null;
    }>;
  };
}

export async function getUsedBuiltinIconNames(): Promise<Set<string>> {
  const builtins = getBuiltinIcons();
  // Library phrases store built-in icons by name (e.g. "cake"); product metafields
  // store minified SVG content. Build both lookup structures.
  const builtinNameSet = new Set(builtins);
  const svgToName = new Map<string, string>();
  for (const name of builtins) {
    const svg = getBuiltinSvg(name);
    if (svg) svgToName.set(minifySvg(svg), name);
  }

  const used = new Set<string>();

  // Check library phrases (icon stored as plain name, e.g. "cake")
  const library = await getPfLibrary();
  for (const entry of library) {
    const iconName = entry.icon?.trim();
    if (iconName && builtinNameSet.has(iconName)) used.add(iconName);
  }

  // Check product metafields (icon stored as minified SVG content)
  let cursor: string | undefined;
  while (true) {
    const data = await shopifyGraphQL<UsageQueryResult>(
      USAGE_QUERY,
      cursor ? { cursor } : {}
    );
    for (const p of data.products.nodes) {
      const icons = [p.pfIcon1, p.pfIcon2, p.pfIcon3, p.pfIcon4]
        .map((f) => f?.value?.trim() ?? "")
        .filter(Boolean);
      for (const icon of icons) {
        const name = svgToName.get(icon);
        if (name) used.add(name);
      }
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return used;
}

export async function findIconUsage(svg: string): Promise<{
  products: string[];
  phrases: string[];
}> {
  const target = svg.trim();

  // Check library phrases (deduplicated by phraseId)
  const library = await getPfLibrary();
  const seenPhraseIds = new Set<string>();
  const phrases: string[] = [];
  for (const entry of library) {
    if (seenPhraseIds.has(entry.phraseId)) continue;
    seenPhraseIds.add(entry.phraseId);
    if (entry.icon && entry.icon.trim() === target) {
      phrases.push(entry.phrase);
    }
  }

  // Check product icon metafields (paginated)
  const productTitles: string[] = [];
  let cursor: string | undefined;
  while (true) {
    const data = await shopifyGraphQL<UsageQueryResult>(
      USAGE_QUERY,
      cursor ? { cursor } : {}
    );
    for (const p of data.products.nodes) {
      const icons = [p.pfIcon1, p.pfIcon2, p.pfIcon3, p.pfIcon4]
        .map((f) => f?.value?.trim() ?? "")
        .filter(Boolean);
      if (icons.some((i) => i === target)) {
        productTitles.push(p.title);
      }
    }
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  return { products: productTitles, phrases };
}
