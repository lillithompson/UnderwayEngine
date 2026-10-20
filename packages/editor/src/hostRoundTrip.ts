// ONE round trip over the app-event channel, for everything that needs an
// answer from the host.
//
// The channel is request/reply on a single kind: the web side posts, the
// host replies on that same kind, and the first reply wins. Three things
// take that trip — the response/move hand-off (responseSend.ts), the home
// manifest (homeStateDelivery.ts) and the salvage ask (salvageMoves.ts) —
// and each had written the promise out again: the done-latch, the
// clearTimeout, the unsubscribe, and the rule that a throw from `post`
// settles it like a timeout. Three copies of a latch is three places for
// one of them to leak a listener.
//
// It never rejects. Every caller's fallback means the same thing — the
// host did not answer, so act as though there is nothing — and an editor
// open must not be held up by either.

export interface HostRoundTripIo {
  post: () => void;
  onReply: (handler: (data: unknown) => void) => () => void;
  timeoutMs?: number;
}

/**
 * Post, and settle with `decode(reply)` on the first answer or `fallback`
 * after `timeoutMs` — which is also what a `post` that throws (no
 * channel) settles with, at once rather than after the wait.
 */
export function askHost<T>(
  io: HostRoundTripIo,
  decode: (data: unknown) => T,
  fallback: T,
  defaultTimeoutMs: number,
): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      off();
      resolve(value);
    };
    const off = io.onReply((data) => finish(decode(data)));
    const timer = setTimeout(() => finish(fallback), io.timeoutMs ?? defaultTimeoutMs);
    try {
      io.post();
    } catch {
      finish(fallback);
    }
  });
}
