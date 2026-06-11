const domain = process.env.SHOPIFY_STORE_DOMAIN!;
const token = process.env.SHOPIFY_ACCESS_TOKEN!;
const API_VERSION = "2025-10";

async function doRequest(query: string, variables?: Record<string, unknown>): Promise<Response> {
  return fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const MAX_ATTEMPTS = 4;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await doRequest(query, variables);

    // HTTP-level rate limit — honour Retry-After header (cap at 8s)
    if (res.status === 429) {
      if (attempt < MAX_ATTEMPTS) {
        const retryAfter = Math.min(parseFloat(res.headers.get("Retry-After") ?? "1"), 8);
        await sleep(retryAfter * 1000);
        continue;
      }
      throw new Error("Shopify API rate limit exceeded after retries");
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
      throw new Error(`Shopify API error: ${res.status} ${res.statusText} (url: ${url})${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }

    const json = await res.json();

    // GraphQL-level throttle (HTTP 200 but errors[].extensions.code === "THROTTLED")
    const isThrottled = json.errors?.some(
      (e: { extensions?: { code?: string } }) => e.extensions?.code === "THROTTLED"
    );
    if (isThrottled) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1500 * attempt); // 1.5s, 3s, 4.5s
        continue;
      }
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
    }

    // Other fatal GraphQL errors (no data at all)
    if (json.errors && !json.data) {
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
    }

    return json.data as T;
  }

  throw new Error("Shopify GraphQL: max retries exceeded");
}
