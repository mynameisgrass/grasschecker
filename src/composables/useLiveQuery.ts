import { liveQuery } from 'dexie';
import { onScopeDispose, shallowRef, type Ref } from 'vue';

/**
 * Reactive Dexie query: re-runs automatically whenever the underlying tables change
 * (including writes made by SyncService in the background).
 */
export function useLiveQuery<T>(querier: () => T | Promise<T>, initial: T): Readonly<Ref<T>> {
  const state = shallowRef(initial) as Ref<T>;
  const sub = liveQuery(querier).subscribe({
    next: (v) => (state.value = v),
    error: (e) => console.error('[liveQuery]', e),
  });
  onScopeDispose(() => sub.unsubscribe());
  return state;
}
