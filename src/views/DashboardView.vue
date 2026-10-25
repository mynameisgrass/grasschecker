<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  CloudOff,
  Camera,
  FileCheck2,
  ChevronRight,
  Clock,
  Sparkles,
  FileSpreadsheet,
  BookOpenCheck,
  History,
  Printer,
} from 'lucide-vue-next';
import { db, isAlive, repo, type ExamRecord, type ScanRecord } from '@/services/db';
import { syncService } from '@/services/SyncService';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { timeAgo, formatScore } from '@/utils/format';
import { haptic } from '@/services/haptics';

const router = useRouter();

const syncStatus = syncService.status;

// ── Live queries from Dexie ──────────────────────────────────────────────────
const exams = useLiveQuery(
  () => db.exams.orderBy('updatedAt').reverse().filter(isAlive).toArray(),
  [] as ExamRecord[],
);

const recentScans = useLiveQuery(
  () => db.scans.orderBy('timestamp').reverse().filter(isAlive).limit(15).toArray(),
  [] as ScanRecord[],
);

const pendingCount = useLiveQuery(
  async () => {
    return await syncService.countPending();
  },
  0,
);

const activeExamId = ref<string>('');

// Auto-select first exam if none selected
const selectedExam = computed(() => {
  if (!exams.value.length) return null;
  return exams.value.find((e) => e.id === activeExamId.value) || exams.value[0];
});

async function handleManualSync() {
  void haptic.light();
  await syncService.syncNow();
}

function startScanning() {
  void haptic.medium();
  const examId = selectedExam.value?.id;
  router.push({
    name: 'scanner',
    query: examId ? { examId } : {},
  });
}

function openReview(scanId: string) {
  void haptic.light();
  router.push({ name: 'review', params: { id: scanId } });
}

function goToMaker() {
  void haptic.light();
  router.push('/maker');
}

function goToExams() {
  void haptic.light();
  router.push('/exams');
}

function goToHistory() {
  void haptic.light();
  router.push('/history');
}

// Quick helper to seed a demo 40-question exam if none exists
async function seedDemoExam() {
  void haptic.light();
  const sampleKey: ('A' | 'B' | 'C' | 'D')[] = [
    'A', 'C', 'B', 'D', 'A', 'A', 'D', 'B', 'C', 'A',
    'B', 'D', 'C', 'A', 'D', 'B', 'A', 'C', 'C', 'B',
    'D', 'A', 'B', 'C', 'A', 'D', 'C', 'B', 'A', 'D',
    'B', 'C', 'D', 'A', 'B', 'A', 'D', 'C', 'B', 'A',
  ];
  const exam = await repo.create('exams', {
    answerKeyCode: '101',
    title: 'Standard Examination 2026',
    expectedAnswers: sampleKey,
  });
  activeExamId.value = exam.id;
}
</script>

<template>
  <div class="min-h-screen bg-neutral-100 pb-36 text-neutral-900 transition-colors dark:bg-neutral-950 dark:text-neutral-100">
    <main class="mx-auto max-w-xl px-4 pt-5 space-y-5">
      <!-- Quick Feature Shortcut Pills (Apple Grid) -->
      <section class="grid grid-cols-3 gap-2.5">
        <button
          class="flex min-h-[52px] flex-col items-center justify-center rounded-2xl border border-black/5 bg-white p-3 shadow-sm transition hover:scale-[1.02] active:scale-95 dark:border-white/10 dark:bg-neutral-900"
          @click="goToMaker"
        >
          <div class="grid size-8 place-items-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
            <FileSpreadsheet class="size-4" />
          </div>
          <span class="mt-1.5 text-[11px] font-bold">Exam Maker</span>
        </button>

        <button
          class="flex min-h-[52px] flex-col items-center justify-center rounded-2xl border border-black/5 bg-white p-3 shadow-sm transition hover:scale-[1.02] active:scale-95 dark:border-white/10 dark:bg-neutral-900"
          @click="goToExams"
        >
          <div class="grid size-8 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <BookOpenCheck class="size-4" />
          </div>
          <span class="mt-1.5 text-[11px] font-bold">Answer Keys</span>
        </button>

        <button
          class="flex min-h-[52px] flex-col items-center justify-center rounded-2xl border border-black/5 bg-white p-3 shadow-sm transition hover:scale-[1.02] active:scale-95 dark:border-white/10 dark:bg-neutral-900"
          @click="goToHistory"
        >
          <div class="grid size-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <History class="size-4" />
          </div>
          <span class="mt-1.5 text-[11px] font-bold">Score History</span>
        </button>
      </section>

      <!-- Active Exam Selector Card -->
      <section class="rounded-3xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <FileCheck2 class="size-4 text-neutral-500" />
            <h2 class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              Selected Answer Key
            </h2>
          </div>
          <button
            v-if="!exams.length"
            id="seed-exam-btn"
            class="flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-400"
            @click="seedDemoExam"
          >
            <Sparkles class="size-3.5" /> Create Sample Key
          </button>
        </div>

        <!-- Exam Details -->
        <div v-if="selectedExam" class="mt-3">
          <div class="flex items-baseline justify-between">
            <h3 class="text-lg font-bold tracking-tight">
              {{ selectedExam.title || 'Untitled Exam' }}
            </h3>
            <span class="rounded-lg bg-neutral-100 px-2 py-0.5 font-mono text-xs font-black text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
              Code {{ selectedExam.answerKeyCode }}
            </span>
          </div>
          <div class="mt-2 flex items-center justify-between text-xs text-neutral-500">
            <span>{{ selectedExam.expectedAnswers.length }} questions configured</span>
            <button
              class="font-semibold text-neutral-900 underline dark:text-white"
              @click="goToExams"
            >
              Change key
            </button>
          </div>
        </div>
        <div v-else class="mt-3 rounded-2xl border border-dashed border-neutral-300 p-4 text-center dark:border-neutral-800">
          <p class="text-xs text-neutral-500">No answer keys configured yet.</p>
          <button
            class="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400"
            @click="seedDemoExam"
          >
            Auto-generate 40-question demo exam
          </button>
        </div>
      </section>

      <!-- Sync Status Banner (if offline or pending changes) -->
      <div
        v-if="pendingCount > 0 || syncStatus === 'offline'"
        class="flex items-center justify-between rounded-2xl bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300"
      >
        <div class="flex items-center gap-2">
          <CloudOff class="size-4 shrink-0" />
          <span>
            <strong v-if="pendingCount > 0">{{ pendingCount }} records</strong>
            <span v-if="pendingCount > 0"> saved offline. </span>
            <span>Will sync automatically when connected.</span>
          </span>
        </div>
        <button
          v-if="syncStatus !== 'offline'"
          class="font-bold underline active:opacity-70"
          @click="handleManualSync"
        >
          Sync now
        </button>
      </div>

      <!-- Recent Batches / Scans Section -->
      <section class="space-y-3">
        <div class="flex items-center justify-between px-1">
          <h2 class="text-xs font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
            Recent Scans
          </h2>
          <button
            class="text-xs font-bold text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            @click="goToHistory"
          >
            View All ({{ recentScans.length }})
          </button>
        </div>

        <!-- Scans List -->
        <div v-if="recentScans.length" class="divide-y divide-black/5 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-neutral-900">
          <div
            v-for="scan in recentScans"
            :key="scan.id"
            class="group flex cursor-pointer items-center justify-between p-4 transition hover:bg-neutral-50 active:bg-neutral-100 dark:hover:bg-neutral-800/50 dark:active:bg-neutral-800"
            @click="openReview(scan.id)"
          >
            <div class="flex items-center gap-3.5">
              <div
                class="grid size-11 place-items-center rounded-2xl font-bold tabular-nums shrink-0"
                :class="[
                  scan.score >= 8
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : scan.score >= 5
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                ]"
              >
                {{ formatScore(scan.score) }}
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h4 class="text-sm font-semibold tracking-tight">
                    {{ scan.studentSBD ? `SBD ${scan.studentSBD}` : 'Unidentified Candidate' }}
                  </h4>
                  <span
                    v-if="scan.manuallyEdited"
                    class="rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-300"
                  >
                    Edited
                  </span>
                </div>
                <p class="flex items-center gap-2 text-xs text-neutral-500">
                  <span class="flex items-center gap-1">
                    <Clock class="size-3" /> {{ timeAgo(scan.timestamp) }}
                  </span>
                  <span>·</span>
                  <span>{{ scan.wrongAnswers.length }} wrong</span>
                  <span
                    class="size-1.5 rounded-full"
                    :class="scan.isSynced ? 'bg-emerald-500' : 'bg-amber-500'"
                    :title="scan.isSynced ? 'Synced to Cloud' : 'Stored Locally'"
                  />
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-200">
              <ChevronRight class="size-5 transition-transform group-active:translate-x-0.5" />
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-else
          class="rounded-3xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-800"
        >
          <Camera class="mx-auto size-10 text-neutral-300 dark:text-neutral-700" />
          <h3 class="mt-3 text-sm font-semibold">No sheets scanned yet</h3>
          <p class="mt-1 text-xs text-neutral-500">
            Print an answer sheet with Exam Maker, then tap the massive Scan button below.
          </p>
        </div>
      </section>
    </main>

    <!-- Massive "Scan Now" Floating Action Button (Apple-like Capsule FAB) -->
    <div class="fixed inset-x-0 bottom-20 md:bottom-8 z-30 flex justify-center px-5 pointer-events-none">
      <button
        id="dashboard-fab-scan"
        class="pointer-events-auto flex min-h-[56px] items-center gap-3 rounded-full bg-neutral-900 px-8 py-4 text-base font-bold text-white shadow-2xl transition hover:scale-[1.02] active:scale-95 dark:bg-white dark:text-neutral-950 dark:shadow-[0_12px_36px_rgba(255,255,255,0.2)]"
        @click="startScanning"
      >
        <div class="grid size-7 place-items-center rounded-full bg-white/20 text-white dark:bg-black/10 dark:text-neutral-900">
          <Camera class="size-4" />
        </div>
        <span>Scan Now</span>
      </button>
    </div>
  </div>
</template>
