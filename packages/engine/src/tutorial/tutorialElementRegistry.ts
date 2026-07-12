import type { View } from 'react-native';

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const _registry = new Map<string, ElementRect>();
const _refs = new Map<string, React.RefObject<View | null>>();
const _elementContainer = new Map<string, string>();
const _containerReady = new Map<string, boolean>();
const _listeners = new Set<() => void>();

function _notify(): void {
  for (const fn of _listeners) fn();
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

export function registerElement(id: string, rect: ElementRect): void {
  _registry.set(id, rect);
  _notify();
}

export function registerRef(
  id: string,
  ref: React.RefObject<View | null>,
  containerKey?: string,
): void {
  _refs.set(id, ref);
  if (containerKey) _elementContainer.set(id, containerKey);
}

export function unregisterElement(id: string): void {
  _registry.delete(id);
  _refs.delete(id);
  _elementContainer.delete(id);
}

export function getElementRect(id: string): ElementRect | null {
  // If the element is tagged with a container that has been explicitly
  // marked not-ready (e.g. ObjectPropertiesPanel mid-slide), report it as
  // missing so overlays don't render at a stale offscreen position.
  const containerKey = _elementContainer.get(id);
  if (containerKey && _containerReady.get(containerKey) === false) return null;

  const exact = _registry.get(id);
  if (exact) return exact;
  // Support prefix matching for dynamic labels (e.g. "Mirror:" matches "Mirror: Horizontal")
  if (id.endsWith(':')) {
    for (const [key, rect] of _registry) {
      if (key.startsWith(id)) {
        const keyContainer = _elementContainer.get(key);
        if (keyContainer && _containerReady.get(keyContainer) === false) continue;
        return rect;
      }
    }
  }
  return null;
}

/** Re-measure all registered refs and update their rects. */
export function remeasureAll(): void {
  for (const [id, ref] of _refs) {
    if (!ref.current) continue;
    ref.current.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        _registry.set(id, { x, y, width, height });
      }
    });
  }
  // On web measureInWindow is synchronous, so positions are already
  // updated.  Notify subscribers so overlays re-render with fresh rects.
  _notify();
}

export function setContainerReady(key: string, ready: boolean): void {
  if (_containerReady.get(key) === ready) return;
  _containerReady.set(key, ready);
  _notify();
}

export function getContainerReady(key: string): boolean {
  return _containerReady.get(key) ?? true;
}

export function clearRegistry(): void {
  _registry.clear();
  _refs.clear();
  _elementContainer.clear();
  _containerReady.clear();
}
