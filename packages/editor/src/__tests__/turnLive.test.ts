/**
 * The selection outline while a host's own kind of node is being TURNED
 * (turnLive.ts): such a node re-projects as it turns — CozyJournal's rig
 * figure is wide facing front and narrow edge-on — so its silhouette is a
 * different shape every frame and no one box is true until the gesture
 * settles. Rather than chase it (re-baking the true box per frame made the
 * outline judder through a run of shapes), the outline FADES OUT while the
 * turn is in flight and fades back in on the committed geometry once it
 * ends. This is the wire those two moments travel over.
 */

import {
  __resetTurnLiveForTest, clearTurnLive, getTurnLive, publishTurnLive, subscribeTurnLive,
} from '../turnLive';

afterEach(() => __resetTurnLiveForTest());

describe('the turn-in-flight signal', () => {
  it('emits once when a turn starts, however often the gesture fires', () => {
    const seen: unknown[] = [];
    subscribeTurnLive((v) => seen.push(v));
    for (let i = 0; i < 5; i++) publishTurnLive('node_1');
    expect(seen).toEqual([{ nodeId: 'node_1' }]);
    expect(getTurnLive()).toEqual({ nodeId: 'node_1' });
  });

  it('emits null when the gesture ends — and only if one was in flight', () => {
    const seen: unknown[] = [];
    subscribeTurnLive((v) => seen.push(v));
    clearTurnLive(); // nothing in flight: listeners hear nothing
    expect(seen).toEqual([]);
    publishTurnLive('node_1');
    clearTurnLive();
    expect(seen).toEqual([{ nodeId: 'node_1' }, null]);
    expect(getTurnLive()).toBeNull();
  });

  it('a different node re-emits — the listener may be watching either', () => {
    const seen: Array<{ nodeId: string } | null> = [];
    subscribeTurnLive((v) => seen.push(v));
    publishTurnLive('node_1');
    publishTurnLive('node_2');
    expect(seen).toEqual([{ nodeId: 'node_1' }, { nodeId: 'node_2' }]);
  });

  it('unsubscribing stops the signal, and the reset forgets every listener', () => {
    const seen: unknown[] = [];
    const off = subscribeTurnLive((v) => seen.push(v));
    publishTurnLive('node_1');
    off();
    clearTurnLive();
    expect(seen).toEqual([{ nodeId: 'node_1' }]);
  });
});
