// src/lib/color.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Colour maths for themes and tier rows. Colours are "#rrggbb" strings.
// ─────────────────────────────────────────────────────────────────────────────

export type Rgb = [red: number, green: number, blue: number];

/** "#ff8000" (or "#f80") → [255, 128, 0]; anything unreadable → grey. */
export function hexToRgb(hex: string): Rgb {
    let digits = String(hex || '#888').replace('#', '');
    if (digits.length === 3) digits = [...digits].map((c) => c + c).join('');
    const n = parseInt(digits.slice(0, 6), 16);
    return Number.isNaN(n) ? [136, 136, 136] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (rgb: readonly number[]): string => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

/** Perceived brightness, 0 (black) to 1 (white). */
export const luminance = (hex: string): number => {
    const [r, g, b] = hexToRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

/** WCAG contrast between two colours: 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
    const linear = (hex: string) => {
        const [r, g, b] = hexToRgb(hex).map((v) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const [light, dark] = [linear(a), linear(b)].sort((x, y) => y - x);
    return (light! + 0.05) / (dark! + 0.05);
}

/** Near-black or white, whichever reads better on this background. */
export const readableTextOn = (hex: string): string => (luminance(hex) * 255 > 145 ? '#111111' : '#ffffff');

/** `a` moved toward `b` by `amount` (0 = a, 1 = b). */
export const mixRgb = (a: string, b: string, amount: number): Rgb => {
    const from = hexToRgb(a);
    const to = hexToRgb(b);
    return from.map((v, i) => Math.round(v * (1 - amount) + to[i]! * amount)) as Rgb;
};

/** A "#rrggbb" colour (the only form stored in lists and themes). */
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
