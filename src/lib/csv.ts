// src/lib/csv.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Comma-separated values, as spreadsheets write them (RFC 4180): quoted cells
//  may hold commas, quotes ("") and line breaks. Reading is capped, since the
//  file comes from outside.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ROWS = 5_000;
const MAX_CELLS_PER_ROW = 50;

/**
 * One cell, ready to write. Quoted when it has to be; a leading = + - @ gets a ' so spreadsheet
 * apps show it as text instead of running it as a formula ("CSV injection").
 */
export function csvCell(value: string): string {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]|^\s|\s$/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The separator a file uses. Excel writes ";" where the decimal mark is a comma (most of Europe),
 * and tabs come from copying cells, so the first line decides.
 */
export function detectSeparator(text: string): string {
    const firstLine = text.slice(0, text.search(/\r|\n|$/));
    const count = (separator: string) => firstLine.split(separator).length;
    return [',', ';', '\t'].reduce((best, separator) => (count(separator) > count(best) ? separator : best));
}

/** Text from a CSV file's bytes: UTF-8, or Windows-1252 (what Excel saves on Windows) when it isn't valid UTF-8. */
export function decodeCsvBytes(bytes: Uint8Array): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('windows-1252').decode(bytes);
    }
}

/** Reads CSV text into rows of cells. Blank lines are skipped; a byte-order mark is ignored. */
export function parseCsv(text: string, separator = ','): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    const endCell = () => {
        if (row.length < MAX_CELLS_PER_ROW) row.push(cell);
        cell = '';
    };
    const endRow = () => {
        endCell();
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
    };
    const source = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length && rows.length < MAX_ROWS; i++) {
        const char = source[i]!;
        if (quoted) {
            if (char !== '"') cell += char;
            else if (source[i + 1] === '"') {
                cell += '"';
                i++;
            } else quoted = false;
        } else if (char === '"' && !cell) quoted = true;
        else if (char === separator) endCell();
        else if (char === '\n' || char === '\r') {
            if (char === '\r' && source[i + 1] === '\n') i++;
            endRow();
        } else cell += char;
    }
    if (cell || row.length) endRow();
    return rows;
}

/** Undoes csvCell's formula guard: "'=SUM" read back is "=SUM" again. */
export const unguardCell = (value: string): string => (/^'[=+\-@]/.test(value) ? value.slice(1) : value);
