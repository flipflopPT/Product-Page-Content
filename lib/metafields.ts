import { shopifyGraphQL } from "./shopify";

export interface ProductMetafieldData {
  productSummary: string;
  productTypePt: string;
  productStylePt: string;
  whyChooseThis: { bullet1: string; bullet2: string; bullet3: string; bullet4: string };
  perfectFor: {
    bullet1: string; bullet2: string; bullet3: string; bullet4: string;
    icon1?: string; icon2?: string; icon3?: string; icon4?: string;
  };
  seasonalOverrides: { mothersDay: boolean; fathersDay: boolean; valentinesDay: boolean };
}

const GET_PRODUCT_METAFIELDS = `
  query GetProductMetafields($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      descriptionHtml
      featuredImage { url altText }
      productSummary:  metafield(namespace: "product",          key: "product_summary")   { value }
      productTypePt:   metafield(namespace: "product",          key: "product_type_pt")   { value }
      productStylePt:  metafield(namespace: "product",          key: "product_style_pt")  { value }
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
      seasonalMD:      metafield(namespace: "seasonal-override", key: "mothers_day")        { value }
      seasonalFD:      metafield(namespace: "seasonal-override", key: "fathers_day")        { value }
      seasonalVD:      metafield(namespace: "seasonal-override", key: "valentines_day")     { value }
    }
  }
`;

type MF = { value: string } | null;
interface GetProductResponse {
  product: {
    id: string;
    title: string;
    handle: string;
    descriptionHtml: string;
    featuredImage: { url: string; altText: string } | null;
    productSummary: MF; productTypePt: MF; productStylePt: MF;
    wctBullet1: MF; wctBullet2: MF; wctBullet3: MF; wctBullet4: MF;
    pfBullet1: MF; pfBullet2: MF; pfBullet3: MF; pfBullet4: MF;
    pfIcon1: MF; pfIcon2: MF; pfIcon3: MF; pfIcon4: MF;
    seasonalMD: MF; seasonalFD: MF; seasonalVD: MF;
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
      icon1:   p.pfIcon1?.value   ?? "",
      icon2:   p.pfIcon2?.value   ?? "",
      icon3:   p.pfIcon3?.value   ?? "",
      icon4:   p.pfIcon4?.value   ?? "",
    },
    seasonalOverrides: {
      mothersDay:    p.seasonalMD?.value === "true",
      fathersDay:    p.seasonalFD?.value === "true",
      valentinesDay: p.seasonalVD?.value === "true",
    },
  };

  return {
    product: {
      id: p.id,
      title: p.title,
      handle: p.handle,
      descriptionHtml: p.descriptionHtml,
      featuredImage: p.featuredImage,
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
    if (value !== undefined) inputs.push({ ownerId: productGid, namespace: ns, key, value, type });
  };

  if (data.productSummary !== undefined) add("product", "product_summary", data.productSummary, "multi_line_text_field");
  if (data.productTypePt !== undefined)  add("product", "product_type_pt",  data.productTypePt,  "single_line_text_field");
  if (data.productStylePt !== undefined) add("product", "product_style_pt", data.productStylePt, "single_line_text_field");

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
    add("seasonal-override", "mothers_day",    String(s.mothersDay),    "boolean");
    add("seasonal-override", "fathers_day",    String(s.fathersDay),    "boolean");
    add("seasonal-override", "valentines_day", String(s.valentinesDay), "boolean");
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
