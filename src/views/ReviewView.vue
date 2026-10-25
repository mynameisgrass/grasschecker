<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Image as ImageIcon,
  RotateCcw,
  Save,
  Check,
} from 'lucide-vue-next';
import {
  db,
  isAlive,
  repo,
  type AnswerOption,
  type ExamRecord,
  type ScanRecord,
  ANSWER_OPTIONS,
} from '@/services/db';
import { scoreAnswers } from '@/vision/omr';
import { formatScore } from '@/utils/format';
import { haptic } from '@/services/haptics';

const props = defineProps<{
  id: string;
}>();

const router = useRouter();

const scan = ref<ScanRecord | null>(null);
const exam = ref<ExamRecord | null>(null);
const imageUrl = ref<string | null>(null);
const isDirty = ref(false);
const saveSuccess = ref(false);

// Local editable copy of answers
const editableAnswers = ref<(AnswerOption | null)[]>([]);
const editableSBD = ref<string>('');

// Derived recalculated score
const recalculated = computed(() => {
  if (!exam.value) return { score: 0, wrongAnswers: [] };
  const res = scoreAnswers(editableAnswers.value, exam.value.expectedAnswers);
  return {
    score: res.score,
    wrongAnswers: res.wrongAnswers,
    correctCount: res.correct,
    totalCount: res.total,
  };
});

async function loadData() {
  const foundScan = await db.scans.get(props.id);
  if (!foundScan || !isAlive(foundScan)) {
    router.replace({ name: 'dashboard' });
    return;
  }
  scan.value = foundScan;
  editableAnswers.value = [...foundScan.answers];
  editableSBD.value = foundScan.studentSBD || '';

  // Setup blob preview url
  if (foundScan.imageBlob) {
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = URL.createObjectURL(foundScan.imageBlob);
  }

  // Load associated exam
  const foundExam = await db.exams.get(foundScan.examId);
  if (foundExam) {
    exam.value = foundExam;
  }
}

function selectAnswer(questionIdx: number, option: AnswerOption) {
  void haptic.light();
  const current = editableAnswers.value[questionIdx];
  // Toggle off if clicked again (blank)
  editableAnswers.value[questionIdx] = current === option ? null : option;
  isDirty.value = true;
}

function clearAnswer(questionIdx: number) {
  void haptic.light();
  editableAnswers.value[questionIdx] = null;
  isDirty.value = true;
}

async function saveChanges() {
  if (!scan.value || !exam.value) return;
  void haptic.medium();

  const { score, wrongAnswers } = recalculated.value;

  await repo.update('scans', scan.value.id, {
    answers: [...editableAnswers.value],
    studentSBD: editableSBD.value.trim() || undefined,
    score,
    wrongAnswers,
    manuallyEdited: true,
  });

  isDirty.value = false;
  saveSuccess.value = true;
  void haptic.success();
  setTimeout(() => {
    saveSuccess.value = false;
  }, 2000);
}

function resetChanges() {
  if (!scan.value) return;
  void haptic.light();
  editableAnswers.value = [...scan.value.answers];
  editableSBD.value = scan.value.studentSBD || '';
  isDirty.value = false;
}

function goBack() {
  void haptic.light();
  router.push({ name: 'dashboard' });
}

function scanNext() {
  void haptic.light();
  router.push({
    name: 'scanner',
    query: exam.value ? { examId: exam.value.id } : {},
  });
}

onMounted(() => {
  loadData();
});

onUnmounted(() => {
  if (imageUrl.value) {
    URL.revokeObjectURL(imageUrl.value);
  }
});
</script>

<template>
  <div class="min-h-screen bg-[#f2f2f7] text-neutral-900 pb-24 dark:bg-[#09090b] dark:text-neutral-100">
    <!-- Header -->
    <header class="sticky top-0 z-20 border-b border-neutral-200/80 bg-white/95 backdrop-blur-xl dark:border-neutral-800 dark:bg-[#121214]/95">
      <div class="mx-auto flex max-w-xl items-center justify-between px-4 py-3.5">
        <button
          id="review-back-btn"
          class="flex items-center gap-1 text-sm font-semibold text-neutral-600 transition active:scale-95 dark:text-neutral-400"
          @click="goBack"
        >
          <ArrowLeft class="size-4" />
          <span>Dashboard</span>
        </button>

        <div class="text-center">
          <h1 class="text-sm font-bold tracking-tight">Review Scan</h1>
          <p class="text-[11px] text-neutral-500">
            {{ scan ? new Date(scan.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' }}
          </p>
        </div>

        <button
          id="review-scan-next-btn"
          class="flex items-center gap-1 rounded-full bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm shadow-emerald-600/25 transition hover:bg-emerald-500 active:scale-95"
          @click="scanNext"
        >
          <Camera class="size-3.5" />
          <span>Scan Next</span>
        </button>
      </div>
    </header>

    <main class="mx-auto max-w-xl px-4 pt-5 space-y-5">
      <!-- Top Overview Card -->
      <section class="rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800/80 dark:bg-[#18181b]">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Candidate</span>
              <span
                v-if="scan?.manuallyEdited"
                class="rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-bold text-purple-600 dark:text-purple-300"
              >
                Manually Adjusted
              </span>
            </div>

            <!-- Student ID input -->
            <div class="mt-1.5 flex items-center gap-2">
              <label for="student-sbd" class="text-xs font-medium text-neutral-400">SBD:</label>
              <input
                id="student-sbd"
                v-model="editableSBD"
                type="text"
                placeholder="e.g. 9101"
                class="w-28 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 font-mono text-sm font-bold focus:border-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-800"
                @input="isDirty = true"
              />
            </div>
          </div>

          <!-- Score display -->
          <div class="text-right">
            <div class="flex items-baseline justify-end gap-1">
              <span class="text-4xl font-black tabular-nums tracking-tight text-neutral-900 dark:text-white">
                {{ formatScore(recalculated.score) }}
              </span>
              <span class="text-sm font-semibold text-neutral-400">/10</span>
            </div>
            <p class="text-xs text-neutral-500">
              {{ recalculated.correctCount }} / {{ recalculated.totalCount }} Correct
            </p>
          </div>
        </div>

        <!-- Dirty / Save action bar -->
        <div v-if="isDirty || saveSuccess" class="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <span v-if="isDirty" class="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertCircle class="size-3.5" /> Unsaved adjustments
          </span>
          <span v-else-if="saveSuccess" class="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check class="size-3.5" /> Saved & marked for sync
          </span>

          <div class="flex items-center gap-2 ml-auto">
            <button
              v-if="isDirty"
              class="flex items-center gap-1 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 active:scale-95 dark:border-neutral-700 dark:text-neutral-300"
              @click="resetChanges"
            >
              <RotateCcw class="size-3" /> Reset
            </button>
            <button
              v-if="isDirty"
              id="save-override-btn"
              class="flex items-center gap-1 rounded-full bg-emerald-600 px-4 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95"
              @click="saveChanges"
            >
              <Save class="size-3" /> Save Changes
            </button>
          </div>
        </div>
      </section>

      <!-- Flattened OpenCV Output Sheet Preview -->
      <section class="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white shadow-sm dark:border-neutral-800/80 dark:bg-[#18181b]">
        <div class="flex items-center justify-between border-b border-neutral-200/80 px-4 py-3 dark:border-neutral-800/80">
          <div class="flex items-center gap-2">
            <ImageIcon class="size-4 text-neutral-500" />
            <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Flattened OMR Sheet
            </h2>
          </div>
          <span class="text-[11px] text-neutral-400">OpenCV Perspective Transform</span>
        </div>

        <div class="relative bg-neutral-950 p-2 flex items-center justify-center min-h-[160px] max-h-[300px] overflow-hidden">
          <img
            v-if="imageUrl"
            :src="imageUrl"
            alt="Flattened Scan"
            class="max-h-[280px] w-auto rounded-lg object-contain shadow-md"
          />
          <div v-else class="flex flex-col items-center gap-2 py-8 text-neutral-500">
            <ImageIcon class="size-8 stroke-1" />
            <span class="text-xs">No warped image blob saved for this scan</span>
          </div>
        </div>
      </section>

      <!-- Question-by-Question Override Grid -->
      <section class="space-y-3">
        <div class="flex items-center justify-between px-1">
          <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Answer Bubbles Override
          </h2>
          <span class="text-xs text-neutral-400">Tap any bubble to correct misread erased marks</span>
        </div>

        <div class="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white divide-y divide-neutral-200/80 shadow-sm dark:border-neutral-800/80 dark:bg-[#18181b] dark:divide-neutral-800/80">
          <div
            v-for="(expected, index) in (exam?.expectedAnswers || [])"
            :key="index"
            class="flex items-center justify-between px-4 py-3 transition hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30"
            :class="[
              editableAnswers[index] === expected
                ? ''
                : 'bg-rose-500/[0.03] dark:bg-rose-500/[0.05]',
            ]"
          >
            <!-- Question Number & Key Indicator -->
            <div class="flex items-center gap-3 w-24">
              <span class="font-mono text-xs font-bold text-neutral-500">
                Q{{ String(index + 1).padStart(2, '0') }}
              </span>
              <span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-bold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                Key: {{ expected }}
              </span>
            </div>

            <!-- Bubble selector buttons: A, B, C, D -->
            <div class="flex items-center gap-2">
              <button
                v-for="opt in ANSWER_OPTIONS"
                :key="opt"
                :id="`q${index + 1}-opt-${opt}`"
                class="grid size-9 place-items-center rounded-full font-bold text-xs transition active:scale-90"
                :class="[
                  editableAnswers[index] === opt
                    ? opt === expected
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-rose-600 text-white shadow-sm'
                    : 'border border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
                ]"
                @click="selectAnswer(index, opt)"
              >
                {{ opt }}
              </button>

              <!-- Clear bubble button -->
              <button
                class="ml-1 text-[11px] font-medium text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 px-1.5 py-1"
                title="Mark Blank"
                @click="clearAnswer(index)"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>
