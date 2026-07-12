import {
  parseManifest,
  MANIFEST_SCHEMA_VERSION,
  MAX_SAMPLE_BYTES,
} from '../manifestSchema';

const VALID_SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

function makeEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'abc-123',
    name: 'Mountain',
    createdAt: 1_700_000_000_000,
    publishDate: 1_700_000_000_000,
    compPath: `/dynamic-samples/blob/${VALID_SHA}.tile`,
    compSize: 1024,
    compSha256: VALID_SHA,
    thumbPath: `/dynamic-samples/thumb/${VALID_SHA}.webp`,
    ...overrides,
  };
}

function makeManifest(samples: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAt: 1_700_000_000_000,
    samples,
  };
}

describe('parseManifest', () => {
  it('accepts a valid manifest', () => {
    const parsed = parseManifest(makeManifest([makeEntry()]));
    expect(parsed).not.toBeNull();
    expect(parsed!.samples).toHaveLength(1);
    expect(parsed!.samples[0].id).toBe('abc-123');
  });

  it('parses a JSON string', () => {
    const parsed = parseManifest(JSON.stringify(makeManifest([makeEntry()])));
    expect(parsed).not.toBeNull();
  });

  it('returns null on bad JSON string', () => {
    expect(parseManifest('not json')).toBeNull();
  });

  it('rejects an unknown schemaVersion', () => {
    expect(parseManifest({ ...makeManifest([makeEntry()]), schemaVersion: 99 })).toBeNull();
  });

  it('rejects when samples is not an array', () => {
    expect(parseManifest({ ...makeManifest([makeEntry()]), samples: 'nope' })).toBeNull();
  });

  it('rejects entries with non-hex sha256', () => {
    expect(parseManifest(makeManifest([makeEntry({ compSha256: 'short' })]))).toBeNull();
  });

  it('rejects entries whose compSize exceeds MAX_SAMPLE_BYTES', () => {
    expect(
      parseManifest(makeManifest([makeEntry({ compSize: MAX_SAMPLE_BYTES + 1 })])),
    ).toBeNull();
  });

  it('rejects entries with non-positive compSize', () => {
    expect(parseManifest(makeManifest([makeEntry({ compSize: 0 })]))).toBeNull();
    expect(parseManifest(makeManifest([makeEntry({ compSize: -1 })]))).toBeNull();
  });

  it('rejects compPath outside /dynamic-samples/', () => {
    expect(
      parseManifest(makeManifest([makeEntry({ compPath: '/other/path.tile' })])),
    ).toBeNull();
  });

  it('rejects compPath with traversal', () => {
    expect(
      parseManifest(
        makeManifest([makeEntry({ compPath: '/dynamic-samples/../etc/passwd' })]),
      ),
    ).toBeNull();
  });

  it('rejects double-slash compPath (scheme/authority confusion)', () => {
    // A leading `//evil.com/...` is rejected because it doesn't start with /dynamic-samples/.
    // This case covers the additional defense against `//` after a valid prefix-looking start.
    expect(
      parseManifest(makeManifest([makeEntry({ compPath: '//attacker.com/dynamic-samples/x' })])),
    ).toBeNull();
  });

  it('rejects thumbPath outside /dynamic-samples/', () => {
    expect(
      parseManifest(makeManifest([makeEntry({ thumbPath: '/imgs/x.webp' })])),
    ).toBeNull();
  });

  it('rejects activityPath outside /dynamic-samples/', () => {
    expect(
      parseManifest(makeManifest([makeEntry({ activityPath: '/x.json' })])),
    ).toBeNull();
  });

  it('rejects duplicate ids', () => {
    expect(
      parseManifest(makeManifest([
        makeEntry({ id: 'dup' }),
        makeEntry({ id: 'dup', compSha256: OTHER_SHA, compPath: `/dynamic-samples/blob/${OTHER_SHA}.tile` }),
      ])),
    ).toBeNull();
  });

  it('rejects entries missing id', () => {
    expect(parseManifest(makeManifest([makeEntry({ id: '' })]))).toBeNull();
  });

  it('rejects entries missing name', () => {
    expect(parseManifest(makeManifest([makeEntry({ name: '' })]))).toBeNull();
  });

  it('rejects entries with non-finite createdAt', () => {
    expect(parseManifest(makeManifest([makeEntry({ createdAt: NaN })]))).toBeNull();
    expect(parseManifest(makeManifest([makeEntry({ createdAt: 'foo' })]))).toBeNull();
  });

  it('drops empty optional fields cleanly', () => {
    const parsed = parseManifest(
      makeManifest([makeEntry({ displayName: '', tags: [], bannerText: '' })]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.samples[0].displayName).toBeUndefined();
    expect(parsed!.samples[0].tags).toBeUndefined();
    expect(parsed!.samples[0].bannerText).toBeUndefined();
  });

  it('preserves optional fields when present', () => {
    const parsed = parseManifest(
      makeManifest([
        makeEntry({
          displayName: 'Mountain Top',
          tags: ['Landscapes'],
          activityPath: `/dynamic-samples/activity/${VALID_SHA}.json`,
          bannerText: 'Hello!',
        }),
      ]),
    );
    expect(parsed!.samples[0].displayName).toBe('Mountain Top');
    expect(parsed!.samples[0].tags).toEqual(['Landscapes']);
    expect(parsed!.samples[0].activityPath).toBe(
      `/dynamic-samples/activity/${VALID_SHA}.json`,
    );
    expect(parsed!.samples[0].bannerText).toBe('Hello!');
  });

  it('treats missing publishDate as unpublished (POSITIVE_INFINITY)', () => {
    const { publishDate: _, ...entryWithoutPublishDate } = makeEntry();
    const parsed = parseManifest(makeManifest([entryWithoutPublishDate]));
    expect(parsed).not.toBeNull();
    expect(parsed!.samples[0].publishDate).toBe(Number.POSITIVE_INFINITY);
    // And the runtime visibility filter excludes it.
    expect(parsed!.samples[0].publishDate <= Date.now()).toBe(false);
  });

  it('treats missing activityPath as unpublished even when publishDate is set', () => {
    const parsed = parseManifest(makeManifest([makeEntry({ publishDate: 1 })]));
    expect(parsed).not.toBeNull();
    expect(parsed!.samples[0].activityPath).toBeUndefined();
    expect(parsed!.samples[0].publishDate).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps a finite publishDate when activityPath is present', () => {
    const parsed = parseManifest(
      makeManifest([
        makeEntry({
          publishDate: 1_700_000_000_000,
          activityPath: `/dynamic-samples/activity/${VALID_SHA}.json`,
        }),
      ]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.samples[0].publishDate).toBe(1_700_000_000_000);
  });

  it('filters out non-string tags', () => {
    const parsed = parseManifest(
      makeManifest([makeEntry({ tags: ['valid', '', 42, null] })]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.samples[0].tags).toEqual(['valid']);
  });
});
