import { DOWNLOAD_URL_LIFETIME_MS, shareBinaryFile, shareFile } from '../webBridge';

// A plain browser's share is a download through a synthetic anchor. Safari
// on iPad/iPhone asks "Do you want to download …?" before it reads the
// object URL, so the URL must outlive the click: revoking it at once is
// what made a web `.tile` export save nothing there (DrawBots bug report
// 21e7214d), while desktop browsers, already fetching, never noticed.

type Anchor = {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click: jest.Mock;
  remove: jest.Mock;
};

const events: string[] = [];
let anchors: Anchor[] = [];
let created = 0;
const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;

beforeEach(() => {
  jest.useFakeTimers();
  events.length = 0;
  anchors = [];
  created = 0;
  URL.createObjectURL = jest.fn(() => `blob:test/${++created}`);
  URL.revokeObjectURL = jest.fn((u: string) => { events.push(`revoke ${u}`); });
  (globalThis as { document?: unknown }).document = {
    createElement: () => {
      const a: Anchor = {
        href: '',
        download: '',
        rel: '',
        style: { display: '' },
        click: jest.fn(() => { events.push(`click ${a.href} as ${a.download}`); }),
        remove: jest.fn(() => { events.push('remove'); }),
      };
      anchors.push(a);
      return a;
    },
    body: { appendChild: () => { events.push('attach'); } },
  };
});
afterEach(() => {
  jest.useRealTimers();
  URL.createObjectURL = origCreate;
  URL.revokeObjectURL = origRevoke;
  delete (globalThis as { document?: unknown }).document;
});

test('a binary download keeps its URL alive past the click, and frees it after the lifetime', async () => {
  await expect(shareBinaryFile(new Uint8Array([1, 2, 3]), 'page.tile', 'application/octet-stream'))
    .resolves.toEqual({ success: true });
  expect(events).toEqual(['attach', 'click blob:test/1 as page.tile', 'remove']);

  // Still there while Safari's download prompt waits for an answer.
  jest.advanceTimersByTime(DOWNLOAD_URL_LIFETIME_MS - 1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(events[events.length - 1]).toBe('revoke blob:test/1');
});

test('a text download goes the same way', async () => {
  await expect(shareFile('<svg/>', 'page.svg', 'image/svg+xml')).resolves.toEqual({ success: true });
  expect(events).toEqual(['attach', 'click blob:test/1 as page.svg', 'remove']);
  jest.advanceTimersByTime(DOWNLOAD_URL_LIFETIME_MS);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
});

test('the URL lasts long enough to answer a prompt', () => {
  expect(DOWNLOAD_URL_LIFETIME_MS).toBeGreaterThanOrEqual(30_000);
});
