/** A tiny typed event emitter for engine events (`turn-start`, `quality`, `resize`, ...). */
import type { Emitter, Unsubscribe } from '../contracts';

export function createEmitter<E extends Record<string, unknown>>(): Emitter<E> & { clear(): void } {
  const map = new Map<keyof E, Set<(payload: never) => void>>();
  return {
    on<K extends keyof E>(type: K, fn: (payload: E[K]) => void): Unsubscribe {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn as (payload: never) => void);
      return () => {
        set.delete(fn as (payload: never) => void);
      };
    },
    emit<K extends keyof E>(type: K, payload: E[K]): void {
      const set = map.get(type);
      if (!set) return;
      for (const fn of set) (fn as (p: E[K]) => void)(payload);
    },
    clear() {
      map.clear();
    },
  };
}
