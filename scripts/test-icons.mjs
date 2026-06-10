import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function getBuiltinSvg(name) {
  try { return fs.readFileSync(path.join(root, 'public/icons', name + '.svg'), 'utf-8'); }
  catch { return null; }
}

function minifySvg(svg) {
  return svg.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function resolveIconForMetafield(icon) {
  if (!icon) return icon;
  if (icon.startsWith('https://')) return icon;

  if (icon.startsWith('<svg')) {
    const idMatch = icon.match(/\bid="([^"]+)"/);
    if (idMatch) {
      const svg = getBuiltinSvg(idMatch[1]);
      if (svg) return minifySvg(svg);
    }
    const LEGACY = [
      ['cy="6" r="3"',                      'baby'],
      ['height="11" rx="1"',                'briefcase'],
      ['M18.37 2.63 14 7l-1.59',            'brush'],
      ['M12 2a4 4 0 0 1 4 4',               'flower'],
      ['M8 8c0 2.2-1.3 4-3 4.5',           'fork'],
      ['M20.84 4.61a5.5 5.5',               'heart'],
      ['cx="8" cy="14" r="6"',              'rings'],
      ['M9.937 15.5A2 2 0 0 0 8.5 14.063', 'sparkle'],
      ['M12 2l3.09 6.26',                   'star'],
    ];
    for (const [frag, name] of LEGACY) {
      if (icon.includes(frag)) {
        const svg = getBuiltinSvg(name);
        if (svg) return minifySvg(svg);
      }
    }
    return icon;
  }

  const svg = getBuiltinSvg(icon);
  if (!svg) return icon;
  return minifySvg(svg);
}

// --- Tests ---
// 1. Plain name
const r1 = resolveIconForMetafield('baby');
console.log('1. Plain "baby" → has id=baby:', r1.includes('id="baby"'));
console.log('   → has new path (M9 12h.01):', r1.includes('M9 12h.01'));

// 2. Old baby SVG (legacy fingerprint)
const oldBaby = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"> <circle cx="12" cy="6" r="3"/> <path d="M6 21v-2a6 6 0 0 1 12 0v2"/> </svg>`;
const r2 = resolveIconForMetafield(oldBaby);
console.log('2. Old baby SVG → has id=baby:', r2.includes('id="baby"'));
console.log('   → has new path (M9 12h.01):', r2.includes('M9 12h.01'));

// 3. Old rings SVG
const oldRings = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"> <circle cx="8" cy="14" r="6"/> <circle cx="16" cy="10" r="6"/> </svg>`;
const r3 = resolveIconForMetafield(oldRings);
console.log('3. Old rings SVG → has id=rings:', r3.includes('id="rings"'));
console.log('   → has new circles (cx="8.5"):', r3.includes('cx="8.5"'));
