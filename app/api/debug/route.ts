import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify";

const TYPE = "pdp_library_edits";

const QUERY = `
  query {
    metaobjects(type: "${TYPE}", first: 5) {
      nodes { id fields { key value } }
    }
  }
`;

export async function GET() {
  try {
    const data = await shopifyGraphQL<{
      metaobjects: { nodes: { id: string; fields: { key: string; value: string }[] }[] };
    }>(QUERY);
    const nodes = data.metaobjects.nodes;
    const result = nodes.map((n) => {
      const field = n.fields.find((f) => f.key === "edits_json");
      let parsed: unknown = null;
      try { parsed = field?.value ? JSON.parse(field.value) : null; } catch {}
      return { id: n.id, parsed };
    });
    return NextResponse.json({ nodeCount: nodes.length, nodes: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
