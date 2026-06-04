import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN ?? "";
const SHOPIFY_CLIENT_ID = process.env.SHOPIFY_CLIENT_ID ?? "";


export async function verifySessionToken(token: string) {
  if (!SHOPIFY_CLIENT_SECRET) {
    if (process.env.NODE_ENV === "production") throw new Error("SHOPIFY_CLIENT_SECRET is required in production");
    throw new Error("SHOPIFY_CLIENT_SECRET not configured");
  }

  const secret = new TextEncoder().encode(SHOPIFY_CLIENT_SECRET);
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });

  const expectedIss = `https://${SHOPIFY_STORE_DOMAIN}/admin`;
  if (payload.iss !== expectedIss) throw new Error(`Invalid issuer: ${payload.iss}`);
  if (payload.aud !== SHOPIFY_CLIENT_ID) throw new Error("Invalid audience");

  const dest = payload.dest as string | undefined;
  if (dest && !dest.startsWith(`https://${SHOPIFY_STORE_DOMAIN}`)) {
    throw new Error("Invalid destination");
  }

  return payload;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function requireAuth(_req: NextRequest): Promise<NextResponse | null> {
  // Auth is handled at the Shopify Admin embed layer and by CSRF protection in proxy.ts.
  return null;
}
