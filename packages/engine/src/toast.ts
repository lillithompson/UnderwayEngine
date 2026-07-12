type Listener = (message: string) => void;
const listeners = new Set<Listener>();

export function showToast(message: string): void {
  listeners.forEach(fn => fn(message));
}

export function subscribeToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
