// src/lib/checks.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Checks for data that comes from outside the code (files, browser storage,
//  websites): is it really the shape I expect before I use it?
// ─────────────────────────────────────────────────────────────────────────────

/** A plain object (not null, not an array). */
export const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

// ── reading JSON from websites (any field can be missing or the wrong type) ──

/** Follows a path into parsed JSON: dig(answer, 'data', 'Page', 'media'); undefined if any step is missing. */
export function dig(value: unknown, ...path: (string | number)[]): unknown {
    let current = value;
    for (const step of path) {
        if (Array.isArray(current) && typeof step === 'number') current = current[step];
        else if (isRecord(current) && typeof step === 'string') current = current[step];
        else return undefined;
    }
    return current;
}

/** Text, or '' (numbers become text). */
export const asText = (value: unknown): string =>
    typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

/** A finite number, or 0 (numeric text is read as a number). */
export const asNumber = (value: unknown): number => {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : 0;
};

/** The array, or [] if it isn't one. */
export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
