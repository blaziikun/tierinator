// src/lib/link-data.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Packing JSON into a link and back: compressed (deflate, built into browsers)
//  and written in the URL-safe base64 alphabet. Unpacking is limited, so a crafted
//  link can't make the page inflate gigabytes.
// ─────────────────────────────────────────────────────────────────────────────

/** Turns any JSON value into a short-ish string that's safe to put after "#" in a link. */
export async function packForLink(value: unknown): Promise<string> {
    const json = new TextEncoder().encode(JSON.stringify(value));
    const packed = (await readAll(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw')), Infinity))!;
    let binary = '';
    for (const byte of packed) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The JSON value from packForLink, or null if the text isn't one (or unpacks to more than maxBytes). */
export async function unpackFromLink(text: string, maxBytes: number): Promise<unknown> {
    try {
        if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        const json = await readAll(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')), maxBytes);
        return json ? JSON.parse(new TextDecoder().decode(json)) : null;
    } catch {
        return null;
    }
}

/** Every byte of a stream, or null once it passes maxBytes. */
async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            return null;
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return all;
}
