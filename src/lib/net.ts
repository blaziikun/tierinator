// src/lib/net.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Asking other websites for JSON (search APIs, wikis) or files (pictures).
//  Answers are `unknown`: read them with the checks in lib/checks.ts, never
//  trust their shape, and never wait on a slow site for ever.
// ─────────────────────────────────────────────────────────────────────────────

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetches JSON; throws on HTTP errors, and after `timeoutMs` if given. Sends no referrer. */
export async function getJSON(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<unknown> {
    const abort = new AbortController();
    const timer = timeoutMs ? setTimeout(() => abort.abort(), timeoutMs) : undefined;
    try {
        const response = await fetch(url, { referrerPolicy: 'no-referrer', ...init, signal: abort.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Downloads a file, at most `maxBytes` of it, within `timeoutMs`. The body is read as it arrives, so
 * a site that sends no length (or lies about it) is cut off at the limit instead of filling memory.
 */
export async function getBytes(
    url: string,
    { maxBytes, timeoutMs }: { maxBytes: number; timeoutMs: number },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string }> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
        const response = await fetch(url, { referrerPolicy: 'no-referrer', signal: abort.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('file too large');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('no body');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                abort.abort();
                throw new Error('file too large');
            }
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, at);
            at += chunk.byteLength;
        }
        return { bytes, contentType: response.headers.get('content-type') || '' };
    } finally {
        clearTimeout(timer);
    }
}
