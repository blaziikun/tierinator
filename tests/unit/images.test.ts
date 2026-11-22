// Pictures are hostile until checked: the type comes from the bytes, and a picture's
// size is read from its header before anything is decoded.
import { describe, expect, it } from 'vitest';
import { headerSize, shrunkSize, sniffImageType } from '../../src/lib/images';

/** The first bytes of a PNG claiming this size (signature, IHDR length and type, width, height). */
function pngHeader(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

describe('what a picture really is', () => {
    it('reads the type from the bytes', () => {
        expect(sniffImageType(pngHeader(1, 1))).toBe('png');
        expect(sniffImageType(new TextEncoder().encode('GIF89a\u0001\u0000'))).toBe('gif');
        expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe('svg');
        expect(sniffImageType(new TextEncoder().encode('<!doctype html><html>'))).toBeNull();
    });

    it('reads the size from the header without decoding', () => {
        expect(headerSize(pngHeader(96, 96), 'png')).toEqual({ width: 96, height: 96 });
        expect(headerSize(pngHeader(60_000, 60_000), 'png')).toEqual({ width: 60_000, height: 60_000 });
        const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
        expect(headerSize(gif, 'gif')).toEqual({ width: 320, height: 240 });
        // a JPEG: start, one APP0 segment, then the frame header (SOF0) with height 480 and width 640
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03]);
        expect(headerSize(jpeg, 'jpg')).toEqual({ width: 640, height: 480 });
        expect(headerSize(new Uint8Array(4), 'png')).toBeNull();
    });
});

describe('smaller copies of uploads', () => {
    it('shrinks the longest side to the limit and keeps the shape', () => {
        expect(shrunkSize(2000, 1500, 1024)).toEqual({ width: 1024, height: 768 });
        expect(shrunkSize(600, 2000, 1024)).toEqual({ width: 307, height: 1024 });
        expect(shrunkSize(50_000, 10, 1024)).toEqual({ width: 1024, height: 1 }); // never 0 pixels
    });

    it('leaves pictures that already fit, or have no size, alone', () => {
        expect(shrunkSize(1024, 1024, 1024)).toBeNull();
        expect(shrunkSize(96, 96, 1024)).toBeNull();
        expect(shrunkSize(0, 0, 1024)).toBeNull();
        expect(shrunkSize(Number.NaN, 2000, 1024)).toBeNull();
    });
});
