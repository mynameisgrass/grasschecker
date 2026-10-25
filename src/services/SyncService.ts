import { ref, shallowRef } from 'vue';
import { collection, doc, getDocs, limit, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, firestore } from './firebase';
import { db, localChanges, SYNCED_TABLES, type AnySyncedRecord, type SyncedTableName } from './db';

export type SyncStatus = 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';

const PUSH_CHUNK = 400; // Firestore batch hard limit is 500 ops
const PULL_PAGE = 500;
const PERIODIC_MS = 60_000;
const DEBOUNCE_MS = 2_000;
const NETWORK_TIMEOUT_MS = 20_000;

/** Fields that must never leave the device. */
const LOCAL_ONLY_FIELDS = ['isSynced', 'imageBlob'] as const;

class SessionChangedError extends Error {}

/**
 * Firestore promises never reject while offline — they just wait for the server.
 * Bound every network call so a flaky connection can't freeze the sync loop.
 */
function withTimeout<T>(p: Promise<T>, ms = NETWORK_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Network timeout after ${ms}ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toRemote(record: AnySyncedRecord): Record<string, unknown> {
  const data: Record<string, unknown> = { ...record };
  for (const f of LOCAL_ONLY_FIELDS) delete data[f];
  return data;
}

/**
 * Background ninja: Dexie is the source of truth; Firestore is a per-teacher mirror at
 * `teachers/{uid}/{collection}/{id}`. Conflicts resolve last-write-wins on `updatedAt`.
 */
class SyncService {
  readonly status = ref<SyncStatus>('signed-out');
  readonly lastSyncedAt = ref<number | null>(null);
  readonly lastError = shallowRef<Error | null>(null);

  private uid: string | null = null;
  private running: Promise<void> | null = null;
  private rerunRequested = false;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  /** Wire up all triggers. Call once from main.ts. Returns a teardown fn. */
  start(): () => void {
    if (this.started) return () => {};
    this.started = true;

    void db.meta.get('lastSyncedAt').then((m) => {
      if (typeof m?.value === 'number') this.lastSyncedAt.value = m.value;
    });

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      this.uid = u?.uid ?? null;
      if (u) void this.syncNow();
      else this.status.value = 'signed-out';
    });

    const onOnline = () => void this.syncNow();
    const onOffline = () => this.uid && (this.status.value = 'offline');
    const onVisible = () => document.visibilityState === 'visible' && void this.syncNow();
    const onLocalChange = () => this.schedule();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    localChanges.addEventListener('change', onLocalChange);
    const interval = setInterval(() => void this.syncNow(), PERIODIC_MS);

    return () => {
      unsubAuth();
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      localChanges.removeEventListener('change', onLocalChange);
      clearInterval(interval);
      clearTimeout(this.debounceTimer);
      this.started = false;
    };
  }

  /** Debounced sync — coalesces bursts of writes (e.g. scanning 40 sheets in a row). */
  schedule(delay = DEBOUNCE_MS): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.syncNow(), delay);
  }

  /** Run a full push → pull cycle. Safe to call concurrently; calls are coalesced. */
  syncNow(): Promise<void> {
    const uid = this.uid;
    if (!uid) return Promise.resolve();
    if (!navigator.onLine) {
      this.status.value = 'offline';
      return Promise.resolve();
    }
    if (this.running) {
      this.rerunRequested = true;
      return this.running;
    }
    this.running = this.run(uid).finally(() => (this.running = null));
    return this.running;
  }

  /** Total dirty records across all tables (use inside a Dexie liveQuery for reactivity). */
  async countPending(): Promise<number> {
    const counts = await Promise.all(
      SYNCED_TABLES.map((t) => db.table<AnySyncedRecord, string>(t).filter((r) => !r.isSynced).count()),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private assertSession(uid: string) {
    if (this.uid !== uid) throw new SessionChangedError();
  }

  private async run(uid: string): Promise<void> {
    do {
      this.rerunRequested = false;
      this.status.value = 'syncing';
      try {
        for (const name of SYNCED_TABLES) {
          this.assertSession(uid);
          await this.push(uid, name);
        }
        for (const name of SYNCED_TABLES) {
          this.assertSession(uid);
          await this.pull(uid, name);
        }
        const now = Date.now();
        this.lastSyncedAt.value = now;
        this.lastError.value = null;
        this.status.value = 'idle';
        await db.meta.put({ key: 'lastSyncedAt', value: now });
      } catch (err) {
        if (err instanceof SessionChangedError) return;
        console.warn('[sync] failed', err);
        this.lastError.value = err as Error;
        this.status.value = navigator.onLine ? 'error' : 'offline';
        return; // periodic / online triggers will retry
      }
    } while (this.rerunRequested);
  }

  /** PUSH: dirty Dexie rows → Firestore, then mark synced (only if unchanged meanwhile). */
  private async push(uid: string, name: SyncedTableName): Promise<void> {
    const table = db.table<AnySyncedRecord, string>(name);
    const pending = await table.filter((r) => !r.isSynced).toArray();
    if (!pending.length) return;

    for (const group of chunk(pending, PUSH_CHUNK)) {
      const batch = writeBatch(firestore);
      for (const r of group) batch.set(doc(firestore, 'teachers', uid, name, r.id), toRemote(r));
      await withTimeout(batch.commit());
      this.assertSession(uid);

      // Guard against a race: if the user edited a record while it was in flight, its
      // updatedAt moved forward — leave it dirty so the newer version gets pushed next cycle.
      await db.transaction('rw', table, async () => {
        for (const r of group) {
          await table
            .where('id')
            .equals(r.id)
            .and((x) => x.updatedAt === r.updatedAt)
            .modify({ isSynced: true });
        }
      });
    }
  }

  /** PULL: Firestore docs with updatedAt > cursor → upsert into Dexie (last-write-wins). */
  private async pull(uid: string, name: SyncedTableName): Promise<void> {
    const table = db.table<AnySyncedRecord, string>(name);
    const cursorKey = `pullCursor:${uid}:${name}`;
    // Cursor = highest *remote* updatedAt seen, so local clock skew can't cause missed docs.
    let cursor = ((await db.meta.get(cursorKey))?.value as number | undefined) ?? 0;
    const col = collection(firestore, 'teachers', uid, name);

    for (;;) {
      const snap = await withTimeout(
        getDocs(query(col, where('updatedAt', '>', cursor), orderBy('updatedAt'), limit(PULL_PAGE))),
      );
      this.assertSession(uid);
      if (snap.empty) break;

      const remote = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AnySyncedRecord);

      await db.transaction('rw', table, db.meta, async () => {
        const locals = await table.bulkGet(remote.map((r) => r.id));
        const toPut: AnySyncedRecord[] = [];
        remote.forEach((r, i) => {
          const local = locals[i];
          // Keep unsynced local edits that are newer than the remote copy.
          if (local && !local.isSynced && local.updatedAt > r.updatedAt) return;
          const merged = { ...r, isSynced: true } as AnySyncedRecord;
          // Preserve device-only blobs (images are never uploaded to Firestore).
          if (local && 'imageBlob' in local && local.imageBlob) (merged as { imageBlob?: Blob }).imageBlob = local.imageBlob;
          toPut.push(merged);
        });
        if (toPut.length) await table.bulkPut(toPut);
        cursor = remote[remote.length - 1].updatedAt;
        await db.meta.put({ key: cursorKey, value: cursor });
      });

      if (snap.size < PULL_PAGE) break;
    }
  }
}

export const syncService = new SyncService();
