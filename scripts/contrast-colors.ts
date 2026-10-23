/**
 * Token values as the contrast check sees them on screen: a hex color, a `var(--x)` reference
 * (resolved against the composed tokens, as the browser does on :root), or a translucent wash
 * `color-mix(in srgb, <color> N%, transparent)` (the color at N % opacity), laid over an opaque
 * token before its contrast is measured.
 */

export interface Rgba {
  rgb: [number, number, number];
  alpha: number;
}

export function parseHex(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex color: ${color}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

const WASH = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/;

export function resolveColor(value: string, tokens: Record<string, string>, depth = 0): Rgba {
  if (depth > 8) throw new Error(`Token references loop at ${value}`);
  const text = value.trim();
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(text);
  if (reference) {
    const next = tokens[reference[1] as string];
    if (next === undefined) throw new Error(`Missing token ${reference[1]}`);
    return resolveColor(next, tokens, depth + 1);
  }
  const wash = WASH.exec(text);
  if (wash) {
    const base = resolveColor(wash[1] as string, tokens, depth + 1);
    return { rgb: base.rgb, alpha: (base.alpha * Number(wash[2])) / 100 };
  }
  return { rgb: parseHex(text), alpha: 1 };
}

/** The color as opaque hex: a translucent one is laid over `under` (normal blending). */
export function opaqueHex(color: Rgba, under?: Rgba): string {
  if (color.alpha < 1 && (!under || under.alpha < 1)) {
    throw new Error('A translucent color needs an opaque color under it');
  }
  const base = under?.rgb ?? [0, 0, 0];
  const rgb = color.rgb.map((c, i) => c * color.alpha + (base[i] ?? 0) * (1 - color.alpha));
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}
