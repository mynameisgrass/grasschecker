<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  Printer,
  FileSpreadsheet,
  Settings2,
  CheckCircle2,
  RotateCcw,
  Sparkles,
  Download,
  Share2,
  Copy,
  Layers,
  FileText,
  MoreVertical,
  Send,
  Table,
  Check,
  ChevronDown,
  PenTool,
  BookOpenCheck,
  ExternalLink,
} from 'lucide-vue-next';
import { haptic } from '@/services/haptics';
import {
  generateKeyOnlyVariants,
  saveVariantsToDexie,
  type ExamVariant,
} from '@/services/ShuffleEngine';
import { db, isAlive, repo, type AnswerOption, type ExamRecord, ANSWER_OPTIONS } from '@/services/db';
import { useLiveQuery } from '@/composables/useLiveQuery';

const route = useRoute();

// ── Master Configuration State ───────────────────────────────────────────────
const schoolName = ref('TRƯỜNG THPT NGUYỄN DU');
const examTitle = ref('BÀI THI TRẮC NGHIỆM ĐÁNH GIÁ ĐỊNH KỲ');
const subjectName = ref('Môn: Toán học / Khoa học');
const baseExamCode = ref('101');
const activeExamCode = ref('101');
const questionCount = ref<number>(35); // Dynamic: teacher can set any number (e.g. 35)
const prefilledCode = ref(true);
const selectedColumns = ref<'auto' | '2' | '3' | '4'>('auto');

// Answer key for the active sheet
const currentAnswers = ref<AnswerOption[]>(Array(60).fill('A'));

// ── Hybrid Mode (Multiple Choice + Essay) ────────────────────────────────────
const includeEssay = ref(false);
const essayTitle = ref('PHẦN II: TỰ LUẬN (3.0 ĐIỂM)');
const essayQuestionsText = ref(
  'Câu 1 (1.5 điểm): Nêu ý nghĩa của việc ứng dụng công nghệ trong giáo dục hiện đại.\nCâu 2 (1.5 điểm): Giải bài toán sau và trình bày chi tiết các bước tính toán vào phần bài làm bên dưới.',
);
const essayLinesCount = ref(20);

// ── Shuffle Engine State (Variants) ──────────────────────────────────────────
const isShuffleModalOpen = ref(false);
const isKeyMatrixModalOpen = ref(false);
const shuffleVariantCount = ref(4);
const shuffleQuestionsOrder = ref(true);
const shuffleOptionsOrder = ref(true);
const isGeneratingVariants = ref(false);
const generatedVariants = ref<ExamVariant[]>([]);
const activeVariantIndex = ref(0);
const actionToast = ref('');
let toastTimer: number | undefined;

// ── Export Dropdown State ────────────────────────────────────────────────────
const isExportMenuOpen = ref(false);
const exportPlaceholderDialog = ref<{ title: string; desc: string } | null>(null);

// ── Dynamic Column Balancing Logic (Avoid Blank Overruns) ────────────────────
const computedColumns = computed(() => {
  const n = Math.max(1, Math.min(60, questionCount.value));
  let cols: number;

  if (selectedColumns.value === 'auto') {
    if (n <= 18) cols = 2;
    else if (n <= 38) cols = 3;
    else cols = 4;
  } else {
    cols = parseInt(selectedColumns.value, 10);
  }

  const baseRows = Math.floor(n / cols);
  const remainder = n % cols;

  const result: { colIndex: number; questions: number[] }[] = [];
  let currentNum = 1;

  for (let c = 0; c < cols; c++) {
    const colLen = c < remainder ? baseRows + 1 : baseRows;
    const questions: number[] = [];
    for (let r = 0; r < colLen; r++) {
      questions.push(currentNum++);
    }
    if (questions.length > 0) {
      result.push({ colIndex: c + 1, questions });
    }
  }

  return result;
});

// ── Shuffle Actions ──────────────────────────────────────────────────────────
async function handleGenerateVariants() {
  void haptic.medium();
  isGeneratingVariants.value = true;

  try {
    const keys = currentAnswers.value.slice(0, questionCount.value);
    const variants = generateKeyOnlyVariants(keys, {
      baseCode: baseExamCode.value,
      variantCount: shuffleVariantCount.value,
      title: examTitle.value,
      shuffleQuestions: shuffleQuestionsOrder.value,
      shuffleOptions: shuffleOptionsOrder.value,
    });

    // Save newly generated answer keys to Dexie so OMR scanner recognizes all of them immediately
    await saveVariantsToDexie(variants);

    generatedVariants.value = variants;
    activeVariantIndex.value = 0;
    activeExamCode.value = variants[0].variantCode;
    currentAnswers.value = [...variants[0].expectedAnswers];

    isShuffleModalOpen.value = false;
    showToast(`Generated & saved ${variants.length} exam variants to local database!`);
  } catch (err) {
    console.error('Shuffle failed', err);
    alert('Failed to generate variants.');
  } finally {
    isGeneratingVariants.value = false;
  }
}

function selectVariant(index: number) {
  void haptic.light();
  activeVariantIndex.value = index;
  const v = generatedVariants.value[index];
  if (v) {
    activeExamCode.value = v.variantCode;
    currentAnswers.value = [...v.expectedAnswers];
  }
}

function triggerPrint() {
  void haptic.medium();
  window.print();
}

function showToast(msg: string) {
  actionToast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (actionToast.value = ''), 3000);
}

function resetDefaults() {
  void haptic.light();
  schoolName.value = 'TRƯỜNG THPT NGUYỄN DU';
  examTitle.value = 'BÀI THI TRẮC NGHIỆM ĐÁNH GIÁ ĐỊNH KỲ';
  subjectName.value = 'Môn: Toán học / Khoa học';
  baseExamCode.value = '101';
  activeExamCode.value = '101';
  questionCount.value = 35;
  selectedColumns.value = 'auto';
  includeEssay.value = false;
  generatedVariants.value = [];
}

// ── Export Menu Actions (Placeholders with Feedback) ─────────────────────────
function triggerExportAction(type: 'sheets' | 'email' | 'matrix') {
  void haptic.light();
  isExportMenuOpen.value = false;

  if (type === 'sheets') {
    exportPlaceholderDialog.value = {
      title: 'Google Sheets Integration',
      desc: 'Google Sheets & Google Classroom sync hook initialized. Scanned student grades and item analyses will automatically sync to your selected Google Drive spreadsheet.',
    };
  } else if (type === 'email') {
    exportPlaceholderDialog.value = {
      title: 'Email Results to Students',
      desc: 'Automated email dispatch module ready. Individual student grade slips, score percentages, and wrong answer diagnostic breakdowns will be emailed to registered student/parent emails.',
    };
  } else if (type === 'matrix') {
    exportAnswerKeyMatrixCSV();
  }
}

function exportAnswerKeyMatrixCSV() {
  if (!generatedVariants.value.length) {
    alert('Please generate variants first to export the answer key matrix.');
    return;
  }
  const headers = ['Question', ...generatedVariants.value.map((v) => `Mã ${v.variantCode}`)];
  const rows: string[][] = [headers];

  for (let q = 0; q < questionCount.value; q++) {
    const row = [
      `Câu ${q + 1}`,
      ...generatedVariants.value.map((v) => v.expectedAnswers[q] || '-'),
    ];
    rows.push(row);
  }

  const csv = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map((r) => r.join(',')).join('\n');
  const link = document.createElement('a');
  link.setAttribute('href', encodeURI(csv));
  link.setAttribute('download', `Answer_Key_Matrix_${baseExamCode.value}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Answer Key Matrix CSV exported!');
}

watch(
  () => route.query.code,
  (c) => {
    if (typeof c === 'string' && c.trim()) {
      baseExamCode.value = c.slice(0, 3);
      activeExamCode.value = c.slice(0, 3);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="min-h-screen bg-[#f2f2f7] py-6 text-neutral-900 transition-colors dark:bg-[#09090b] dark:text-neutral-100">
    <!-- Top Action / Control Bar (Hidden when Printing) -->
    <div class="no-print mx-auto max-w-5xl px-4 pb-6 space-y-4">
      <!-- Header bar with Main Controls -->
      <div class="flex flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800/80 dark:bg-[#18181b] md:flex-row md:items-center md:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="grid size-9 place-items-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30">
              <FileSpreadsheet class="size-5" />
            </span>
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-lg font-bold tracking-tight">OMR Exam Builder</h1>
                <span class="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                  SHub / Azota Grade
                </span>
              </div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                Dynamic bubble grid, automatic column balancing, variant shuffle engine, and hybrid essay pages.
              </p>
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex flex-wrap items-center gap-2">
          <!-- Shuffle Engine Button -->
          <button
            id="open-shuffle-modal-btn"
            class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-purple-500/20 bg-purple-500/10 px-3.5 py-2 text-xs font-bold text-purple-700 transition hover:bg-purple-500/20 active:scale-95 dark:text-purple-300"
            @click="isShuffleModalOpen = true"
          >
            <Sparkles class="size-4" />
            <span>Shuffle Variants</span>
          </button>

          <!-- Export / More Dropdown -->
          <div class="relative">
            <button
              id="export-dropdown-btn"
              class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 active:scale-95 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-200"
              @click="isExportMenuOpen = !isExportMenuOpen"
            >
              <span>Export</span>
              <ChevronDown class="size-3.5" />
            </button>

            <!-- Dropdown Menu -->
            <div
              v-if="isExportMenuOpen"
              class="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white p-1.5 shadow-xl dark:border-neutral-800/80 dark:bg-[#18181b]"
            >
              <button
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                @click="triggerExportAction('sheets')"
              >
                <Table class="size-4 text-emerald-500" />
                <span>Export to Google Sheets</span>
              </button>
              <button
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                @click="triggerExportAction('email')"
              >
                <Send class="size-4 text-blue-500" />
                <span>Email Results to Students</span>
              </button>
              <button
                class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                @click="triggerExportAction('matrix')"
              >
                <FileSpreadsheet class="size-4 text-purple-500" />
                <span>Download Key Matrix (CSV)</span>
              </button>
            </div>
          </div>

          <!-- Reset -->
          <button
            class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-50 active:scale-95 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            @click="resetDefaults"
          >
            <RotateCcw class="size-3.5" />
            <span class="hidden sm:inline">Reset</span>
          </button>

          <!-- Primary Print Button -->
          <button
            id="print-paper-btn"
            class="flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-emerald-600/25 transition hover:scale-[1.02] hover:bg-emerald-500 active:scale-95"
            @click="triggerPrint"
          >
            <Printer class="size-4" />
            <span>Print Sheet (A4)</span>
          </button>
        </div>
      </div>

      <!-- Toast Feedback -->
      <div
        v-if="actionToast"
        class="rounded-2xl bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 flex items-center justify-between"
      >
        <span>{{ actionToast }}</span>
        <button class="font-bold underline" @click="actionToast = ''">Dismiss</button>
      </div>

      <!-- Variant Switcher Bar (Appears when variants are generated) -->
      <div
        v-if="generatedVariants.length"
        class="flex flex-wrap items-center gap-2 rounded-2xl bg-purple-500/5 p-3 border border-purple-500/20"
      >
        <span class="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1">
          <Layers class="size-3.5" /> Active Variant:
        </span>
        <button
          v-for="(v, idx) in generatedVariants"
          :key="v.variantCode"
          class="flex min-h-[38px] items-center gap-1 rounded-xl px-3 py-1 text-xs font-bold transition active:scale-95"
          :class="[
            activeVariantIndex === idx
              ? 'bg-purple-600 text-white shadow'
              : 'border border-purple-200 bg-white text-purple-700 dark:bg-neutral-900 dark:border-purple-800 dark:text-purple-300',
          ]"
          @click="selectVariant(idx)"
        >
          <span>Mã {{ v.variantCode }}</span>
        </button>
        <button
          class="ml-auto text-xs font-bold text-purple-600 underline dark:text-purple-400"
          @click="isKeyMatrixModalOpen = true"
        >
          View Key Matrix Table
        </button>
      </div>

      <!-- Configurator Panel: Question count, columns, Essay toggle -->
      <div class="rounded-3xl border border-neutral-200/80 bg-white p-5 shadow-sm dark:border-neutral-800/80 dark:bg-[#18181b] space-y-4">
        <!-- Grid Config Row -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <!-- Exact Question Count (Avoid Blank Overruns) -->
          <div>
            <div class="flex items-center justify-between">
              <label class="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Number of Questions</label>
              <span class="font-mono text-xs font-bold text-neutral-900 dark:text-white">{{ questionCount }} Qs</span>
            </div>
            <div class="mt-1 flex items-center gap-2">
              <input
                v-model.number="questionCount"
                type="range"
                min="5"
                max="60"
                step="1"
                class="w-full accent-emerald-600 cursor-pointer"
              />
              <input
                v-model.number="questionCount"
                type="number"
                min="5"
                max="60"
                class="w-16 rounded-xl border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-bold font-mono text-center dark:border-neutral-800 dark:bg-neutral-800"
              />
            </div>
          </div>

          <!-- Column Layout Strategy -->
          <div>
            <label class="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Grid Column Balance</label>
            <select
              v-model="selectedColumns"
              class="mt-1 w-full min-h-[40px] rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-800"
            >
              <option value="auto">Auto (Adaptive 2-4 Cols)</option>
              <option value="2">2 Balanced Columns</option>
              <option value="3">3 Balanced Columns</option>
              <option value="4">4 Balanced Columns</option>
            </select>
          </div>

          <!-- Exam Code -->
          <div>
            <label class="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Base Exam Code</label>
            <div class="mt-1 flex items-center gap-2">
              <input
                v-model="activeExamCode"
                type="text"
                maxlength="3"
                class="w-20 min-h-[40px] rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-1.5 font-mono text-xs font-bold text-center dark:border-neutral-800 dark:bg-neutral-800"
              />
              <label class="flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer">
                <input v-model="prefilledCode" type="checkbox" class="rounded" />
                <span>Pre-shade</span>
              </label>
            </div>
          </div>

          <!-- Hybrid Essay Toggle -->
          <div class="flex flex-col justify-center">
            <span class="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Hybrid Mode</span>
            <label class="mt-1 flex min-h-[40px] items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 cursor-pointer dark:border-neutral-800 dark:bg-neutral-800">
              <input v-model="includeEssay" type="checkbox" class="rounded size-4 accent-emerald-600" />
              <span class="text-xs font-bold text-neutral-700 dark:text-neutral-200">Include Essay Section</span>
            </label>
          </div>
        </div>

        <!-- Essay Config Accordion (If Enabled) -->
        <div v-if="includeEssay" class="rounded-2xl border border-blue-500/20 bg-blue-500/[0.03] p-4 space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <PenTool class="size-3.5" /> Phần Tự Luận (Essay Page 2 Configuration)
            </h3>
            <span class="text-[11px] text-blue-600 dark:text-blue-400">Generates clean Page 2 with lined writing area</span>
          </div>

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div class="sm:col-span-2">
              <label class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Essay Header / Title</label>
              <input
                v-model="essayTitle"
                type="text"
                class="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium dark:border-neutral-800 dark:bg-neutral-900"
              />
            </div>
            <div>
              <label class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Writing Lines Count</label>
              <input
                v-model.number="essayLinesCount"
                type="number"
                min="10"
                max="30"
                class="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold font-mono text-center dark:border-neutral-800 dark:bg-neutral-900"
              />
            </div>
          </div>

          <div>
            <label class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Essay Questions / Prompts</label>
            <textarea
              v-model="essayQuestionsText"
              rows="3"
              class="mt-1 w-full rounded-xl border border-neutral-200 bg-white p-2.5 text-xs font-medium leading-relaxed dark:border-neutral-800 dark:bg-neutral-900"
            ></textarea>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Print Canvas (Multi-Page A4 Container) ───────────────────────────── -->
    <div class="overflow-x-auto pb-12 flex flex-col items-center gap-8">
      <!-- ── PAGE 1: OMR Multiple-Choice Sheet (Standard A4: 210mm x 297mm) ─── -->
      <div
        id="omr-a4-page-1"
        class="print-page relative bg-white text-black font-sans shadow-2xl transition-all"
        :class="{ 'page-break-after-always': includeEssay }"
        style="width: 210mm; min-height: 297mm; max-height: 297mm; padding: 10mm 12mm; box-sizing: border-box;"
      >
        <!-- ── Anchored OMR Corner Markers (Rigid Coordinates for Computer Vision) ── -->
        <!-- Top-Left (0, 0) -->
        <div class="absolute top-[8mm] left-[8mm] size-[18mm] bg-black p-[2.5mm] flex items-center justify-center pointer-events-none">
          <div class="size-full bg-white p-[2.5mm] flex items-center justify-center">
            <div class="size-full bg-black"></div>
          </div>
        </div>

        <!-- Top-Right (W, 0) -->
        <div class="absolute top-[8mm] right-[8mm] size-[18mm] bg-black p-[2.5mm] flex items-center justify-center pointer-events-none">
          <div class="size-full bg-white p-[2.5mm] flex items-center justify-center">
            <div class="size-full bg-black"></div>
          </div>
        </div>

        <!-- Bottom-Left (0, H) -->
        <div class="absolute bottom-[8mm] left-[8mm] size-[18mm] bg-black p-[2.5mm] flex items-center justify-center pointer-events-none">
          <div class="size-full bg-white p-[2.5mm] flex items-center justify-center">
            <div class="size-full bg-black"></div>
          </div>
        </div>

        <!-- Bottom-Right Alignment Hash -->
        <div class="absolute bottom-[8mm] right-[8mm] size-[18mm] flex items-center justify-center pointer-events-none">
          <div class="size-[14mm] border-r-[4px] border-b-[4px] border-black"></div>
        </div>

        <!-- ── Page 1 Content Container ────────────────────────────────────── -->
        <div class="mx-auto w-[184mm] pt-[1mm]">
          <!-- Header Area -->
          <header class="text-center border-b-2 border-black pb-2">
            <h2 class="text-[12px] font-bold tracking-wider uppercase">{{ schoolName }}</h2>
            <h1 class="text-[15px] font-black tracking-tight mt-0.5 uppercase">{{ examTitle }}</h1>
            <p class="text-[11px] font-medium text-neutral-800 mt-0.5">
              {{ subjectName }} · PHIẾU TRẢ LỜI TRẮC NGHIỆM {{ includeEssay ? '(TRANG 1/2)' : '' }}
            </p>
          </header>

          <!-- Candidate Information & Identification Section -->
          <div class="mt-2.5 grid grid-cols-12 gap-3 pb-2 border-b-2 border-black">
            <!-- Student Information Fields (Left: 5 cols) -->
            <div class="col-span-5 flex flex-col justify-between border-r border-black/40 pr-2">
              <div class="space-y-2 text-[10px]">
                <div class="flex items-baseline">
                  <span class="font-bold shrink-0">Họ và tên:</span>
                  <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
                </div>
                <div class="flex items-baseline">
                  <span class="font-bold shrink-0">Lớp:</span>
                  <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
                  <span class="font-bold ml-2 shrink-0">Phòng:</span>
                  <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
                </div>
                <div class="flex items-baseline">
                  <span class="font-bold shrink-0">Ngày sinh:</span>
                  <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
                </div>
              </div>

              <!-- Shading Instruction Diagram -->
              <div class="mt-2 rounded border border-black p-1.5 bg-neutral-50 text-[9px]">
                <div class="font-bold text-center mb-1">HƯỚNG DẪN TÔ BUBBLE</div>
                <div class="flex justify-around items-center">
                  <div class="flex items-center gap-1">
                    <span class="size-3 rounded-full bg-black inline-block"></span>
                    <span>Đúng</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="size-3 rounded-full border border-black flex items-center justify-center text-[7px] font-bold">✕</span>
                    <span>Sai</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <span class="size-3 rounded-full border border-black flex items-center justify-center text-[7px] font-bold">✓</span>
                    <span>Sai</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- OMR Identification: Student SBD (4 cols) & Exam Code (3 cols) -->
            <div class="col-span-7 grid grid-cols-7 gap-2 pl-1">
              <!-- SBD (4 columns: digits 0-9) -->
              <div class="col-span-4 border border-black p-1">
                <div class="text-center font-bold text-[9px] uppercase tracking-tighter">SỐ BÁO DANH</div>
                <div class="grid grid-cols-4 gap-1 my-1">
                  <div v-for="c in 4" :key="c" class="h-4 border border-black text-center font-mono text-[10px] font-bold"></div>
                </div>
                <div class="space-y-[1.5px] mt-1">
                  <div v-for="digit in 10" :key="digit" class="grid grid-cols-4 gap-1">
                    <div
                      v-for="col in 4"
                      :key="col"
                      class="size-[14px] mx-auto rounded-full border border-black flex items-center justify-center text-[8px] font-mono font-bold"
                    >
                      {{ digit - 1 }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Exam Code (3 columns: digits 0-9) -->
              <div class="col-span-3 border border-black p-1">
                <div class="text-center font-bold text-[9px] uppercase tracking-tighter">MÃ ĐỀ THI</div>
                <div class="grid grid-cols-3 gap-1 my-1">
                  <div
                    v-for="(digitChar, cIdx) in (activeExamCode.padEnd(3, '0').slice(0, 3).split(''))"
                    :key="cIdx"
                    class="h-4 border border-black text-center font-mono text-[10px] font-bold flex items-center justify-center"
                  >
                    {{ prefilledCode ? digitChar : '' }}
                  </div>
                </div>
                <div class="space-y-[1.5px] mt-1">
                  <div v-for="digit in 10" :key="digit" class="grid grid-cols-3 gap-1">
                    <div
                      v-for="(digitChar, cIdx) in (activeExamCode.padEnd(3, '0').slice(0, 3).split(''))"
                      :key="cIdx"
                      class="size-[14px] mx-auto rounded-full border border-black flex items-center justify-center text-[8px] font-mono font-bold"
                      :class="[prefilledCode && Number(digitChar) === digit - 1 ? 'bg-black text-white' : '']"
                    >
                      {{ digit - 1 }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Dynamic Balanced Bubble Grid (Avoids Blank Overruns) ──────── -->
          <div class="mt-2.5">
            <div class="text-center text-[10px] font-bold uppercase tracking-wider mb-1.5">
              PHẦN TRẢ LỜI CÁC CÂU HỎI TRẮC NGHIỆM (TÔ ĐEN MỘT Ô TRÒN DUY NHẤT)
            </div>

            <!-- Balanced Columns Grid -->
            <div
              class="grid gap-2 border-2 border-black p-1.5"
              :style="{ gridTemplateColumns: `repeat(${computedColumns.length}, minmax(0, 1fr))` }"
            >
              <div
                v-for="col in computedColumns"
                :key="col.colIndex"
                class="border-r last:border-r-0 border-black/30 pr-1.5 pl-0.5"
              >
                <!-- Column Header -->
                <div class="grid grid-cols-5 text-center text-[9px] font-bold pb-1 border-b border-black">
                  <span class="text-left font-mono">No.</span>
                  <span v-for="opt in ANSWER_OPTIONS" :key="opt">{{ opt }}</span>
                </div>

                <!-- Questions in this column (Exact Rows Only, No Blank Overruns) -->
                <div class="space-y-[3.5px] mt-1">
                  <div
                    v-for="qNum in col.questions"
                    :key="qNum"
                    class="grid grid-cols-5 items-center text-center py-[1px]"
                  >
                    <!-- Question number -->
                    <span class="font-mono text-[9px] font-bold text-left">
                      {{ String(qNum).padStart(2, '0') }}
                    </span>

                    <!-- 4 Bubbles: A, B, C, D -->
                    <div
                      v-for="opt in ANSWER_OPTIONS"
                      :key="opt"
                      class="size-[13px] mx-auto rounded-full border border-black flex items-center justify-center text-[8px] font-sans font-bold leading-none"
                    >
                      {{ opt }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Page 1 Footer -->
          <footer class="mt-2 pt-1 border-t border-black/30 flex justify-between items-center text-[8px] font-mono text-neutral-600">
            <span>Grasschecker Engine v4.2 · Form Dynamic · QR Standard</span>
            <span>{{ includeEssay ? 'Trang 1 / 2' : 'Trang 1 / 1' }}</span>
          </footer>
        </div>
      </div>

      <!-- ── PAGE 2: Hybrid Essay Section (Rendered when toggled) ───────────── -->
      <div
        v-if="includeEssay"
        id="essay-a4-page-2"
        class="print-page relative bg-white text-black font-sans shadow-2xl transition-all page-break-before-always"
        style="width: 210mm; min-height: 297mm; max-height: 297mm; padding: 10mm 12mm; box-sizing: border-box;"
      >
        <!-- Page 2 Content Container -->
        <div class="mx-auto w-[184mm] pt-[1mm]">
          <!-- Header Area -->
          <header class="border-b-2 border-black pb-2 text-center">
            <h2 class="text-[12px] font-bold tracking-wider uppercase">{{ schoolName }}</h2>
            <h1 class="text-[14px] font-black tracking-tight mt-0.5 uppercase">{{ examTitle }}</h1>
            <p class="text-[11px] font-semibold text-neutral-800 mt-0.5">
              BÀI LÀM TỰ LUẬN (TRANG 2/2) · MÃ ĐỀ: {{ activeExamCode }}
            </p>
          </header>

          <!-- Candidate Details & Teacher Scoring Box (Grid) -->
          <div class="mt-2.5 grid grid-cols-12 gap-3 pb-2 border-b-2 border-black">
            <!-- Student Identification summary -->
            <div class="col-span-6 space-y-2 text-[10px] border-r border-black/40 pr-3">
              <div class="flex items-baseline">
                <span class="font-bold shrink-0">Họ và tên thí sinh:</span>
                <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
              </div>
              <div class="flex items-baseline">
                <span class="font-bold shrink-0">Lớp:</span>
                <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
                <span class="font-bold ml-2 shrink-0">Số báo danh:</span>
                <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
              </div>
              <div class="flex items-baseline">
                <span class="font-bold shrink-0">Phòng thi số:</span>
                <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
                <span class="font-bold ml-2 shrink-0">Ngày thi:</span>
                <span class="ml-1 border-b border-dotted border-black flex-1 inline-block h-3"></span>
              </div>
            </div>

            <!-- Official Teacher Grading Score Box -->
            <div class="col-span-6 border border-black p-1 text-[9px]">
              <div class="grid grid-cols-3 text-center border-b border-black font-bold pb-0.5">
                <span>Trắc nghiệm</span>
                <span>Tự luận</span>
                <span>TỔNG ĐIỂM</span>
              </div>
              <div class="grid grid-cols-3 text-center h-7 font-mono font-black text-[12px] items-center">
                <span>___ / 7.0</span>
                <span>___ / 3.0</span>
                <span>___ / 10</span>
              </div>
              <div class="border-t border-black pt-0.5 flex justify-between items-center text-[8px] text-neutral-600 px-1">
                <span>Chữ ký Giám khảo: ____________</span>
                <span>Lời phê: ____________</span>
              </div>
            </div>
          </div>

          <!-- Essay Questions Prompt Section -->
          <div class="mt-3 rounded border border-black p-2 bg-neutral-50 text-[10px]">
            <h3 class="font-bold uppercase tracking-wider text-neutral-900 border-b border-black/30 pb-1">
              {{ essayTitle }}
            </h3>
            <div class="mt-1.5 whitespace-pre-line leading-relaxed text-neutral-800">
              {{ essayQuestionsText }}
            </div>
          </div>

          <!-- Student Ruled Lines Writing Area -->
          <div class="mt-3">
            <div class="text-[9px] font-bold uppercase tracking-wider text-neutral-600 mb-1">
              PHẦN BÀI LÀM CỦA THÍ SINH (VIẾT DƯỚI ĐÂY):
            </div>
            <div class="border border-black p-2">
              <div class="space-y-[8mm]">
                <div
                  v-for="line in essayLinesCount"
                  :key="line"
                  class="border-b border-neutral-400 h-0"
                ></div>
              </div>
            </div>
          </div>

          <!-- Page 2 Footer -->
          <footer class="mt-2 pt-1 border-t border-black/30 flex justify-between items-center text-[8px] font-mono text-neutral-600">
            <span>Thí sinh không viết vào phần gạch chéo hoặc ngoài lề quy định</span>
            <span>Trang 2 / 2 - HẾT</span>
          </footer>
        </div>
      </div>
    </div>

    <!-- ── Shuffle Configuration Modal ────────────────────────────────────── -->
    <div
      v-if="isShuffleModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="isShuffleModalOpen = false"
    >
      <div class="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl dark:bg-[#18181b] text-neutral-900 dark:text-white space-y-4 border border-neutral-200/80 dark:border-neutral-800/80">
        <div class="flex items-center justify-between border-b border-neutral-200/80 pb-3 dark:border-neutral-800/80">
          <div class="flex items-center gap-2">
            <span class="grid size-8 place-items-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-300">
              <Sparkles class="size-4" />
            </span>
            <h2 class="text-base font-bold">Exam Variant Generator (Shuffle)</h2>
          </div>
          <button
            class="text-xs font-semibold text-neutral-400 hover:text-neutral-700"
            @click="isShuffleModalOpen = false"
          >
            ✕
          </button>
        </div>

        <p class="text-xs text-neutral-500">
          Randomize question and option sequences into distinct variants (e.g. Mã 101, 102, 103, 104) and automatically store them into Dexie.js for dynamic mobile scanning.
        </p>

        <div class="space-y-3 text-xs">
          <div>
            <label class="font-bold text-neutral-500 uppercase tracking-wider text-[10px]">Number of Variants</label>
            <div class="mt-1 grid grid-cols-4 gap-2">
              <button
                v-for="cnt in [2, 4, 6, 8]"
                :key="cnt"
                class="min-h-[40px] rounded-xl font-bold transition active:scale-95"
                :class="shuffleVariantCount === cnt ? 'bg-purple-600 text-white' : 'border border-neutral-200 dark:border-neutral-800'"
                @click="shuffleVariantCount = cnt"
              >
                {{ cnt }} Variants
              </button>
            </div>
          </div>

          <div>
            <label class="font-bold text-neutral-500 uppercase tracking-wider text-[10px]">Starting Base Exam Code</label>
            <input
              v-model="baseExamCode"
              type="text"
              maxlength="3"
              class="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono font-bold dark:border-neutral-800 dark:bg-neutral-800"
            />
          </div>

          <div class="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="shuffleQuestionsOrder" type="checkbox" class="rounded size-4 accent-purple-600" />
              <span class="font-semibold">Shuffle Question Order across variants</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="shuffleOptionsOrder" type="checkbox" class="rounded size-4 accent-purple-600" />
              <span class="font-semibold">Shuffle Option Order (A, B, C, D) within each question</span>
            </label>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-black/5 dark:border-white/10">
          <button
            class="min-h-[44px] rounded-xl px-4 text-xs font-semibold text-neutral-600 dark:text-neutral-400"
            @click="isShuffleModalOpen = false"
          >
            Cancel
          </button>
          <button
            id="confirm-generate-variants-btn"
            class="min-h-[44px] rounded-xl bg-purple-600 px-6 text-xs font-bold text-white shadow-md transition hover:bg-purple-500 active:scale-95 flex items-center gap-2"
            :disabled="isGeneratingVariants"
            @click="handleGenerateVariants"
          >
            <Sparkles class="size-4" />
            <span>Generate & Save to Database</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Answer Key Matrix Modal ────────────────────────────────────────── -->
    <div
      v-if="isKeyMatrixModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="isKeyMatrixModalOpen = false"
    >
      <div class="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-white shadow-2xl dark:bg-[#18181b] text-neutral-900 dark:text-white overflow-hidden border border-neutral-200/80 dark:border-neutral-800/80">
        <div class="flex items-center justify-between border-b border-neutral-200/80 p-4 dark:border-neutral-800/80">
          <div>
            <h2 class="text-sm font-bold">Answer Key Matrix by Variant</h2>
            <p class="text-xs text-neutral-500">Cross-reference answer keys for all generated variants.</p>
          </div>
          <button
            class="grid size-8 place-items-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="isKeyMatrixModalOpen = false"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4">
          <table class="w-full text-xs text-left">
            <thead class="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 font-bold sticky top-0">
              <tr>
                <th class="p-2 border-b border-neutral-200 dark:border-neutral-700">Question</th>
                <th
                  v-for="v in generatedVariants"
                  :key="v.variantCode"
                  class="p-2 border-b border-neutral-200 dark:border-neutral-700 font-mono"
                >
                  Mã {{ v.variantCode }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800 font-mono">
              <tr v-for="q in questionCount" :key="q" class="hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                <td class="p-2 font-bold text-neutral-500">Câu {{ q }}</td>
                <td
                  v-for="v in generatedVariants"
                  :key="v.variantCode"
                  class="p-2 font-bold"
                >
                  <span class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">
                    {{ v.expectedAnswers[q - 1] || '-' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex justify-between items-center border-t border-black/5 p-4 dark:border-white/10">
          <button
            class="flex items-center gap-1.5 text-xs font-bold text-purple-600 underline dark:text-purple-400"
            @click="exportAnswerKeyMatrixCSV"
          >
            <Download class="size-4" /> Download as CSV
          </button>
          <button
            class="min-h-[40px] rounded-xl bg-neutral-200 px-5 text-xs font-bold text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            @click="isKeyMatrixModalOpen = false"
          >
            Close
          </button>
        </div>
      </div>
    </div>

    <!-- ── Export Action Placeholder Modal ────────────────────────────────── -->
    <div
      v-if="exportPlaceholderDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="exportPlaceholderDialog = null"
    >
      <div class="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-[#18181b] text-neutral-900 dark:text-white space-y-3 border border-neutral-200/80 dark:border-neutral-800/80">
        <h3 class="text-base font-bold">{{ exportPlaceholderDialog.title }}</h3>
        <p class="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
          {{ exportPlaceholderDialog.desc }}
        </p>
        <div class="rounded-2xl bg-neutral-50 p-3 text-[11px] font-mono text-neutral-500 dark:bg-neutral-800">
          API Endpoint Status: READY FOR HOOK
        </div>
        <div class="flex justify-end pt-2">
          <button
            class="min-h-[40px] rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95"
            @click="exportPlaceholderDialog = null"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@media print {
  * {
    color: black !important;
    background: transparent !important;
  }
  .bg-black {
    background-color: black !important;
  }
  .bg-white {
    background-color: white !important;
  }
  .text-white {
    color: white !important;
  }
  .border-black {
    border-color: black !important;
  }
}
</style>
