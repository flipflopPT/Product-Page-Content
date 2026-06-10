import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT } from "jose";
import type { requireAuth as RequireAuthFn } from "@/lib/auth";
import { NextRequest } from "next/server";

const SECRET = "test-secret-at-least-32-chars-long!!";
const STORE = "test.myshopify.com";
const CLIENT_ID = "test-client-id";

async function makeToken(overrides: {
  iss?: string;
  aud?: string;
  exp?: number;
} = {}) {
  const iss = overrides.iss ?? `https://${STORE}/admin`;
  const aud = overrides.aud ?? CLIENT_ID;

  const jwt = new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt();

  if (overrides.exp !== undefined) {
    jwt.setExpirationTime(overrides.exp);
  } else {
    jwt.setExpirationTime("1h");
  }

  return jwt.sign(new TextEncoder().encode(SECRET));
}

// The auth module reads env vars at module-load time, so we must
// vi.resetModules() + dynamically import for each test.
let requireAuth: typeof RequireAuthFn;

beforeEach(async () => {
  process.env.SHOPIFY_CLIENT_SECRET = SECRET;
  process.env.SHOPIFY_STORE_DOMAIN = STORE;
  process.env.SHOPIFY_CLIENT_ID = CLIENT_ID;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const mod = await import("@/lib/auth");
  requireAuth = mod.requireAuth;
});

afterEach(() => {
  delete process.env.SHOPIFY_CLIENT_SECRET;
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_CLIENT_ID;
});

describe("requireAuth — JWT validation", () => {
  it("returns null for a valid shopify token", async () => {
    const token = await makeToken();
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await requireAuth(req)).toBeNull();
  });

  it("returns 401 for token with wrong issuer", async () => {
    const token = await makeToken({ iss: "https://evil.myshopify.com/admin" });
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await requireAuth(req))?.status).toBe(401);
  });

  it("returns 401 for token with wrong audience", async () => {
    const token = await makeToken({ aud: "wrong-client" });
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await requireAuth(req))?.status).toBe(401);
  });

  it("returns 401 for an expired token", async () => {
    const token = await makeToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await requireAuth(req))?.status).toBe(401);
  });

  it("returns 401 when SHOPIFY_CLIENT_SECRET is not set", async () => {
    delete process.env.SHOPIFY_CLIENT_SECRET;
    vi.resetModules();
    const { requireAuth: freshRequireAuth } = await import("@/lib/auth");
    const token = await makeToken();
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect((await freshRequireAuth(req))?.status).toBe(401);
  });
});

describe("requireAuth", () => {
  it("returns null (authorised) in development mode", async () => {
    process.env.NODE_ENV = "development";
    vi.resetModules();
    const { requireAuth: devRequireAuth } = await import("@/lib/auth");
    const req = new NextRequest("http://localhost/api/test");
    const result = await devRequireAuth(req);
    expect(result).toBeNull();
  });

  it("returns 401 when no authorization header", async () => {
    const req = new NextRequest("http://localhost/api/test");
    const result = await requireAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: "Bearer not-a-valid-jwt" },
    });
    const result = await requireAuth(req);
    expect(result!.status).toBe(401);
  });

  it("returns null (authorised) for a valid token", async () => {
    const token = await makeToken();
    const req = new NextRequest("http://localhost/api/test", {
      headers: { authorization: `Bearer ${token}` },
    });
    const result = await requireAuth(req);
    expect(result).toBeNull();
  });
});
