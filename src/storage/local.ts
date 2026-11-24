// Tiny localStorage helpers. Storage can be blocked or full (private windows, some
// in-app browsers), so every call is wrapped and the game just forgets instead of crashing.

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the game still works, scores just won't persist.
  }
}
