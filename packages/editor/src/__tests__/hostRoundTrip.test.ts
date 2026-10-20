import { askHost } from '../hostRoundTrip';

// The one round trip over the app-event channel. Three things take it —
// the response/move hand-off, the home manifest, the salvage ask — and
// each used to write the latch out again. These are the invariants none
// of the three callers' own suites check, because each only cares about
// its own answer.

const io = () => {
  let handler: ((data: unknown) => void) | null = null;
  let offs = 0;
  return {
    offs: () => offs,
    reply: (data: unknown) => handler?.(data),
    post: () => {},
    onReply: (h: (data: unknown) => void) => {
      handler = h;
      return () => { offs += 1; handler = null; };
    },
  };
};

test('the first reply wins, and the rest are ignored', async () => {
  const channel = io();
  const answer = askHost(
    { post: () => { channel.reply('first'); channel.reply('second'); }, onReply: channel.onReply },
    (d) => d as string,
    'none',
    1000,
  );
  await expect(answer).resolves.toBe('first');
});

test('the listener is taken off however it settles', async () => {
  // A leaked listener per editor open is a leak per editor open.
  const answered = io();
  await askHost({ post: () => answered.reply('x'), onReply: answered.onReply }, (d) => d as string, 'none', 1000);
  expect(answered.offs()).toBe(1);

  const quiet = io();
  await askHost({ post: () => {}, onReply: quiet.onReply, timeoutMs: 1 }, (d) => d as string, 'none', 1000);
  expect(quiet.offs()).toBe(1);

  const broken = io();
  await askHost(
    { post: () => { throw new Error('no channel'); }, onReply: broken.onReply },
    (d) => d as string, 'none', 1000,
  );
  expect(broken.offs()).toBe(1);
});

test('a reply after the timeout does not settle it a second time', async () => {
  const channel = io();
  const answer = await askHost(
    { post: () => {}, onReply: channel.onReply, timeoutMs: 1 }, (d) => d as string, 'none', 1000,
  );
  expect(answer).toBe('none');
  // The handler is gone, so a late reply reaches nobody.
  expect(() => channel.reply('late')).not.toThrow();
});
