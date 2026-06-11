import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getBuiltinIcons } from "@/lib/icons";
import {
  getUploadedIcons,
  addUploadedIcon,
  renameUploadedIcon,
  deleteUploadedIcon,
} from "@/lib/uploaded-icons-store";
import { findIconUsage, getUsedBuiltinIconNames } from "@/lib/icon-usage";
import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DOMPurify = createDOMPurify(new JSDOM("").window as any);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  // ?builtinUsage=true → return which built-in icons are in use
  if (req.nextUrl.searchParams.get("builtinUsage") === "true") {
    const used = await getUsedBuiltinIconNames();
    return NextResponse.json({ usedBuiltins: Array.from(used) });
  }

  // ?check=iconname → return usage info for that icon
  const check = req.nextUrl.searchParams.get("check");
  if (check) {
    const uploaded = await getUploadedIcons();
    const icon = uploaded.find((i) => i.name === check);
    if (!icon) return NextResponse.json({ error: "Icon not found" }, { status: 404 });
    const usage = await findIconUsage(icon.svg);
    return NextResponse.json(usage);
  }

  const uploaded = await getUploadedIcons();
  return NextResponse.json({ builtIn: getBuiltinIcons(), uploaded });
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file || !file.name.toLowerCase().endsWith(".svg")) {
    return NextResponse.json({ error: "An SVG file is required" }, { status: 400 });
  }

  const rawSvg = await file.text();
  if (!rawSvg.includes("<svg")) {
    return NextResponse.json({ error: "File does not appear to be a valid SVG" }, { status: 400 });
  }

  const svg = DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });

  if (!svg) {
    return NextResponse.json({ error: "SVG file contains unsafe content and could not be sanitised" }, { status: 400 });
  }

  const name = file.name
    .replace(/\.svg$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!name) {
    return NextResponse.json({ error: "Could not derive a valid name from the filename" }, { status: 400 });
  }

  const builtIn = getBuiltinIcons();
  if (builtIn.includes(name)) {
    return NextResponse.json({ error: `"${name}" conflicts with a built-in icon name` }, { status: 400 });
  }

  try {
    await addUploadedIcon({ name, svg });
  } catch (e) {
    return NextResponse.json(
      { error: (e instanceof Error ? e.message : null) ?? "Failed to save icon" },
      { status: 500 }
    );
  }
  return NextResponse.json({ name, svg });
}

export async function PATCH(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const { oldName, newName } = (await req.json()) as {
    oldName?: string;
    newName?: string;
  };

  if (!oldName || !newName) {
    return NextResponse.json({ error: "oldName and newName are required" }, { status: 400 });
  }

  const sanitized = newName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!sanitized) {
    return NextResponse.json(
      { error: "Invalid name — use letters, numbers, and hyphens only" },
      { status: 400 }
    );
  }

  const builtIn = getBuiltinIcons();
  if (builtIn.includes(sanitized)) {
    return NextResponse.json(
      { error: `"${sanitized}" conflicts with a built-in icon name` },
      { status: 400 }
    );
  }

  const existing = await getUploadedIcons();
  if (sanitized !== oldName && existing.some((i) => i.name === sanitized)) {
    return NextResponse.json(
      { error: `"${sanitized}" is already in use by another icon` },
      { status: 400 }
    );
  }

  try {
    await renameUploadedIcon(oldName, sanitized);
    return NextResponse.json({ name: sanitized });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Rename failed";
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const name = req.nextUrl.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const existing = await getUploadedIcons();
  const icon = existing.find((i) => i.name === name);
  if (!icon) return NextResponse.json({ error: "Icon not found" }, { status: 404 });

  const { products, phrases } = await findIconUsage(icon.svg);
  if (products.length > 0 || phrases.length > 0) {
    return NextResponse.json({ error: "in-use", products, phrases }, { status: 409 });
  }

  try {
    await deleteUploadedIcon(name);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
