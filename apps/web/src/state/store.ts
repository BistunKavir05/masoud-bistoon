import { useSyncExternalStore } from 'react';

/** مخزن حالت کوچک بدون وابستگی؛ با useSyncExternalStore به React وصل می‌شود. */
export interface Store<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(fn: () => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      const value = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      for (const s of [...subs]) s();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/** انتخاب بخشی از حالت؛ selector باید مقدار پایدار (primitive یا مرجع ثابت) برگرداند. */
export function useStore<T, U>(store: Store<T>, selector: (s: T) => U): U {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
