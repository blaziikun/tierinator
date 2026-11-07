import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, isHexColor, mixRgb, readableTextOn, rgbToHex } from '../../src/lib/color';

describe('colours', () => {
    it('converts between hex and rgb', () => {
        expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
        expect(hexToRgb('#f80')).toEqual([255, 136, 0]);
        expect(hexToRgb('nonsense')).toEqual([136, 136, 136]);
        expect(rgbToHex([255, 128, 0])).toBe('#ff8000');
    });
    it('picks readable text', () => {
        expect(readableTextOn('#ffffff')).toBe('#111111');
        expect(readableTextOn('#000000')).toBe('#ffffff');
    });
    it('mixes', () => expect(mixRgb('#000000', '#ffffff', 0.5)).toEqual([128, 128, 128]));
    it('measures contrast the WCAG way', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
        expect(contrastRatio('#777777', '#777777')).toBe(1);
        expect(contrastRatio('#222222', '#000000')).toBeLessThan(3);
    });
    it('only accepts #rrggbb', () => {
        for (const ok of ['#000000', '#AbCdEf']) expect(isHexColor(ok)).toBe(true);
        for (const bad of ['red', '#fff', '#12345g', 'url(x)', 7, null, undefined]) expect(isHexColor(bad)).toBe(false);
    });
});
