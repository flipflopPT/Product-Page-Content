import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";

export function proxy(req: NextRequest) {
  if (process.env.APP_ENABLED !== "true") {
    return new NextResponse("Service Unavailable", { status: 503 });
  }

  const { pathname } = req.nextUrl;

  // Rate limit API requests
  if (pathname.startsWith("/api/")) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const { limited, retryAfter } = rateLimit(`api:${ip}`, 100, 60 * 1000);
    if (limited) {
      return NextResponse.json(
        { error: "Too Many Requests" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }
  }

  // CSRF protection for mutating API requests — Origin only, no Referer fallback
  if (pathname.startsWith("/api/") && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");

    if (!host) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const allowed = host.replace(/:\d+$/, "");
    const originHost = origin ? new URL(origin).hostname : null;
    const isTrusted = originHost === allowed || originHost === "admin.shopify.com";

    if (!originHost || !isTrusted) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next|favicon\\.ico|icons).*)" ],
};
