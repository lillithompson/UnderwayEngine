// ── Deflate compression wrapper for .tile files ────────────────────
//
// Uses the browser-native CompressionStream / DecompressionStream API
// (available in Chrome 80+, Safari 16.4+, Node 18+, React Native WebView).
//
// Implementation note: the reader is started *before* the writes, so it is
// already pulling when bytes arrive at the transform. We then `await` both
// `write()` and `close()` so the readable cannot be closed until the
// transform has flushed every byte. Driving `write()`/`close()` without
// awaiting (or wrapping via `new Response(uint8).body.pipeThrough(...)`)
// races the readable closing on WebKit for large payloads — the reader can
// resolve `{done: true}` on a truncated-but-well-formed Uint8Array,
// surfacing as cryptic DataView range errors deep in deserialization.

async function streamToBytes(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function compressTile(payload: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const result = streamToBytes(cs.readable as ReadableStream<Uint8Array>);
  await writer.write(payload as unknown as BufferSource);
  await writer.close();
  return result;
}

export async function decompressTile(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const result = streamToBytes(ds.readable as ReadableStream<Uint8Array>);
  await writer.write(compressed as unknown as BufferSource);
  await writer.close();
  return result;
}
