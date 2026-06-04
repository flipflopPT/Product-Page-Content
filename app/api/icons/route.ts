import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getBuiltinIcons } from "@/lib/icons";
import { getUploadedIcons, addUploadedIcon } from "@/lib/uploaded-icons-store";

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  const [uploaded] = await Promise.all([getUploadedIcons()]);
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

  // Strip dangerous SVG content: script elements, event handlers, javascript: URIs, foreignObject
  const svg = rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "")
    .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, "")
    .replace(/xlink:href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, "");

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

  await addUploadedIcon({ name, svg });
  return NextResponse.json({ name, svg });
}
