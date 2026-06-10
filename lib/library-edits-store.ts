import fs from "fs/promises";
import path from "path";
import { shopifyGraphQL } from "./shopify";

const TYPE = "pdp_library_edits";
const FIELD_KEY = "edits_json";
const EDITS_PATH = path.join(process.cwd(), "data", "library-edits.json");

const QUERY = `
  query GetLibraryEdits {
    metaobjects(type: "${TYPE}", first: 1) {
      nodes { id fields { key value } }
    }
  }
`;

const CREATE = `
  mutation CreateLibraryEdits($f: [MetaobjectFieldInput!]!) {
    metaobjectCreate(metaobject: { type: "${TYPE}", handle: "main", fields: $f }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const UPDATE = `
  mutation UpdateLibraryEdits($id: ID!, $f: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $f }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const CREATE_DEF = `
  mutation CreateLibraryEditsDef {
    metaobjectDefinitionCreate(definition: {
      type: "${TYPE}",
      name: "PDP Library Edits",
      fieldDefinitions: [{ name: "Edits JSON", key: "${FIELD_KEY}", type: "multi_line_text_field" }]
    }) {
      metaobjectDefinition { id }
      userErrors { field message }
    }
  }
`;

export interface WCTEdit {
  id: string;
  productType: string;
  productStyle: string;
  category: string;
  text: string;
  subtext: string;
  searchFormatted: string;
  isNew: boolean;
}

// Phrase-level edit — covers phrase text, icon, category, seasonal, filterByInterest
export interface PFPhraseEdit {
  id: string;           // phraseId
  phrase: string;
  icon: string;
  searchPhrase: string; // original phrase text used to find products that need updating
  isNew: boolean;
  deleted?: boolean;    // true = phrase has been deleted
  // Optional fields — only present when overriding phrase-level attributes
  category?: string;
  timeSensitive?: string | null;
  filterByInterest?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

// Applicability-level edit — adds or removes a type/style assignment
export interface PFApplicabilityEdit {
  id: string;           // applicability ID
  phraseId: string;
  productType: string;
  productStyle: string;
  applicabilityCount: number;
  isNew: boolean;
  deleted?: boolean;    // true = this assignment has been removed
}

export interface LibraryEdits {
  wct: Record<string, WCTEdit>;
  pfPhrases: Record<string, PFPhraseEdit>;
  pfApplicability: Record<string, PFApplicabilityEdit>;
  uploadedIcons: Array<{ name: string; svg: string }>;
}

type ShopifyNode = { id: string; fields: { key: string; value: string }[] };

// In-memory cache — reduces Shopify API calls within a single serverless invocation.
// TTL ensures the long-running dev server picks up changes made elsewhere (e.g. on Vercel).
const CACHE_TTL_MS = 30_000;
let _editsCache: LibraryEdits | null = null;
let _nodeId: string | null = null;
let _cacheExpiry = 0;

function normalise(parsed: Partial<LibraryEdits>): LibraryEdits {
  return {
    wct: parsed.wct ?? {},
    pfPhrases: parsed.pfPhrases ?? {},
    pfApplicability: parsed.pfApplicability ?? {},
    uploadedIcons: parsed.uploadedIcons ?? [],
  };
}

export async function getLibraryEdits(): Promise<LibraryEdits> {
  if (_editsCache && Date.now() < _cacheExpiry) return _editsCache;

  // Try Shopify metaobject first
  try {
    const data = await shopifyGraphQL<{ metaobjects: { nodes: ShopifyNode[] } }>(QUERY);
    const node = data.metaobjects.nodes[0] ?? null;
    if (node) {
      _nodeId = node.id;
      const field = node.fields.find((f) => f.key === FIELD_KEY);
      if (field?.value) {
        try {
          _editsCache = normalise(JSON.parse(field.value) as Partial<LibraryEdits>);
          _cacheExpiry = Date.now() + CACHE_TTL_MS;
          return _editsCache;
        } catch {}
      }
      // Node exists but field is empty — treat as blank store
      _editsCache = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };
      _cacheExpiry = Date.now() + CACHE_TTL_MS;
      return _editsCache;
    }
  } catch {}

  // Fallback: static file seed (used on first deploy before metaobject is created)
  try {
    const raw = await fs.readFile(EDITS_PATH, "utf-8");
    _editsCache = normalise(JSON.parse(raw) as Partial<LibraryEdits>);
  } catch {
    _editsCache = { wct: {}, pfPhrases: {}, pfApplicability: {}, uploadedIcons: [] };
  }
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  return _editsCache;
}

async function persist(edits: LibraryEdits): Promise<void> {
  _editsCache = edits; // keep cache in sync before any await
  _cacheExpiry = Date.now() + CACHE_TTL_MS;
  const f = [{ key: FIELD_KEY, value: JSON.stringify(edits) }];

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
    // If this is our own userErrors error, re-throw it
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
    await shopifyGraphQL(CREATE_DEF).catch(() => {});
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

// ── WCT ──────────────────────────────────────────────────────────────────────

export function upsertWCTEdit(entry: WCTEdit): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    edits.wct[entry.id] = entry;
    await persist(edits);
  });
}

export function deleteWCTEdit(id: string): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    delete edits.wct[id];
    await persist(edits);
  });
}

export function markWCTPushed(id: string, newFormatted: string): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    if (edits.wct[id]) {
      edits.wct[id].searchFormatted = newFormatted;
      await persist(edits);
    }
  });
}

// ── PF Phrases ────────────────────────────────────────────────────────────────

export function upsertPFPhraseEdit(entry: PFPhraseEdit): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    edits.pfPhrases[entry.id] = entry;
    await persist(edits);
  });
}

export function deletePFPhraseEdit(phraseId: string): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    delete edits.pfPhrases[phraseId];
    await persist(edits);
  });
}

export function markPFPhrasePushed(phraseId: string, newPhrase: string): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    if (edits.pfPhrases[phraseId]) {
      edits.pfPhrases[phraseId].searchPhrase = newPhrase;
      await persist(edits);
    }
  });
}

// ── PF Applicability ──────────────────────────────────────────────────────────

export function upsertPFApplicabilityEdit(entry: PFApplicabilityEdit): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    edits.pfApplicability[entry.id] = entry;
    await persist(edits);
  });
}

export function deletePFApplicabilityEdit(id: string): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    delete edits.pfApplicability[id];
    await persist(edits);
  });
}

// ── Uploaded Icons ────────────────────────────────────────────────────────────

export function updateUploadedIcons(
  icons: Array<{ name: string; svg: string }>
): Promise<void> {
  return serialized(async () => {
    const edits = await getLibraryEdits();
    edits.uploadedIcons = icons;
    await persist(edits);
  });
}
