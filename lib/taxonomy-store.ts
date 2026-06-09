import fs from "fs/promises";
import path from "path";
import { shopifyGraphQL } from "./shopify";
import { PRODUCT_TAXONOMY } from "@/data/taxonomy";

const TYPE = "pdp_taxonomy";
const FIELD_KEY = "taxonomy_json";
const FILE_PATH = path.join(process.cwd(), "data", "taxonomy-custom.json");

const QUERY = `
  query GetTaxonomy {
    metaobjects(type: "${TYPE}", first: 1) {
      nodes { id fields { key value } }
    }
  }
`;

const CREATE = `
  mutation CreateTaxonomy($f: [MetaobjectFieldInput!]!) {
    metaobjectCreate(metaobject: { type: "${TYPE}", handle: "main", fields: $f }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const UPDATE = `
  mutation UpdateTaxonomy($id: ID!, $f: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $f }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const CREATE_DEF = `
  mutation CreateTaxonomyDef {
    metaobjectDefinitionCreate(definition: {
      type: "${TYPE}",
      name: "PDP Taxonomy",
      fieldDefinitions: [{ name: "Taxonomy JSON", key: "${FIELD_KEY}", type: "multi_line_text_field" }]
    }) {
      metaobjectDefinition { id }
      userErrors { field message }
    }
  }
`;

type ShopifyNode = { id: string; fields: { key: string; value: string }[] };

const CACHE_TTL_MS = 30_000;
let _cache: Record<string, string[]> | null = null;
let _nodeId: string | null = null;
let _cacheExpiry = 0;

export async function getTaxonomy(): Promise<Record<string, string[]>> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;

  // Try Shopify metaobject first
  try {
    const data = await shopifyGraphQL<{ metaobjects: { nodes: ShopifyNode[] } }>(QUERY);
    const node = data.metaobjects.nodes[0] ?? null;
    if (node) {
      _nodeId = node.id;
      const field = node.fields.find((f) => f.key === FIELD_KEY);
      if (field?.value) {
        try {
          _cache = JSON.parse(field.value) as Record<string, string[]>;
          _cacheExpiry = Date.now() + CACHE_TTL_MS;
          return _cache;
        } catch {}
      }
      _cache = { ...PRODUCT_TAXONOMY };
      _cacheExpiry = Date.now() + CACHE_TTL_MS;
      return _cache;
    }
  } catch {}

  // Fallback: committed file seed (readable on Vercel, used before metaobject is created)
  try {
    const raw = await fs.readFile(FILE_PATH, "utf-8");
    _cache = JSON.parse(raw) as Record<string, string[]>;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return _cache;
  } catch {}

  _cache = { ...PRODUCT_TAXONOMY };
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  return _cache;
}

async function persist(taxonomy: Record<string, string[]>): Promise<void> {
  _cache = taxonomy;
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  const f = [{ key: FIELD_KEY, value: JSON.stringify(taxonomy) }];

  if (_nodeId) {
    const res = await shopifyGraphQL<{
      metaobjectUpdate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
    }>(UPDATE, { id: _nodeId, f });
    if (res.metaobjectUpdate.userErrors.length > 0) {
      throw new Error(`Shopify save failed: ${res.metaobjectUpdate.userErrors.map((e) => e.message).join(", ")}`);
    }
    return;
  }

  // No cached node ID — query first to avoid duplicate-create errors on warm restarts
  try {
    const check = await shopifyGraphQL<{ metaobjects: { nodes: ShopifyNode[] } }>(QUERY);
    const existing = check.metaobjects.nodes[0] ?? null;
    if (existing) {
      _nodeId = existing.id;
      const res = await shopifyGraphQL<{
        metaobjectUpdate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
      }>(UPDATE, { id: _nodeId, f });
      if (res.metaobjectUpdate.userErrors.length > 0) {
        throw new Error(`Shopify save failed: ${res.metaobjectUpdate.userErrors.map((e) => e.message).join(", ")}`);
      }
      return;
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Shopify save failed")) throw e;
  }

  // No node exists yet — create it
  const res = await shopifyGraphQL<{
    metaobjectCreate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
  }>(CREATE, { f });

  if (res.metaobjectCreate.metaobject?.id) {
    _nodeId = res.metaobjectCreate.metaobject.id;
    return;
  }

  // Metaobject type doesn't exist yet — create the definition then retry
  if (res.metaobjectCreate.userErrors.length > 0) {
    let defCreated = false;
    let defError = "";
    try {
      const defRes = await shopifyGraphQL<{
        metaobjectDefinitionCreate: {
          metaobjectDefinition: { id: string } | null;
          userErrors: { message: string }[];
        };
      }>(CREATE_DEF);
      defCreated = !!defRes.metaobjectDefinitionCreate.metaobjectDefinition?.id;
      if (!defCreated) {
        defError = defRes.metaobjectDefinitionCreate.userErrors.map((e) => e.message).join(", ") || "unknown error";
      }
    } catch (e) {
      defError = (e as Error).message;
    }

    if (!defCreated) {
      throw new Error(
        `Could not auto-create the "pdp_taxonomy" metaobject definition (${defError}). ` +
        `Please create it manually: Shopify Admin → Settings → Custom data → Metaobjects → Add definition. ` +
        `Set the API type to "pdp_taxonomy" and add one Multi-line text field with key "taxonomy_json".`
      );
    }

    const retry = await shopifyGraphQL<{
      metaobjectCreate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
    }>(CREATE, { f });
    if (retry.metaobjectCreate.metaobject?.id) {
      _nodeId = retry.metaobjectCreate.metaobject.id;
      return;
    }
    throw new Error(`Shopify save failed: ${retry.metaobjectCreate.userErrors.map((e) => e.message).join(", ")}`);
  }
}

// Serialize all mutations so concurrent requests don't overwrite each other
let mutationChain: Promise<void> = Promise.resolve();
function serialized(fn: () => Promise<void>): Promise<void> {
  const next = mutationChain.then(fn);
  mutationChain = next.catch(() => {});
  return next;
}

export function saveTaxonomy(taxonomy: Record<string, string[]>): Promise<void> {
  return serialized(() => persist(taxonomy));
}
