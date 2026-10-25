import Dexie, { type Table, type UpdateSpec } from 'dexie';

// ── Record types ─────────────────────────────────────────────────────────────

/** Fields every synced record carries. */
export interface SyncFields {
  /** Epoch ms of the last local mutation — drives last-write-wins conflict resolution. */
  updatedAt: number;
  /**
   * false = dirty, needs pushing to Firestore.
   * NOTE: IndexedDB cannot index booleans, so this is filtered (not indexed) during sync.
   */
  isSynced: boolean;
  /** Soft-delete tombstone, so deletions propagate across devices. */
  deletedAt?: number | null;
}

export type AnswerOption = 'A' | 'B' | 'C' | 'D';
export const ANSWER_OPTIONS: readonly AnswerOption[] = ['A', 'B', 'C', 'D'];

export interface ClassRecord extends SyncFields {
  id: string;
  name: string;
  grade: number;
}

export interface StudentRecord extends SyncFields {
  id: string;
  classId: string;
  /** Grade + Class + Roll, e.g. "9101" = grade 9, class 1, roll 01. */
  customSBD: string;
  name: string;
}

export interface ExamRecord extends SyncFields {
  id: string;
  answerKeyCode: string;
  title?: string;
  expectedAnswers: AnswerOption[];
}

export interface ScanRecord extends SyncFields {
  id: string;
  examId: string;
  studentSBD?: string;
  score: number;
  /** Detected bubble per question (null = blank / unreadable). Needed for manual override. */
  answers: (AnswerOption | null)[];
  /** 1-based question numbers answered incorrectly. */
  wrongAnswers: number[];
  /** Flattened (perspective-corrected) sheet. Stays local — never pushed to Firestore. */
  imageBlob?: Blob;
  timestamp: number;
  manuallyEdited?: boolean;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export interface SyncedTables {
  classes: ClassRecord;
  students: StudentRecord;
  exams: ExamRecord;
  scans: ScanRecord;
}
export type SyncedTableName = keyof SyncedTables;
export type AnySyncedRecord = SyncedTables[SyncedTableName];
export const SYNCED_TABLES: readonly SyncedTableName[] = ['classes', 'students', 'exams', 'scans'];

// ── Database ─────────────────────────────────────────────────────────────────

class OmrDatabase extends Dexie {
  classes!: Table<ClassRecord, string>;
  students!: Table<StudentRecord, string>;
  exams!: Table<ExamRecord, string>;
  scans!: Table<ScanRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super('grasschecker');
    this.version(1).stores({
      classes: 'id, updatedAt, grade',
      students: 'id, updatedAt, classId, customSBD',
      exams: 'id, updatedAt, answerKeyCode',
      scans: 'id, updatedAt, examId, studentSBD, timestamp',
      meta: 'key',
    });
  }
}

export const db = new OmrDatabase();

// ── Helpers ──────────────────────────────────────────────────────────────────

export const isAlive = (r: { deletedAt?: number | null }) => !r.deletedAt;

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback for very old WebViews.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Fires after any local mutation so SyncService can schedule a debounced push. */
export const localChanges = new EventTarget();
const emitChange = (table: SyncedTableName) =>
  localChanges.dispatchEvent(new CustomEvent<SyncedTableName>('change', { detail: table }));

function tableOf<N extends SyncedTableName>(name: N): Table<SyncedTables[N], string> {
  return db.table(name);
}

type NewRecord<T> = Omit<T, keyof SyncFields | 'id'> & { id?: string };
type Changes<T> = Partial<Omit<T, keyof SyncFields | 'id'>>;

/**
 * All app writes go through `repo` so `updatedAt` / `isSynced` are always stamped correctly.
 * SyncService bypasses it on purpose (pulled records arrive already synced).
 *
 * ⚠️ Pass plain objects/arrays — Vue reactive proxies can't be structured-cloned into IndexedDB.
 */
export const repo = {
  async create<N extends SyncedTableName>(name: N, data: NewRecord<SyncedTables[N]>): Promise<SyncedTables[N]> {
    const record = {
      ...data,
      id: data.id ?? uuid(),
      updatedAt: Date.now(),
      isSynced: false,
      deletedAt: null,
    } as SyncedTables[N];
    await tableOf(name).add(record);
    emitChange(name);
    return record;
  },

  async update<N extends SyncedTableName>(name: N, id: string, changes: Changes<SyncedTables[N]>): Promise<boolean> {
    const spec = { ...changes, updatedAt: Date.now(), isSynced: false } as unknown as UpdateSpec<SyncedTables[N]>;
    const count = await tableOf(name).update(id, spec);
    if (count) emitChange(name);
    return count > 0;
  },

  async remove<N extends SyncedTableName>(name: N, id: string): Promise<boolean> {
    const spec = { deletedAt: Date.now(), updatedAt: Date.now(), isSynced: false } as unknown as UpdateSpec<SyncedTables[N]>;
    const count = await tableOf(name).update(id, spec);
    if (count) emitChange(name);
    return count > 0;
  },
};
