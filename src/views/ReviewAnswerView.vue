<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  Image as ImageIcon,
  RotateCcw,
  Save,
  Check,
  Maximize2,
  Minimize2,
  ChevronLeft,
  Sparkles,
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
const isImageModalOpen = ref(false);
const isDirty = ref(false);
const saveSuccess = ref(false);

// Local editable copy of answers and student ID
const editableAnswers = ref<(AnswerOption | null)[]>([]);
const editableSBD = ref<string>('');

// Recalculated live score metrics
const recalculated = computed(() => {
  if (!exam.value) return { score: 0, wrongAnswers: [], correctCount: 0, totalCount: 0 };
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
    router.replace('/history');
    return;
  }
  scan.value = foundScan;
  editableAnswers.value = [...foundScan.answers];
  editableSBD.value = foundScan.studentSBD || '';

  if (foundScan.imageBlob) {
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
    imageUrl.value = URL.createObjectURL(foundScan.imageBlob);
  }

  const foundExam = await db.exams.get(foundScan.examId);
  if (foundExam) {
    exam.value = foundExam;
  }
}

function selectAnswer(questionIdx: number, option: AnswerOption) {
  void haptic.light();
  const current = editableAnswers.value[questionIdx];
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
  }, 2500);
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
  router.push('/history');
}

function scanNext() {
  void haptic.medium();
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
  <div class="min-h-screen bg-neutral-100 pb-28 text-neutral-900 transition-colors dark:bg-neutral-950 dark:text-neutral-100">
    <!-- Sub-header -->
    <div class="sticky top-16 z-30 border-b border-black/5 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-900/80">
      <div class="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
        <button
          class="flex min-h-[44px] items-center gap-1.5 text-xs font-bold text-neutral-600 transition active:scale-95 dark:text-neutral-400"
          @click="goBack"
        >
          <ChevronLeft class="size-4" />
          <span>History</span>
        </button>

        <div class="text-center">
          <span class="text-xs font-bold">Paper Audit & Correction</span>
          <span v-if="exam" class="ml-1 text-[11px] text-neutral-400 font-mono">Code {{ exam.answerKeyCode }}</span>
        </div>

        <button
          class="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-neutral-900 px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-95 dark:bg-white dark:text-neutral-950"
          @click="scanNext"
        >
          <Camera class="size-3.5" />
          <span>Next Scan</span>
        </button>
      </div>
    </div>

    <main class="mx-auto max-w-4xl px-4 pt-5 space-y-5">
      <!-- Candidate & Score Overview Banner -->
      <section class="rounded-3xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Candidate Information</span>
              <span
                v-if="scan?.manuallyEdited"
                class="rounded-md bg-purple-500/10 px-2 py-0.5 text-[10px] font-bold text-purple-600 dark:text-purple-300"
              >
                Manually Overridden
              </span>
            </div>

            <div class="mt-2 flex items-center gap-2">
              <label for="review-sbd-input" class="text-xs font-semibold text-neutral-400">SBD:</label>
              <input
                id="review-sbd-input"
                v-model="editableSBD"
                type="text"
                placeholder="e.g. 9101"
                class="w-32 min-h-[44px] rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1 font-mono text-sm font-bold focus:border-neutral-900 focus:outline-none dark:border-neutral-800 dark:bg-neutral-800"
                @input="isDirty = true"
              />
            </div>
          </div>

          <!-- Score & Accuracy Metrics -->
          <div class="flex items-center gap-6">
            <div class="text-right">
              <p class="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Accuracy</p>
              <p class="text-lg font-bold">
                {{ recalculated.totalCount ? Math.round((recalculated.correctCount / recalculated.totalCount) * 100) : 0 }}%
              </p>
              <p class="text-[11px] text-neutral-500">
                {{ recalculated.correctCount }} / {{ recalculated.totalCount }} Correct
              </p>
            </div>

            <div class="text-right border-l border-neutral-200 pl-6 dark:border-neutral-800">
              <p class="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Total Score</p>
              <div class="flex items-baseline justify-end gap-1">
                <span class="text-4xl font-black tabular-nums tracking-tight text-neutral-900 dark:text-white">
                  {{ formatScore(recalculated.score) }}
                </span>
                <span class="text-sm font-semibold text-neutral-400">/10</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Dirty Status / Save Bar -->
        <div v-if="isDirty || saveSuccess" class="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <span v-if="isDirty" class="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <AlertCircle class="size-4" /> Unsaved changes in bubbles or student ID
          </span>
          <span v-else-if="saveSuccess" class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <Check class="size-4" /> Adjustments saved & scheduled for cloud sync
          </span>

          <div class="flex items-center gap-2 ml-auto">
            <button
              v-if="isDirty"
              class="min-h-[44px] rounded-xl border border-neutral-200 px-3.5 text-xs font-semibold text-neutral-600 active:scale-95 dark:border-neutral-700 dark:text-neutral-300"
              @click="resetChanges"
            >
              Reset
            </button>
            <button
              v-if="isDirty"
              id="review-save-changes-btn"
              class="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white shadow-md transition hover:bg-emerald-500 active:scale-95"
              @click="saveChanges"
            >
              <Save class="size-4" /> Save Changes
            </button>
          </div>
        </div>
      </section>

      <!-- OpenCV Flattened Image Output Section -->
      <section class="overflow-hidden rounded-3xl border border-black/5 bg-white shadow-sm dark:border-white/10 dark:bg-neutral-900">
        <div class="flex items-center justify-between border-b border-black/5 px-5 py-3 dark:border-white/5">
          <div class="flex items-center gap-2">
            <ImageIcon class="size-4 text-neutral-500" />
            <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              OpenCV Perspective-Corrected Output
            </h2>
          </div>
          <button
            v-if="imageUrl"
            class="flex items-center gap-1 text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            @click="isImageModalOpen = true"
          >
            <Maximize2 class="size-3.5" />
            <span>Full Image</span>
          </button>
        </div>

        <div class="relative bg-neutral-950 p-3 flex items-center justify-center min-h-[180px] max-h-[340px] overflow-hidden">
          <img
            v-if="imageUrl"
            :src="imageUrl"
            alt="Flattened OMR Sheet"
            class="max-h-[320px] w-auto rounded-lg object-contain shadow-md cursor-pointer transition hover:opacity-95"
            @click="isImageModalOpen = true"
          />
          <div v-else class="flex flex-col items-center gap-2 py-8 text-neutral-500">
            <ImageIcon class="size-8 stroke-1" />
            <span class="text-xs">No image blob attached to this scan</span>
          </div>
        </div>
      </section>

      <!-- Detailed Wrong Bubbles Highlight & Override Grid -->
      <section class="space-y-3">
        <div class="flex items-center justify-between px-1">
          <div>
            <h2 class="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Detailed Question Analysis & Bubble Overrides
            </h2>
            <p class="text-[11px] text-neutral-400">
              Green = Correct · Red = Misread / Wrong · Tap any bubble to correct an erased mark
            </p>
          </div>
          <span class="text-xs font-mono font-bold text-rose-500">
            {{ recalculated.wrongAnswers.length }} Incorrect
          </span>
        </div>

        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div
            v-for="(expected, index) in (exam?.expectedAnswers || [])"
            :key="index"
            class="flex items-center justify-between rounded-2xl border p-3 transition"
            :class="[
              editableAnswers[index] === expected
                ? 'border-emerald-500/20 bg-emerald-500/[0.02] dark:border-emerald-500/10'
                : editableAnswers[index] === null
                ? 'border-amber-500/30 bg-amber-500/[0.04]'
                : 'border-rose-500/30 bg-rose-500/[0.05]',
            ]"
          >
            <!-- Question Number & Status -->
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-xs font-black w-8">
                Q{{ String(index + 1).padStart(2, '0') }}
              </span>

              <!-- Status badge -->
              <div>
                <div class="flex items-center gap-1">
                  <CheckCircle2 v-if="editableAnswers[index] === expected" class="size-3.5 text-emerald-500" />
                  <XCircle v-else-if="editableAnswers[index] !== null" class="size-3.5 text-rose-500" />
                  <AlertCircle v-else class="size-3.5 text-amber-500" />

                  <span class="text-xs font-bold font-mono">
                    Key: {{ expected }}
                  </span>
                </div>
                <div class="text-[10px] text-neutral-400">
                  Read: <strong class="font-mono">{{ editableAnswers[index] || 'Blank' }}</strong>
                </div>
              </div>
            </div>

            <!-- Bubble selector buttons (Min 44x44px Touch Target) -->
            <div class="flex items-center gap-1.5">
              <button
                v-for="opt in ANSWER_OPTIONS"
                :key="opt"
                class="grid size-11 place-items-center rounded-xl font-bold text-xs transition active:scale-90"
                :class="[
                  editableAnswers[index] === opt
                    ? opt === expected
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-rose-600 text-white shadow-sm ring-2 ring-rose-400'
                    : opt === expected
                    ? 'border-2 border-dashed border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
                ]"
                :title="opt === expected ? 'Correct Answer Key' : `Mark ${opt}`"
                @click="selectAnswer(index, opt)"
              >
                {{ opt }}
              </button>

              <button
                class="min-h-[44px] px-2 text-[11px] font-semibold text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                title="Mark blank"
                @click="clearAnswer(index)"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Full Image Modal -->
    <div
      v-if="isImageModalOpen && imageUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md"
      @click.self="isImageModalOpen = false"
    >
      <div class="relative max-h-[90vh] max-w-2xl">
        <img :src="imageUrl" alt="Full OMR Scan" class="max-h-[85vh] w-auto rounded-2xl object-contain shadow-2xl" />
        <button
          class="absolute top-3 right-3 grid size-11 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md active:scale-90"
          @click="isImageModalOpen = false"
        >
          <Minimize2 class="size-5" />
        </button>
      </div>
    </div>
  </div>
</template>
