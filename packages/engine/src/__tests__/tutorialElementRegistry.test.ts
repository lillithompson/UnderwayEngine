import {
  registerElement,
  registerRef,
  unregisterElement,
  getElementRect,
  setContainerReady,
  getContainerReady,
  subscribe,
  clearRegistry,
} from '../tutorial/tutorialElementRegistry';

const fakeRef = () => ({ current: null }) as any;

describe('tutorialElementRegistry container readiness', () => {
  beforeEach(() => clearRegistry());

  it('returns the rect when the element has no container', () => {
    registerElement('Edit', { x: 1, y: 2, width: 3, height: 4 });
    expect(getElementRect('Edit')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('returns the rect when an element\'s container is implicitly ready', () => {
    registerRef('Edit', fakeRef(), 'panel');
    registerElement('Edit', { x: 1, y: 2, width: 3, height: 4 });
    // No setContainerReady call; default for unknown containers is "ready"
    expect(getElementRect('Edit')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(getContainerReady('panel')).toBe(true);
  });

  it('hides the rect while the element\'s container is not ready', () => {
    registerRef('Edit', fakeRef(), 'panel');
    registerElement('Edit', { x: 1, y: 2, width: 3, height: 4 });
    setContainerReady('panel', false);
    expect(getElementRect('Edit')).toBeNull();
    setContainerReady('panel', true);
    expect(getElementRect('Edit')).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it('does not affect elements outside the not-ready container', () => {
    registerRef('Edit', fakeRef(), 'panel');
    registerElement('Edit', { x: 1, y: 2, width: 3, height: 4 });
    registerElement('Header', { x: 5, y: 6, width: 7, height: 8 });
    setContainerReady('panel', false);
    expect(getElementRect('Edit')).toBeNull();
    expect(getElementRect('Header')).toEqual({ x: 5, y: 6, width: 7, height: 8 });
  });

  it('respects container readiness for prefix-matched dynamic labels', () => {
    registerRef('Mirror: Horizontal', fakeRef(), 'panel');
    registerElement('Mirror: Horizontal', { x: 9, y: 9, width: 9, height: 9 });
    expect(getElementRect('Mirror:')).toEqual({ x: 9, y: 9, width: 9, height: 9 });
    setContainerReady('panel', false);
    expect(getElementRect('Mirror:')).toBeNull();
  });

  it('clears container info on unregister', () => {
    registerRef('Edit', fakeRef(), 'panel');
    registerElement('Edit', { x: 1, y: 2, width: 3, height: 4 });
    setContainerReady('panel', false);
    unregisterElement('Edit');
    registerElement('Edit', { x: 10, y: 20, width: 30, height: 40 });
    // After unregister there is no container association; rect is visible again.
    expect(getElementRect('Edit')).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('notifies subscribers when container readiness changes', () => {
    const fn = jest.fn();
    const unsubscribe = subscribe(fn);
    setContainerReady('panel', false);
    expect(fn).toHaveBeenCalledTimes(1);
    setContainerReady('panel', false); // no-op, same value
    expect(fn).toHaveBeenCalledTimes(1);
    setContainerReady('panel', true);
    expect(fn).toHaveBeenCalledTimes(2);
    unsubscribe();
    setContainerReady('panel', false);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
