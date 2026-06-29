import { shopifyGraphQL } from "./shopify";

export interface ProductMetafieldData {
  productSummary: string;
  productTypePt: string;
  productStylePt: string;
  humanReviewed?: string;
  whyChooseThis: { bullet1: string; bullet2: string; bullet3: string; bullet4: string };
  perfectFor: {
    bullet1: string; bullet2: string; bullet3: string; bullet4: string;
    icon1?: string; icon2?: string; icon3?: string; icon4?: string;
  };
  seasonalOverrides: {
    mothersDay:    { phrase: string; icon: string };
    fathersDay:    { phrase: string; icon: string };
    valentinesDay: { phrase: string; icon: string };
  };
}

const GET_PRODUCT_METAFIELDS = `
  query GetProductMetafields($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      vendor
      descriptionHtml
      featuredImage { url altText }
      priceRangeV2 { minVariantPrice { amount } }
      productSummary:  metafield(namespace: "product",          key: "product_summary")   { value }
      productTypePt:   metafield(namespace: "product",          key: "product_type")   { value }
      productStylePt:  metafield(namespace: "product",          key: "product_style")  { value }
      humanReviewed:   metafield(namespace: "product",          key: "approved") { value }
      wctBullet1:      metafield(namespace: "why-choose-this",  key: "bullet_1")           { value }
      wctBullet2:      metafield(namespace: "why-choose-this",  key: "bullet_2")           { value }
      wctBullet3:      metafield(namespace: "why-choose-this",  key: "bullet_3")           { value }
      wctBullet4:      metafield(namespace: "why-choose-this",  key: "bullet_4")           { value }
      pfBullet1:       metafield(namespace: "perfect-for",      key: "perfect_bullet_1")   { value }
      pfBullet2:       metafield(namespace: "perfect-for",      key: "perfect_bullet_2")   { value }
      pfBullet3:       metafield(namespace: "perfect-for",      key: "perfect_bullet_3")   { value }
      pfBullet4:       metafield(namespace: "perfect-for",      key: "perfect_bullet_4")   { value }
      pfIcon1:         metafield(namespace: "perfect-for",      key: "icon_1")             { value }
      pfIcon2:         metafield(namespace: "perfect-for",      key: "icon_2")             { value }
      pfIcon3:         metafield(namespace: "perfect-for",      key: "icon_3")             { value }
      pfIcon4:         metafield(namespace: "perfect-for",      key: "icon_4")             { value }
      sMdPhrase:  metafield(namespace: "seasonal", key: "mothers_day_phrase")    { value }
      sMdIcon:    metafield(namespace: "seasonal", key: "mothers_day_icon")      { value }
      sFdPhrase:  metafield(namespace: "seasonal", key: "fathers_day_phrase")    { value }
      sFdIcon:    metafield(namespace: "seasonal", key: "fathers_day_icon")      { value }
      sVdPhrase:  metafield(namespace: "seasonal", key: "valentines_day_phrase") { value }
      sVdIcon:    metafield(namespace: "seasonal", key: "valentines_day_icon")   { value }
    }
  }
`;

function normalizeIconValue(v: string): string {
  if (!v.startsWith("<svg")) return v;
  const match = v.match(/\bid="([^"]+)"/);
  return match?.[1] ?? "";
}

type MF = { value: string } | null;
interface GetProductResponse {
  product: {
    id: string;
    title: string;
    handle: string;
    vendor: string;
    descriptionHtml: string;
    featuredImage: { url: string; altText: string } | null;
    priceRangeV2?: { minVariantPrice: { amount: string } } | null;
    productSummary: MF; productTypePt: MF; productStylePt: MF; humanReviewed: MF;
    wctBullet1: MF; wctBullet2: MF; wctBullet3: MF; wctBullet4: MF;
    pfBullet1: MF; pfBullet2: MF; pfBullet3: MF; pfBullet4: MF;
    pfIcon1: MF; pfIcon2: MF; pfIcon3: MF; pfIcon4: MF;
    sMdPhrase: MF; sMdIcon: MF; sFdPhrase: MF; sFdIcon: MF; sVdPhrase: MF; sVdIcon: MF;
  } | null;
}

export async function getProductWithMetafields(productGid: string) {
  const data = await shopifyGraphQL<GetProductResponse>(GET_PRODUCT_METAFIELDS, { id: productGid });
  const p = data.product;
  if (!p) throw new Error(`Product not found: ${productGid}`);

  const metafields: ProductMetafieldData = {
    productSummary:  p.productSummary?.value  ?? "",
    productTypePt:   p.productTypePt?.value   ?? "",
    productStylePt:  p.productStylePt?.value  ?? "",
    humanReviewed:   p.humanReviewed?.value   ?? "false",
    whyChooseThis: {
      bullet1: p.wctBullet1?.value ?? "",
      bullet2: p.wctBullet2?.value ?? "",
      bullet3: p.wctBullet3?.value ?? "",
      bullet4: p.wctBullet4?.value ?? "",
    },
    perfectFor: {
      bullet1: p.pfBullet1?.value ?? "",
      bullet2: p.pfBullet2?.value ?? "",
      bullet3: p.pfBullet3?.value ?? "",
      bullet4: p.pfBullet4?.value ?? "",
      icon1:   normalizeIconValue(p.pfIcon1?.value   ?? ""),
      icon2:   normalizeIconValue(p.pfIcon2?.value   ?? ""),
      icon3:   normalizeIconValue(p.pfIcon3?.value   ?? ""),
      icon4:   normalizeIconValue(p.pfIcon4?.value   ?? ""),
    },
    seasonalOverrides: {
      mothersDay:    { phrase: p.sMdPhrase?.value ?? "", icon: p.sMdIcon?.value ?? "" },
      fathersDay:    { phrase: p.sFdPhrase?.value ?? "", icon: p.sFdIcon?.value ?? "" },
      valentinesDay: { phrase: p.sVdPhrase?.value ?? "", icon: p.sVdIcon?.value ?? "" },
    },
  };

  return {
    product: {
      id: p.id,
      title: p.title,
      handle: p.handle,
      vendor: p.vendor ?? "",
      descriptionHtml: p.descriptionHtml,
      featuredImage: p.featuredImage,
      price: parseFloat(p.priceRangeV2?.minVariantPrice?.amount ?? "0") || 0,
    },
    metafields,
  };
}

const SET_METAFIELDS = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

interface MetafieldInput {
  ownerId: string;
  namespace: string;
  key: string;
  value: string;
  type: string;
}

export async function setProductMetafields(
  productGid: string,
  data: Partial<ProductMetafieldData>
): Promise<void> {
  const inputs: MetafieldInput[] = [];
  const add = (ns: string, key: string, value: string, type: string) => {
    if (value !== undefined && value !== "") inputs.push({ ownerId: productGid, namespace: ns, key, value, type });
  };

  if (data.productSummary !== undefined) add("product", "product_summary", data.productSummary, "multi_line_text_field");
  if (data.productTypePt !== undefined)  add("product", "product_type",  data.productTypePt,  "single_line_text_field");
  if (data.productStylePt !== undefined) add("product", "product_style", data.productStylePt, "single_line_text_field");
  if (data.humanReviewed !== undefined)  add("product", "approved", data.humanReviewed, "single_line_text_field");

  if (data.whyChooseThis) {
    const w = data.whyChooseThis;
    if (w.bullet1 !== undefined) add("why-choose-this", "bullet_1", w.bullet1, "multi_line_text_field");
    if (w.bullet2 !== undefined) add("why-choose-this", "bullet_2", w.bullet2, "multi_line_text_field");
    if (w.bullet3 !== undefined) add("why-choose-this", "bullet_3", w.bullet3, "multi_line_text_field");
    if (w.bullet4 !== undefined) add("why-choose-this", "bullet_4", w.bullet4, "multi_line_text_field");
  }

  if (data.perfectFor) {
    const pf = data.perfectFor;
    if (pf.bullet1 !== undefined) add("perfect-for", "perfect_bullet_1", pf.bullet1, "single_line_text_field");
    if (pf.bullet2 !== undefined) add("perfect-for", "perfect_bullet_2", pf.bullet2, "single_line_text_field");
    if (pf.bullet3 !== undefined) add("perfect-for", "perfect_bullet_3", pf.bullet3, "single_line_text_field");
    if (pf.bullet4 !== undefined) add("perfect-for", "perfect_bullet_4", pf.bullet4, "single_line_text_field");
    if (pf.icon1 !== undefined) add("perfect-for", "icon_1", pf.icon1, "single_line_text_field");
    if (pf.icon2 !== undefined) add("perfect-for", "icon_2", pf.icon2, "single_line_text_field");
    if (pf.icon3 !== undefined) add("perfect-for", "icon_3", pf.icon3, "single_line_text_field");
    if (pf.icon4 !== undefined) add("perfect-for", "icon_4", pf.icon4, "single_line_text_field");
  }

  if (data.seasonalOverrides) {
    const s = data.seasonalOverrides;
    // Only write non-empty values — Shopify rejects blank metafield values
    if (s.mothersDay.phrase)    add("seasonal", "mothers_day_phrase",    s.mothersDay.phrase,    "single_line_text_field");
    if (s.mothersDay.icon)      add("seasonal", "mothers_day_icon",      s.mothersDay.icon,      "single_line_text_field");
    if (s.fathersDay.phrase)    add("seasonal", "fathers_day_phrase",    s.fathersDay.phrase,    "single_line_text_field");
    if (s.fathersDay.icon)      add("seasonal", "fathers_day_icon",      s.fathersDay.icon,      "single_line_text_field");
    if (s.valentinesDay.phrase) add("seasonal", "valentines_day_phrase", s.valentinesDay.phrase, "single_line_text_field");
    if (s.valentinesDay.icon)   add("seasonal", "valentines_day_icon",   s.valentinesDay.icon,   "single_line_text_field");
  }

  if (inputs.length === 0) return;

  const result = await shopifyGraphQL<{
    metafieldsSet: { userErrors: { field: string; message: string }[] };
  }>(SET_METAFIELDS, { metafields: inputs });

  const errors = result.metafieldsSet.userErrors;
  if (errors.length > 0) {
    throw new Error(`Metafield write errors: ${JSON.stringify(errors)}`);
  }
}

// ── Batch helpers ────────────────────────────────────────────────────────────

// The product fields fragment reused in each alias inside the batch query
const PRODUCT_FIELDS = `
  id title handle vendor descriptionHtml
  featuredImage { url altText }
  priceRangeV2 { minVariantPrice { amount } }
  productSummary:  metafield(namespace: "product",          key: "product_summary")   { value }
  productTypePt:   metafield(namespace: "product",          key: "product_type")      { value }
  productStylePt:  metafield(namespace: "product",          key: "product_style")     { value }
  humanReviewed:   metafield(namespace: "product",          key: "approved")    { value }
  wctBullet1:      metafield(namespace: "why-choose-this",  key: "bullet_1")          { value }
  wctBullet2:      metafield(namespace: "why-choose-this",  key: "bullet_2")          { value }
  wctBullet3:      metafield(namespace: "why-choose-this",  key: "bullet_3")          { value }
  wctBullet4:      metafield(namespace: "why-choose-this",  key: "bullet_4")          { value }
  pfBullet1:       metafield(namespace: "perfect-for",      key: "perfect_bullet_1")  { value }
  pfBullet2:       metafield(namespace: "perfect-for",      key: "perfect_bullet_2")  { value }
  pfBullet3:       metafield(namespace: "perfect-for",      key: "perfect_bullet_3")  { value }
  pfBullet4:       metafield(namespace: "perfect-for",      key: "perfect_bullet_4")  { value }
  pfIcon1:         metafield(namespace: "perfect-for",      key: "icon_1")            { value }
  pfIcon2:         metafield(namespace: "perfect-for",      key: "icon_2")            { value }
  pfIcon3:         metafield(namespace: "perfect-for",      key: "icon_3")            { value }
  pfIcon4:         metafield(namespace: "perfect-for",      key: "icon_4")            { value }
  sMdPhrase:  metafield(namespace: "seasonal", key: "mothers_day_phrase")    { value }
  sMdIcon:    metafield(namespace: "seasonal", key: "mothers_day_icon")      { value }
  sFdPhrase:  metafield(namespace: "seasonal", key: "fathers_day_phrase")    { value }
  sFdIcon:    metafield(namespace: "seasonal", key: "fathers_day_icon")      { value }
  sVdPhrase:  metafield(namespace: "seasonal", key: "valentines_day_phrase") { value }
  sVdIcon:    metafield(namespace: "seasonal", key: "valentines_day_icon")   { value }
`;

const BATCH_SIZE = 15; // 15 × ~23 fields ≈ 345 query-cost points, well under Shopify's 1000-point limit

function parseProductNode(p: GetProductResponse["product"]): ReturnType<typeof getProductWithMetafields> extends Promise<infer R> ? R : never {
  if (!p) throw new Error("null product in batch");
  const metafields: ProductMetafieldData = {
    productSummary:  p.productSummary?.value  ?? "",
    productTypePt:   p.productTypePt?.value   ?? "",
    productStylePt:  p.productStylePt?.value  ?? "",
    humanReviewed:   p.humanReviewed?.value   ?? "false",
    whyChooseThis: {
      bullet1: p.wctBullet1?.value ?? "",
      bullet2: p.wctBullet2?.value ?? "",
      bullet3: p.wctBullet3?.value ?? "",
      bullet4: p.wctBullet4?.value ?? "",
    },
    perfectFor: {
      bullet1: p.pfBullet1?.value ?? "",
      bullet2: p.pfBullet2?.value ?? "",
      bullet3: p.pfBullet3?.value ?? "",
      bullet4: p.pfBullet4?.value ?? "",
      icon1:   normalizeIconValue(p.pfIcon1?.value   ?? ""),
      icon2:   normalizeIconValue(p.pfIcon2?.value   ?? ""),
      icon3:   normalizeIconValue(p.pfIcon3?.value   ?? ""),
      icon4:   normalizeIconValue(p.pfIcon4?.value   ?? ""),
    },
    seasonalOverrides: {
      mothersDay:    { phrase: p.sMdPhrase?.value ?? "", icon: p.sMdIcon?.value ?? "" },
      fathersDay:    { phrase: p.sFdPhrase?.value ?? "", icon: p.sFdIcon?.value ?? "" },
      valentinesDay: { phrase: p.sVdPhrase?.value ?? "", icon: p.sVdIcon?.value ?? "" },
    },
  };
  return {
    product: { id: p.id, title: p.title, handle: p.handle, vendor: p.vendor ?? "", descriptionHtml: p.descriptionHtml, featuredImage: p.featuredImage, price: parseFloat(p.priceRangeV2?.minVariantPrice?.amount ?? "0") || 0 },
    metafields,
  };
}

type ProductWithMetafields = Awaited<ReturnType<typeof getProductWithMetafields>>;

/**
 * Fetches multiple products in batches of BATCH_SIZE using GraphQL aliases,
 * reducing N individual API calls to ceil(N / BATCH_SIZE) calls.
 * Products not found in Shopify are omitted from the result.
 */
export async function getProductsBatchWithMetafields(ids: string[]): Promise<ProductWithMetafields[]> {
  const results: ProductWithMetafields[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const aliases = chunk.map((id, j) => `p_${j}: product(id: "${id}") { ${PRODUCT_FIELDS} }`).join("\n");
    const query = `query GetProductsBatch { ${aliases} }`;

    try {
      const data = await shopifyGraphQL<Record<string, GetProductResponse["product"]>>(query);
      for (let j = 0; j < chunk.length; j++) {
        const node = data[`p_${j}`];
        if (node) {
          try {
            results.push(parseProductNode(node));
          } catch { /* skip malformed product */ }
        }
      }
    } catch { /* skip entire batch on error, same as current per-product catch */ }
  }

  return results;
}

/**
 * Writes metafields for multiple products in a single metafieldsSet call (chunked at 25 inputs).
 */
export async function setProductsMetafieldsBatch(
  rows: Array<{ productGid: string; data: Partial<ProductMetafieldData> }>
): Promise<void> {
  const allInputs: MetafieldInput[] = [];

  for (const { productGid, data } of rows) {
    const add = (ns: string, key: string, value: string, type: string) => {
      if (value !== undefined && value !== "") allInputs.push({ ownerId: productGid, namespace: ns, key, value, type });
    };
    if (data.productSummary !== undefined) add("product", "product_summary", data.productSummary, "multi_line_text_field");
    if (data.productTypePt !== undefined)  add("product", "product_type",  data.productTypePt,  "single_line_text_field");
    if (data.productStylePt !== undefined) add("product", "product_style", data.productStylePt, "single_line_text_field");
    if (data.humanReviewed !== undefined)  add("product", "approved", data.humanReviewed, "single_line_text_field");
    if (data.whyChooseThis) {
      const w = data.whyChooseThis;
      if (w.bullet1 !== undefined) add("why-choose-this", "bullet_1", w.bullet1, "multi_line_text_field");
      if (w.bullet2 !== undefined) add("why-choose-this", "bullet_2", w.bullet2, "multi_line_text_field");
      if (w.bullet3 !== undefined) add("why-choose-this", "bullet_3", w.bullet3, "multi_line_text_field");
      if (w.bullet4 !== undefined) add("why-choose-this", "bullet_4", w.bullet4, "multi_line_text_field");
    }
    if (data.perfectFor) {
      const pf = data.perfectFor;
      if (pf.bullet1 !== undefined) add("perfect-for", "perfect_bullet_1", pf.bullet1, "single_line_text_field");
      if (pf.bullet2 !== undefined) add("perfect-for", "perfect_bullet_2", pf.bullet2, "single_line_text_field");
      if (pf.bullet3 !== undefined) add("perfect-for", "perfect_bullet_3", pf.bullet3, "single_line_text_field");
      if (pf.bullet4 !== undefined) add("perfect-for", "perfect_bullet_4", pf.bullet4, "single_line_text_field");
      if (pf.icon1 !== undefined) add("perfect-for", "icon_1", pf.icon1, "single_line_text_field");
      if (pf.icon2 !== undefined) add("perfect-for", "icon_2", pf.icon2, "single_line_text_field");
      if (pf.icon3 !== undefined) add("perfect-for", "icon_3", pf.icon3, "single_line_text_field");
      if (pf.icon4 !== undefined) add("perfect-for", "icon_4", pf.icon4, "single_line_text_field");
    }
    if (data.seasonalOverrides) {
      const s = data.seasonalOverrides;
      if (s.mothersDay.phrase)    add("seasonal", "mothers_day_phrase",    s.mothersDay.phrase,    "single_line_text_field");
      if (s.mothersDay.icon)      add("seasonal", "mothers_day_icon",      s.mothersDay.icon,      "single_line_text_field");
      if (s.fathersDay.phrase)    add("seasonal", "fathers_day_phrase",    s.fathersDay.phrase,    "single_line_text_field");
      if (s.fathersDay.icon)      add("seasonal", "fathers_day_icon",      s.fathersDay.icon,      "single_line_text_field");
      if (s.valentinesDay.phrase) add("seasonal", "valentines_day_phrase", s.valentinesDay.phrase, "single_line_text_field");
      if (s.valentinesDay.icon)   add("seasonal", "valentines_day_icon",   s.valentinesDay.icon,   "single_line_text_field");
    }
  }

  if (allInputs.length === 0) return;

  // Send in chunks of 25 to stay within Shopify's metafieldsSet limits
  const CHUNK = 25;
  for (let i = 0; i < allInputs.length; i += CHUNK) {
    const chunk = allInputs.slice(i, i + CHUNK);
    const result = await shopifyGraphQL<{
      metafieldsSet: { userErrors: { field: string; message: string }[] };
    }>(SET_METAFIELDS, { metafields: chunk });
    const errors = result.metafieldsSet.userErrors;
    if (errors.length > 0) {
      throw new Error(`Metafield write errors: ${JSON.stringify(errors)}`);
    }
  }
}
