// Per-tenant presentation values (currency, accent colour). Plain module state so non-React code such as formatMoney can read it.
export type Currency = "INR" | "USD" | "EUR" | "GBP";
export const CURRENCIES: Currency[] = ["INR", "USD", "EUR", "GBP"];

let currency: Currency = "INR";
export const getCurrency = (): Currency => currency;
export const setCurrency = (c: string | undefined) => { currency = CURRENCIES.includes(c as Currency) ? (c as Currency) : "INR"; };

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MIN_CONTRAST = 4.5;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of a #rrggbb colour. */
export const luminance = (hex: string) => { const [r, g, b] = rgb(hex); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
/** WCAG contrast ratio (1 to 21) between two #rrggbb colours. */
export const contrastRatio = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
/** White text on this background; the accent must reach 4.5:1 so buttons stay readable. */
export const contrastWithWhite = (hex: string) => contrastRatio(hex, "#ffffff");
export const accentHasContrast = (hex: string) => HEX_RE.test(hex) && contrastWithWhite(hex) >= MIN_CONTRAST;

/** "#rrggbb" to [h (0-360), s (0-100), l (0-100)]. */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  if (d === 0) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
}
const hslToHex = (h: number, s: number, l: number) => {
  const S = s / 100, L = l / 100, k = (n: number) => (n + h / 30) % 12, a = S * Math.min(L, 1 - L);
  const f = (n: number) => Math.round(255 * (L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

/** CSS variable value in the form the stylesheet uses: "H S% L%". */
export const hexToHslVar = (hex: string) => { const [h, s, l] = hexToHsl(hex); return `${h} ${s}% ${l}%`; };

/**
 * Lighter variant for dark mode, where the page text on the accent is near black.
 * Raises lightness until that dark text reaches 4.5:1.
 */
export function darkModeVariant(hex: string, text = "#0c0716") {
  const [h, s, l] = hexToHsl(hex);
  let light = Math.max(l, 62);
  let out = hslToHex(h, s, light);
  while (contrastRatio(out, text) < MIN_CONTRAST && light < 95) { light += 2; out = hslToHex(h, s, light); }
  return hexToHslVar(out);
}
