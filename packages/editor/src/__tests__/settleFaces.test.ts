import { faceProbes, settleFaces } from '../settleFaces';

describe('faceProbes', () => {
  it('probes every family at both weights, with a quoted family and a size', () => {
    expect(faceProbes(['Caveat', 'Lora'])).toEqual([
      "400 16px 'Caveat'",
      "700 16px 'Caveat'",
      "400 16px 'Lora'",
      "700 16px 'Lora'",
    ]);
  });

  it('is empty for no families', () => {
    expect(faceProbes([])).toEqual([]);
  });
});

describe('settleFaces', () => {
  it('resolves without a FontFaceSet (off-DOM, or an engine lacking the API)', async () => {
    await expect(settleFaces(['Caveat'], null)).resolves.toBeUndefined();
    await expect(settleFaces(['Caveat'], undefined)).resolves.toBeUndefined();
    await expect(settleFaces(['Caveat'], {} as never)).resolves.toBeUndefined();
  });

  it('asks the FontFaceSet to load every probe', async () => {
    const seen: string[] = [];
    await settleFaces(['Caveat', 'Lora'], {
      load: (font) => { seen.push(font); return Promise.resolve([]); },
    });
    expect(seen).toEqual(faceProbes(['Caveat', 'Lora']));
  });

  // The whole point: the caller bumps the fonts epoch on this promise, so it
  // must not resolve while a face is still in flight — that is the window in
  // which right-aligned text measures with the font-blind fallback.
  it('does not resolve until every face has settled', async () => {
    const resolvers: Array<() => void> = [];
    const done = jest.fn();
    const settled = settleFaces(['Caveat', 'Lora'], {
      load: () => new Promise<void>((res) => resolvers.push(res)),
    }).then(done);

    expect(resolvers).toHaveLength(4);
    resolvers.slice(0, 3).forEach((res) => res());
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();

    resolvers[3]();
    await settled;
    expect(done).toHaveBeenCalled();
  });

  it('rides out a face that fails to load, sync or async', async () => {
    await expect(settleFaces(['Caveat'], {
      load: () => Promise.reject(new Error('404')),
    })).resolves.toBeUndefined();

    await expect(settleFaces(['Caveat'], {
      load: () => { throw new Error('unparseable shorthand'); },
    })).resolves.toBeUndefined();
  });
});
