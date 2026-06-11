import { shopifyGraphQL } from "./shopify";

const METAOBJECT_TYPE = "pdp_quality_report";

const LIST_QUERY = `
  query GetQualityReport {
    metaobjects(type: "${METAOBJECT_TYPE}", first: 1) {
      nodes { id fields { key value } }
    }
  }
`;

const CREATE_MUTATION = `
  mutation CreateQualityReport($fields: [MetaobjectFieldInput!]!) {
    metaobjectCreate(metaobject: { type: "${METAOBJECT_TYPE}", handle: "main", fields: $fields }) {
      userErrors { field message }
    }
  }
`;

const UPDATE_MUTATION = `
  mutation UpdateQualityReport($id: ID!, $fields: [MetaobjectFieldInput!]!) {
    metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
      userErrors { field message }
    }
  }
`;

export interface SavedQualityReport {
  timestamp: string;
  flagged: unknown[];
  checkedTotal: number;
  filters: Record<string, unknown>;
}

async function getExistingNode(): Promise<{ id: string; fields: { key: string; value: string }[] } | null> {
  const data = await shopifyGraphQL<{
    metaobjects: { nodes: { id: string; fields: { key: string; value: string }[] }[] };
  }>(LIST_QUERY);
  return data.metaobjects.nodes[0] ?? null;
}

export async function getSavedReport(): Promise<SavedQualityReport | null> {
  try {
    const node = await getExistingNode();
    if (!node) return null;
    const field = node.fields.find((f) => f.key === "report_data");
    if (!field?.value) return null;
    const parsed = JSON.parse(field.value);
    if (!parsed?.timestamp) return null;
    return parsed as SavedQualityReport;
  } catch {
    return null;
  }
}

export async function saveReport(report: SavedQualityReport): Promise<void> {
  const fields = [{ key: "report_data", value: JSON.stringify(report) }];
  const node = await getExistingNode();
  if (node) {
    const res = await shopifyGraphQL<{ metaobjectUpdate: { userErrors: { message: string }[] } }>(UPDATE_MUTATION, { id: node.id, fields });
    if (res.metaobjectUpdate.userErrors.length > 0) {
      throw new Error(res.metaobjectUpdate.userErrors[0].message);
    }
  } else {
    const res = await shopifyGraphQL<{ metaobjectCreate: { userErrors: { message: string }[] } }>(CREATE_MUTATION, { fields });
    if (res.metaobjectCreate.userErrors.length > 0) {
      throw new Error(res.metaobjectCreate.userErrors[0].message);
    }
  }
}

export async function clearSavedReport(): Promise<void> {
  const fields = [{ key: "report_data", value: "" }];
  const node = await getExistingNode();
  if (node) {
    await shopifyGraphQL(UPDATE_MUTATION, { id: node.id, fields });
  }
}
