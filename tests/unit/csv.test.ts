// CSV both ways: spreadsheets' quoting rules, the formula guard, and reading a list back.
import { describe, expect, it } from 'vitest';
import { readCsvRows } from '../../src/core/csv-format';
import { csvCell, decodeCsvBytes, detectSeparator, parseCsv, unguardCell } from '../../src/lib/csv';

describe('writing a cell', () => {
    it('quotes only when it has to', () => {
        expect(csvCell('Pikachu')).toBe('Pikachu');
        expect(csvCell('Mr. Mime, Galar')).toBe('"Mr. Mime, Galar"');
        expect(csvCell('The "best" one')).toBe('"The ""best"" one"');
        expect(csvCell('two\nlines')).toBe('"two\nlines"');
    });

    it('keeps spreadsheets from running a cell as a formula, and reading undoes it', () => {
        for (const sneaky of ['=HYPERLINK("https://x.example")', '+1+1', '-2', '@SUM(A1)']) {
            const written = csvCell(sneaky);
            expect(written.replace(/^"|"$/g, '').replaceAll('""', '"').startsWith("'")).toBe(true);
            expect(unguardCell(parseCsv(written)[0]![0]!)).toBe(sneaky);
        }
    });
});

describe('reading', () => {
    it('handles quotes, commas, line breaks, CRLF, a byte-order mark and blank lines', () => {
        const text = '﻿Name,Tier\r\n"Mr. Mime, Galar",S\r\n\r\n"Line\nbreak","A ""quoted"" tier"\n';
        expect(parseCsv(text)).toEqual([
            ['Name', 'Tier'],
            ['Mr. Mime, Galar', 'S'],
            ['Line\nbreak', 'A "quoted" tier'],
        ]);
    });

    it('reads the columns Export writes, in any order and case', () => {
        const rows = readCsvRows(
            'picture,NAME,position,tier\nhttps://img.example/a.png,Alpha,2,S\n,Beta,1,S\nhttp://plain.example/c.png,Gamma,,\n',
        );
        expect(rows).toEqual([
            { name: 'Alpha', tier: 'S', position: 2, picture: 'https://img.example/a.png' },
            { name: 'Beta', tier: 'S', position: 1, picture: undefined },
            { name: 'Gamma', tier: '', position: Number.POSITIVE_INFINITY, picture: undefined }, // only https pictures
        ]);
    });

    it('reads a plain list of names when there is no header', () => {
        expect(readCsvRows('Spirited Away\nAkira\n\nYour Name').map((row) => row.name)).toEqual(['Spirited Away', 'Akira', 'Your Name']);
    });

    it('reads what Excel saves in Europe (semicolons, Windows-1252) as well as UTF-8', () => {
        expect(detectSeparator('Tier;Position;Name\nS;1;Pikachu')).toBe(';');
        expect(detectSeparator('Name\tTier')).toBe('\t');
        expect(detectSeparator('Just one column')).toBe(',');
        expect(readCsvRows('Tier;Position;Name\r\nS;1;Flabébé').map((row) => [row.tier, row.name])).toEqual([['S', 'Flabébé']]);
        expect(decodeCsvBytes(new Uint8Array([0x46, 0x6c, 0x61, 0x62, 0xe9, 0x62, 0xe9]))).toBe('Flabébé'); // Windows-1252
        expect(decodeCsvBytes(new TextEncoder().encode('Flabébé'))).toBe('Flabébé');
    });

    it('caps what a hostile file can make it do', () => {
        const huge = `Name\n${'x'.repeat(5000)}\n${Array.from({ length: 30_000 }, (_, i) => `item ${i}`).join('\n')}`;
        const rows = readCsvRows(huge);
        expect(rows[0]!.name.length).toBe(80);
        expect(rows.length).toBeLessThanOrEqual(5_000);
    });
});
