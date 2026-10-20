import {
  type CommitPipeline, clearCommitWrapper, setCommitWrapper, wrapCommitPipeline,
} from '../commitPipeline';
import type { SessionEntry } from '../editorSession';

// The commit pipeline seam (docs/drawBot.md §5.4): identity until a phase
// installs a wrapper; every call reads the shell's current handlers off
// the ref and the current wrapper at call time.

function pipeline(log: string[], tag: string): CommitPipeline {
  return {
    applyEntry: (se) => log.push(`${tag}:apply:${se === null ? 'null' : se.entry.length}`),
    doUndo: () => log.push(`${tag}:undo`),
    doRedo: () => log.push(`${tag}:redo`),
  };
}

afterEach(() => clearCommitWrapper());

describe('wrapCommitPipeline', () => {
  it('is the identity until a wrapper is installed', () => {
    const log: string[] = [];
    const ref = { current: pipeline(log, 'base') };
    const p = wrapCommitPipeline(ref);
    const se: SessionEntry = { entry: [] };
    p.applyEntry(se);
    p.applyEntry(null);
    p.doUndo();
    p.doRedo();
    expect(log).toEqual(['base:apply:0', 'base:apply:null', 'base:undo', 'base:redo']);
  });

  it('reads the ref at call time, so refreshed handlers are the ones called', () => {
    const log: string[] = [];
    const ref = { current: pipeline(log, 'one') };
    const p = wrapCommitPipeline(ref);
    p.doUndo();
    ref.current = pipeline(log, 'two');
    p.doUndo();
    expect(log).toEqual(['one:undo', 'two:undo']);
  });

  it('routes through an installed wrapper, and back to the base when it is removed', () => {
    const log: string[] = [];
    const ref = { current: pipeline(log, 'base') };
    const p = wrapCommitPipeline(ref);
    setCommitWrapper((base) => ({
      applyEntry: (se) => { log.push('wrap:before'); base.applyEntry(se); },
      doUndo: () => { log.push('wrap:undo'); base.doUndo(); },
      doRedo: base.doRedo,
    }));
    p.applyEntry({ entry: [] });
    p.doUndo();
    p.doRedo();
    setCommitWrapper(null);
    p.doUndo();
    expect(log).toEqual([
      'wrap:before', 'base:apply:0', 'wrap:undo', 'base:undo', 'base:redo', 'base:undo',
    ]);
  });
});
