import * as fs from "fs";
import * as path from "path";

export interface IconEntry {
  name: string;
  type: "builtin" | "uploaded";
  url?: string;
}

// Returns icon names from /public/icons/ at build/request time
export function getBuiltinIcons(): string[] {
  try {
    const iconsDir = path.join(process.cwd(), "public", "icons");
    return fs
      .readdirSync(iconsDir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace(".svg", ""))
      .sort();
  } catch {
    return [];
  }
}

// Reads an SVG file from /public/icons/ and returns its contents
export function getBuiltinSvg(name: string): string | null {
  try {
    const filePath = path.join(process.cwd(), "public", "icons", `${name}.svg`);
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function minifySvg(svg: string): string {
  return svg.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

// When writing a bullet's icon to a metafield:
// - builtin names → resolve to minified SVG string so the theme can output inline
// - existing SVG strings (id="name" attribute) → re-resolve from current file so updates propagate
// - CDN URLs → store the URL as-is (theme renders as <img>)
export function resolveIconForMetafield(icon: string): string {
  if (!icon) return icon;
  if (icon.startsWith("https://")) return icon;

  // If value is already an SVG string, resolve back to the current file
  if (icon.startsWith("<svg")) {
    // 1. Try id attribute (present on icons saved after the id-attribute update)
    const idMatch = icon.match(/\bid="([^"]+)"/);
    if (idMatch) {
      const svg = getBuiltinSvg(idMatch[1]);
      if (svg) return minifySvg(svg);
    }

    // 2. Fingerprint lookup for legacy SVGs saved before id attributes were added.
    //    Each entry is a unique path fragment from the v1 icon → current icon name.
    const LEGACY_FINGERPRINTS: Array<[string, string]> = [
      ['cy="6" r="3"',                        'baby'],       // v1: person silhouette head at cy=6
      ['height="11" rx="1"',                  'briefcase'],  // v1: wrong rect dimensions
      ['M18.37 2.63 14 7l-1.59',              'brush'],      // v1: different brush path
      ['M12 2a4 4 0 0 1 4 4',                 'flower'],     // v1: 4-circle petal design
      ['M8 8c0 2.2-1.3 4-3 4.5',             'fork'],       // v1: different fork structure
      ['M20.84 4.61a5.5 5.5',                 'heart'],      // v1: older heart path
      ['cx="8" cy="14" r="6"',                'rings'],      // v1: circles at y=14/y=10
      ['M9.937 15.5A2 2 0 0 0 8.5 14.063',   'sparkle'],    // v1: different sparkle design
      ['M12 2l3.09 6.26',                     'star'],       // v1: path-based star
    ];
    for (const [fragment, name] of LEGACY_FINGERPRINTS) {
      if (icon.includes(fragment)) {
        const svg = getBuiltinSvg(name);
        if (svg) return minifySvg(svg);
      }
    }

    return icon; // unrecognised SVG — leave as-is
  }

  // Plain icon name
  const svg = getBuiltinSvg(icon);
  if (!svg) return icon;
  return minifySvg(svg);
}
