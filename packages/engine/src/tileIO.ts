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

/**
 * Push `payload` through a transform and collect what comes out the other
 * side. Both legs are started before either is awaited (see the note above)
 * and both are then OBSERVED, which is what `Promise.allSettled` is here
 * for: a stream the transform refuses — a corrupt or truncated deflate
 * stream reaching `decompressTile` — errors the readable AND the writer, and
 * awaiting one leg after the other left the loser's rejection with no
 * handler. The caller saw its error and the runtime ALSO saw an
 * `unhandledRejection`, which on React Native is a red box and in node a
 * process-level warning (a fatal, on a future default).
 *
 * The READER's error is thrown in preference to the writer's: on a bad
 * stream the writer usually fails with "the stream is errored" while the
 * reader carries what was actually wrong with the bytes.
 */
interface ByteTransform {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

async function through(transform: ByteTransform, payload: Uint8Array): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const read = streamToBytes(transform.readable);
  const write = (async () => {
    await writer.write(payload);
    await writer.close();
  })();
  const [wrote, bytes] = await Promise.allSettled([write, read]);
  if (bytes.status === 'rejected') throw bytes.reason;
  if (wrote.status === 'rejected') throw wrote.reason;
  return bytes.value;
}

export function compressTile(payload: Uint8Array): Promise<Uint8Array> {
  return through(new CompressionStream('deflate') as unknown as ByteTransform, payload);
}

export function decompressTile(compressed: Uint8Array): Promise<Uint8Array> {
  return through(new DecompressionStream('deflate') as unknown as ByteTransform, compressed);
}
