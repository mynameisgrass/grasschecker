<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  History,
  Download,
  Filter,
  Search,
  FileSpreadsheet,
  ChevronRight,
  TrendingUp,
  Award,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Camera,
} from 'lucide-vue-next';
import { db, isAlive, repo, type ExamRecord, type ScanRecord } from '@/services/db';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { formatScore, timeAgo } from '@/utils/format';
import { haptic } from '@/services/haptics';

const router = useRouter();

// ── Live Queries ─────────────────────────────────────────────────────────────
const scans = useLiveQuery(
  () => db.scans.orderBy('timestamp').reverse().filter(isAlive).toArray(),
  [] as ScanRecord[],
);

const exams = useLiveQuery(
  () => db.exams.orderBy('updatedAt').reverse().filter(isAlive).toArray(),
  [] as ExamRecord[],
);

// Map of exam id to exam code/title
const examMap = computed(() => {
  const map = new Map<string, ExamRecord>();
  for (const e of exams.value) map.set(e.id, e);
  return map;
});

// ── Filters & Search ─────────────────────────────────────────────────────────
const selectedExamId = ref<string>('ALL');
const selectedGradeFilter = ref<string>('ALL');
const searchSBD = ref<string>('');
const sortBy = ref<'newest' | 'score-desc' | 'score-asc' | 'sbd'>('newest');

// Extract unique grade prefixes from SBDs (e.g., SBD "9101" -> Grade "9" or Class "91")
const availableClasses = computed(() => {
  const classes = new Set<string>();
  for (const s of scans.value) {
    if (s.studentSBD && s.studentSBD.length >= 2) {
      classes.add(s.studentSBD.slice(0, 2)); // e.g. "91", "92"
    }
  }
  return Array.from(classes).sort();
});

const filteredScans = computed(() => {
  let list = [...scans.value];

  // Filter Exam
  if (selectedExamId.value !== 'ALL') {
    list = list.filter((s) => s.examId === selectedExamId.value);
  }

  // Filter Class (first 2 digits of SBD)
  if (selectedGradeFilter.value !== 'ALL') {
    list = list.filter((s) => s.studentSBD?.startsWith(selectedGradeFilter.value));
  }

  // Filter SBD search
  const q = searchSBD.value.trim().toLowerCase();
  if (q) {
    list = list.filter((s) => (s.studentSBD || '').toLowerCase().includes(q));
  }

  // Sort
  if (sortBy.value === 'score-desc') list.sort((a, b) => b.score - a.score);
  else if (sortBy.value === 'score-asc') list.sort((a, b) => a.score - b.score);
  else if (sortBy.value === 'sbd') list.sort((a, b) => (a.studentSBD || '').localeCompare(b.studentSBD || ''));
  else list.sort((a, b) => b.timestamp - a.timestamp);

  return list;
});

// ── Summary Metrics ──────────────────────────────────────────────────────────
const metrics = computed(() => {
  const list = filteredScans.value;
  if (!list.length) return { total: 0, avg: 0, passRate: 0, max: 0 };
  const sum = list.reduce((acc, s) => acc + s.score, 0);
  const avg = sum / list.length;
  const passCount = list.filter((s) => s.score >= 5.0).length;
  const passRate = Math.round((passCount / list.length) * 100);
  const max = Math.max(...list.map((s) => s.score));
  return {
    total: list.length,
    avg: Math.round(avg * 100) / 100,
    passRate,
    max,
  };
});

// ── Actions ──────────────────────────────────────────────────────────────────
function openReview(id: string) {
  void haptic.light();
  router.push({ name: 'review', params: { id } });
}

async function deleteScan(id: string) {
  if (!confirm('Are you sure you want to delete this scan record?')) return;
  void haptic.light();
  await repo.remove('scans', id);
}

function exportCSV() {
  void haptic.medium();
  const rows = [
    ['Candidate SBD', 'Exam Code', 'Score (/10)', 'Wrong Answers Count', 'Wrong Question Numbers', 'Date', 'Time'],
  ];

  for (const s of filteredScans.value) {
    const e = examMap.value.get(s.examId);
    const d = new Date(s.timestamp);
    rows.push([
      `"${s.studentSBD || 'N/A'}"`,
      `"${e?.answerKeyCode || 'Unknown'}"`,
      String(s.score),
      String(s.wrongAnswers.length),
      `"${s.wrongAnswers.join(', ')}"`,
      d.toLocaleDateString(),
      d.toLocaleTimeString(),
    ]);
  }

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map((r) => r.join(',')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `OMR_Grades_Export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
</script>

<template>
  <div class="min-h-screen bg-neutral-100 pb-28 text-neutral-900 transition-colors dark:bg-neutral-950 dark:text-neutral-100">
    <main class="mx-auto max-w-5xl px-4 pt-6 space-y-6">
      <!-- Page Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="grid size-9 place-items-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-950">
              <History class="size-5" />
            </span>
            <h1 class="text-xl font-bold tracking-tight">Score History & Analytics</h1>
          </div>
          <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Comprehensive audit log of all scanned and graded OMR answer sheets.
          </p>
        </div>

        <button
          v-if="filteredScans.length"
          id="export-csv-btn"
          class="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-xs font-bold text-neutral-800 shadow-sm transition hover:bg-neutral-50 active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
          @click="exportCSV"
        >
          <Download class="size-4 text-emerald-600 dark:text-emerald-400" />
          <span>Export Excel / CSV</span>
        </button>
      </div>

      <!-- Quick Metrics Cards -->
      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-3xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <p class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Papers Graded</p>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-black tabular-nums tracking-tight">{{ metrics.total }}</span>
            <span class="text-xs text-neutral-400">sheets</span>
          </div>
        </div>

        <div class="rounded-3xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <p class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Class Average</p>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-black tabular-nums tracking-tight text-neutral-900 dark:text-white">
              {{ formatScore(metrics.avg) }}
            </span>
            <span class="text-xs text-neutral-400">/10</span>
          </div>
        </div>

        <div class="rounded-3xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <p class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Pass Rate (≥5)</p>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-black tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
              {{ metrics.passRate }}%
            </span>
          </div>
        </div>

        <div class="rounded-3xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900">
          <p class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Top Score</p>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-black tabular-nums tracking-tight text-purple-600 dark:text-purple-400">
              {{ formatScore(metrics.max) }}
            </span>
            <span class="text-xs text-neutral-400">/10</span>
          </div>
        </div>
      </section>

      <!-- Filter Controls -->
      <section class="rounded-3xl border border-black/5 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900 space-y-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <!-- Filter by Exam -->
          <div>
            <label class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Exam</label>
            <select
              v-model="selectedExamId"
              class="mt-1 w-full min-h-[44px] rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-800"
            >
              <option value="ALL">All Exams ({{ exams.length }})</option>
              <option v-for="e in exams" :key="e.id" :value="e.id">
                Code {{ e.answerKeyCode }} - {{ e.title || 'Exam' }}
              </option>
            </select>
          </div>

          <!-- Filter by Class -->
          <div>
            <label class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Class / Group</label>
            <select
              v-model="selectedGradeFilter"
              class="mt-1 w-full min-h-[44px] rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-800"
            >
              <option value="ALL">All Classes</option>
              <option v-for="c in availableClasses" :key="c" :value="c">Class {{ c }}</option>
            </select>
          </div>

          <!-- Search SBD -->
          <div>
            <label class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Student ID (SBD)</label>
            <div class="relative mt-1">
              <Search class="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" />
              <input
                v-model="searchSBD"
                type="text"
                placeholder="e.g. 9101"
                class="w-full min-h-[44px] rounded-xl border border-neutral-200 bg-neutral-50 pl-8 pr-3 text-xs font-mono font-semibold placeholder-neutral-400 dark:border-neutral-800 dark:bg-neutral-800"
              />
            </div>
          </div>

          <!-- Sort -->
          <div>
            <label class="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Sort Order</label>
            <select
              v-model="sortBy"
              class="mt-1 w-full min-h-[44px] rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-800"
            >
              <option value="newest">Newest Scans First</option>
              <option value="score-desc">Score: High to Low</option>
              <option value="score-asc">Score: Low to High</option>
              <option value="sbd">Student SBD (Ascending)</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Results Table / List -->
      <section class="space-y-2">
        <div class="flex items-center justify-between px-1">
          <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Graded Papers ({{ filteredScans.length }})
          </span>
        </div>

        <div
          v-if="filteredScans.length"
          class="divide-y divide-black/5 overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-neutral-900"
        >
          <div
            v-for="item in filteredScans"
            :key="item.id"
            class="flex items-center justify-between p-4 transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
          >
            <!-- Candidate & Exam info -->
            <div class="flex items-center gap-3.5 cursor-pointer flex-1" @click="openReview(item.id)">
              <div
                class="grid size-12 place-items-center rounded-2xl font-black text-sm tabular-nums shrink-0"
                :class="[
                  item.score >= 8
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : item.score >= 5
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                ]"
              >
                {{ formatScore(item.score) }}
              </div>

              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-bold tracking-tight">
                    {{ item.studentSBD ? `SBD ${item.studentSBD}` : 'Candidate Unknown' }}
                  </h3>
                  <span class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                    Code {{ examMap.get(item.examId)?.answerKeyCode || '?' }}
                  </span>
                  <span
                    v-if="item.manuallyEdited"
                    class="rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-300"
                  >
                    Edited
                  </span>
                </div>

                <p class="mt-0.5 flex items-center gap-2 text-xs text-neutral-500">
                  <span>{{ timeAgo(item.timestamp) }}</span>
                  <span>·</span>
                  <span>{{ item.wrongAnswers.length }} wrong</span>
                  <span
                    class="size-1.5 rounded-full"
                    :class="item.isSynced ? 'bg-emerald-500' : 'bg-amber-500'"
                    :title="item.isSynced ? 'Synced to cloud' : 'Local copy'"
                  />
                </p>
              </div>
            </div>

            <!-- Actions: Review, Delete -->
            <div class="flex items-center gap-1 shrink-0 ml-3">
              <button
                class="flex min-h-[44px] items-center gap-1 rounded-xl px-3 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 active:scale-95 dark:text-neutral-300 dark:hover:bg-neutral-800"
                @click="openReview(item.id)"
              >
                <span>Review</span>
                <ChevronRight class="size-4" />
              </button>

              <button
                class="grid size-11 place-items-center rounded-xl text-neutral-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                title="Delete scan"
                @click="deleteScan(item.id)"
              >
                <Trash2 class="size-4" />
              </button>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-else
          class="rounded-3xl border border-dashed border-neutral-300 p-12 text-center dark:border-neutral-800"
        >
          <Camera class="mx-auto size-12 text-neutral-300 dark:text-neutral-700" />
          <h3 class="mt-3 text-sm font-semibold">No Graded Papers Match Your Filter</h3>
          <p class="mt-1 text-xs text-neutral-500">Try adjusting the filter dropdowns or scan new answer sheets.</p>
        </div>
      </section>
    </main>
  </div>
</template>
