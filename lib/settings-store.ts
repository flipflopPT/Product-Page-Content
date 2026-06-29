import { shopifyGraphQL } from "./shopify";
import type { AppSettings } from "./types";

const METAOBJECT_TYPE = "pdp_app_settings";

const DEFAULT_INTEREST_KEYWORDS: Record<string, string[]> = {
  "Travel lovers":        ["travel", "traveller", "traveler", "holiday", "luggage", "passport", "suitcase", "explorer", "wanderlust", "abroad"],
  "Craft Lovers":         ["craft", "knitting", "knit", "sewing", "sew", "crochet", "embroidery", "quilting", "needlework", "maker", "diy"],
  "Foodies":              ["food", "cook", "cooking", "kitchen", "recipe", "baking", "baker", "chef", "gourmet", "culinary", "foodie"],
  "Outdoor Types":        ["outdoor", "garden", "gardening", "hiking", "hike", "camping", "nature", "walking", "rambling", "adventure", "trail"],
  "Outdoor entertaining": ["outdoor", "garden", "barbecue", "bbq", "picnic", "al fresco", "alfresco", "patio", "terrace", "entertaining"],
  "Music Lovers":         ["music", "musician", "guitar", "piano", "violin", "vinyl", "concert", "singing", "band", "instrument", "melody", "song"],
  "Sports Fans":          ["sport", "sports", "football", "rugby", "cricket", "tennis", "golf", "fitness", "gym", "athlete", "team", "match"],
};

const DEFAULT_SETTINGS: AppSettings = {
  dateRanges: { mothersDay: null, fathersDay: null, valentinesDay: null },
  interestKeywords: DEFAULT_INTEREST_KEYWORDS,
};

const LIST_QUERY = `
  query GetSettings {
    metaobjects(type: "${METAOBJECT_TYPE}", first: 1) {
      nodes { id fields { key value } }
    }
  }
`;

const CREATE_MUTATION = `
  mutation CreateSettings($fields: [MetaobjectFieldInput!]!) {
    metaobjectCreate(metaobject: { type: "${METAOBJECT_TYPE}", handle: "main", fields: $fields }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation UpdateSettings($id: ID!, $fields: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
      metaobject { id }
      userErrors { field message }
    }
  }
`;

const CREATE_DEF = `
  mutation CreateSettingsDef {
    metaobjectDefinitionCreate(definition: {
      type: "${METAOBJECT_TYPE}",
      name: "PDP App Settings",
      fieldDefinitions: [
        { name: "Interest Keywords", key: "interest_keywords", type: "multi_line_text_field" },
        { name: "Mother's Day Start", key: "mothers_day_start", type: "single_line_text_field" },
        { name: "Mother's Day End", key: "mothers_day_end", type: "single_line_text_field" },
        { name: "Father's Day Start", key: "fathers_day_start", type: "single_line_text_field" },
        { name: "Father's Day End", key: "fathers_day_end", type: "single_line_text_field" },
        { name: "Valentine's Day Start", key: "valentines_day_start", type: "single_line_text_field" },
        { name: "Valentine's Day End", key: "valentines_day_end", type: "single_line_text_field" }
      ]
    }) {
      metaobjectDefinition { id }
      userErrors { field message }
    }
  }
`;

const GET_DEF_QUERY = `
  query GetSettingsDef {
    metaobjectDefinitionByType(type: "${METAOBJECT_TYPE}") {
      id
      fieldDefinitions { key }
    }
  }
`;

const ADD_IK_FIELD_MUTATION = `
  mutation AddInterestKeywordsField($defId: ID!) {
    metaobjectDefinitionUpdate(id: $defId, definition: {
      fieldDefinitions: {
        create: [{ name: "Interest Keywords", key: "interest_keywords", type: "multi_line_text_field" }]
      }
    }) {
      metaobjectDefinition { id }
      userErrors { field message }
    }
  }
`;

const DATE_FIELD_META: Record<string, string> = {
  mothers_day_start:    "Mother's Day Start",
  mothers_day_end:      "Mother's Day End",
  fathers_day_start:    "Father's Day Start",
  fathers_day_end:      "Father's Day End",
  valentines_day_start: "Valentine's Day Start",
  valentines_day_end:   "Valentine's Day End",
};

type ShopifyNode = { id: string; fields: { key: string; value: string }[] };

let _nodeId: string | null = null;
let _defMigrated = false;

// Adds any missing fields to the definition. Safe to call repeatedly — only adds what is absent.
async function ensureDefinitionFields(): Promise<void> {
  const data = await shopifyGraphQL<{
    metaobjectDefinitionByType: { id: string; fieldDefinitions: { key: string }[] } | null;
  }>(GET_DEF_QUERY);
  const def = data.metaobjectDefinitionByType;
  if (!def) return;
  const existing = new Set(def.fieldDefinitions.map((f) => f.key));

  if (!existing.has("interest_keywords")) {
    await shopifyGraphQL(ADD_IK_FIELD_MUTATION, { defId: def.id }).catch(() => {});
  }

  // Build a mutation with only the fields that are actually missing (avoids all-or-nothing failure)
  const DATE_KEYS = Object.keys(DATE_FIELD_META);
  const missingKeys = DATE_KEYS.filter((k) => !existing.has(k));
  if (missingKeys.length > 0) {
    const createList = missingKeys
      .map((k) => `{ name: "${DATE_FIELD_META[k]}", key: "${k}", type: "single_line_text_field" }`)
      .join(", ");
    const mutation = `
      mutation AddMissingDateFields($defId: ID!) {
        metaobjectDefinitionUpdate(id: $defId, definition: {
          fieldDefinitions: { create: [${createList}] }
        }) {
          metaobjectDefinition { id }
          userErrors { field message }
        }
      }
    `;
    await shopifyGraphQL(mutation, { defId: def.id }).catch(() => {});
  }
}

async function ensureDefinitionOnce(): Promise<void> {
  if (_defMigrated) return;
  _defMigrated = true;
  await ensureDefinitionFields().catch(() => {});
}

function settingsToFields(s: AppSettings) {
  const { mothersDay, fathersDay, valentinesDay } = s.dateRanges;
  return [
    { key: "interest_keywords",   value: JSON.stringify(s.interestKeywords) },
    { key: "mothers_day_start",   value: mothersDay?.start   ?? "" },
    { key: "mothers_day_end",     value: mothersDay?.end     ?? "" },
    { key: "fathers_day_start",   value: fathersDay?.start   ?? "" },
    { key: "fathers_day_end",     value: fathersDay?.end     ?? "" },
    { key: "valentines_day_start", value: valentinesDay?.start ?? "" },
    { key: "valentines_day_end",   value: valentinesDay?.end   ?? "" },
  ];
}

function fieldsToSettings(fields: { key: string; value: string }[]): AppSettings {
  const get = (key: string) => fields.find((f) => f.key === key)?.value ?? "";

  const mdStart = get("mothers_day_start");
  const mdEnd   = get("mothers_day_end");
  const fdStart = get("fathers_day_start");
  const fdEnd   = get("fathers_day_end");
  const vdStart = get("valentines_day_start");
  const vdEnd   = get("valentines_day_end");

  const ikField = get("interest_keywords");
  let interestKeywords = DEFAULT_INTEREST_KEYWORDS;
  if (ikField) {
    try { interestKeywords = JSON.parse(ikField); } catch { /* use default */ }
  }

  // If all individual date fields are empty, fall back to the legacy date_ranges JSON blob
  // so stores that haven't re-saved since the migration don't silently lose their dates.
  if (!mdStart && !mdEnd && !fdStart && !fdEnd && !vdStart && !vdEnd) {
    const blob = get("date_ranges");
    if (blob) {
      try {
        const parsed = JSON.parse(blob);
        return { dateRanges: parsed, interestKeywords };
      } catch { /* use default */ }
    }
  }

  return {
    dateRanges: {
      mothersDay:    mdStart && mdEnd ? { start: mdStart, end: mdEnd } : null,
      fathersDay:    fdStart && fdEnd ? { start: fdStart, end: fdEnd } : null,
      valentinesDay: vdStart && vdEnd ? { start: vdStart, end: vdEnd } : null,
    },
    interestKeywords,
  };
}

export async function getSettings(): Promise<AppSettings> {
  try {
    await ensureDefinitionOnce();
    const data = await shopifyGraphQL<{
      metaobjects: { nodes: ShopifyNode[] };
    }>(LIST_QUERY);
    const node = data.metaobjects.nodes[0];
    if (!node) return DEFAULT_SETTINGS;
    _nodeId = node.id;
    return fieldsToSettings(node.fields);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function persist(settings: AppSettings): Promise<void> {
  const fields = settingsToFields(settings);

  if (_nodeId) {
    const res = await shopifyGraphQL<{
      metaobjectUpdate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
    }>(UPDATE_MUTATION, { id: _nodeId, fields });
    if (res.metaobjectUpdate.userErrors.length > 0) {
      _nodeId = null; // clear stale ID so next call re-queries
      throw new Error(`Shopify save failed: ${res.metaobjectUpdate.userErrors.map((e) => e.message).join(", ")}`);
    }
    return;
  }

  // No cached node ID — query first
  const check = await shopifyGraphQL<{ metaobjects: { nodes: ShopifyNode[] } }>(LIST_QUERY);
  const existing = check.metaobjects.nodes[0] ?? null;
  if (existing) {
    _nodeId = existing.id;
    const res = await shopifyGraphQL<{
      metaobjectUpdate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
    }>(UPDATE_MUTATION, { id: _nodeId, fields });
    if (res.metaobjectUpdate.userErrors.length > 0) {
      _nodeId = null;
      throw new Error(`Shopify save failed: ${res.metaobjectUpdate.userErrors.map((e) => e.message).join(", ")}`);
    }
    return;
  }

  // No node exists yet — try to create it
  const res = await shopifyGraphQL<{
    metaobjectCreate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
  }>(CREATE_MUTATION, { fields });

  if (res.metaobjectCreate.metaobject?.id) {
    _nodeId = res.metaobjectCreate.metaobject.id;
    return;
  }

  // Metaobject type doesn't exist yet — auto-create the definition then retry.
  if (res.metaobjectCreate.userErrors.length > 0) {
    const isTypeMissing = res.metaobjectCreate.userErrors.some(
      (e) => /type|definition/i.test(e.message)
    );
    if (!isTypeMissing) {
      throw new Error(`Shopify save failed: ${res.metaobjectCreate.userErrors.map((e) => e.message).join(", ")}`);
    }

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
        `Could not auto-create the "${METAOBJECT_TYPE}" metaobject definition (${defError}). ` +
        `Please create it manually in Shopify Admin → Settings → Custom data → Metaobjects.`
      );
    }

    const retry = await shopifyGraphQL<{
      metaobjectCreate: { metaobject: { id: string } | null; userErrors: { message: string }[] };
    }>(CREATE_MUTATION, { fields });
    if (retry.metaobjectCreate.metaobject?.id) {
      _nodeId = retry.metaobjectCreate.metaobject.id;
      return;
    }
    throw new Error(`Shopify save failed: ${retry.metaobjectCreate.userErrors.map((e) => e.message).join(", ")}`);
  }
}

// Serialize mutations so concurrent requests don't overwrite each other
let mutationChain: Promise<void> = Promise.resolve();
function serialized(fn: () => Promise<void>): Promise<void> {
  const next = mutationChain.then(fn);
  mutationChain = next.catch(() => {});
  return next;
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return serialized(() => persist(settings));
}
