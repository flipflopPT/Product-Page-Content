import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const SCOPES = "read_products,write_products,read_files,write_files,read_metaobjects,write_metaobjects,write_metaobject_definitions";
const ALLOWED_SHOP = "penelopetom-office.myshopify.com";

export async function GET(req: NextRequest) {
  const shop = req.nextUrl.searchParams.get("shop");
  if (!shop) return new NextResponse("Missing ?shop=", { status: 400 });
  if (shop !== ALLOWED_SHOP) return new NextResponse("Unauthorized store", { status: 403 });

  const state = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${req.nextUrl.origin}/api/auth/callback`;

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authUrl.searchParams.set("client_id", process.env.SHOPIFY_CLIENT_ID!);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set("shopify_oauth_state", state, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
