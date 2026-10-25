<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookOpenCheck,
  Plus,
  Search,
  Globe,
  Lock,
  Share2,
  Trash2,
  Copy,
  Sparkles,
  Camera,
  Printer,
  Check,
  X,
  FileText,
} from 'lucide-vue-next';
import { collection, doc, getDocs, limit, query, setDoc } from 'firebase/firestore';
import { firestore, useAuth } from '@/services/firebase';
import { db, isAlive, repo, type AnswerOption, type ExamRecord, ANSWER_OPTIONS } from '@/services/db';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { haptic } from '@/services/haptics';

const router = useRouter();
const { user, isSignedIn } = useAuth();

// ── State ────────────────────────────────────────────────────────────────────
const activeTab = ref<'private' | 'public'>('private');
const searchQuery = ref('');
const isCreateModalOpen = ref(false);
const isPublicLoading = ref(false);
const copiedId = ref<string | null>(null);

// Form for new answer key
const newTitle = ref('');
const newCode = ref('101');
const newQuestionCount = ref<20 | 40>(40);
const newAnswers = ref<AnswerOption[]>(Array(40).fill('A'));

// ── Live Query for Local Private Exams ───────────────────────────────────────
const localExams = useLiveQuery(
  () => db.exams.orderBy('updatedAt').reverse().filter(isAlive).toArray(),
  [] as ExamRecord[],
);

// Public Exams fetched from Firestore
interface PublicExamItem {
  id: string;
  title: string;
  answerKeyCode: string;
  expectedAnswers: AnswerOption[];
  authorName?: string;
  downloadCount?: number;
}
const publicExams = ref<PublicExamItem[]>([
  {
    id: 'pub-mock-1',
    title: 'Đề thi THPT Quốc Gia - Môn Toán 2026',
    answerKeyCode: '101',
    expectedAnswers: ['A', 'C', 'B', 'D', 'A', 'A', 'D', 'B', 'C', 'A', 'B', 'D', 'C', 'A', 'D', 'B', 'A', 'C', 'C', 'B'],
    authorName: 'Bộ GD&ĐT',
    downloadCount: 1240,
  },
  {
    id: 'pub-mock-2',
    title: 'Khảo sát chất lượng Vật Lý - Lớp 12',
    answerKeyCode: '204',
    expectedAnswers: ['B', 'A', 'D', 'C', 'C', 'B', 'A', 'D', 'B', 'A', 'D', 'C', 'A', 'C', 'B', 'D', 'B', 'B', 'A', 'D'],
    authorName: 'Thầy Hoàng Minh',
    downloadCount: 480,
  },
  {
    id: 'pub-mock-3',
    title: 'English Semester 1 Standard Test',
    answerKeyCode: '302',
    expectedAnswers: ['C', 'A', 'B', 'D', 'A', 'C', 'D', 'B', 'A', 'B', 'C', 'D', 'A', 'A', 'B', 'C', 'D', 'A', 'B', 'D'],
    authorName: 'Mrs. Jennifer Nguyen',
    downloadCount: 890,
  },
]);

// Filtered lists
const filteredLocal = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return localExams.value;
  return localExams.value.filter(
    (e) => e.answerKeyCode.toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q),
  );
});

const filteredPublic = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return publicExams.value;
  return publicExams.value.filter(
    (e) => e.answerKeyCode.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
  );
});

// ── Actions ──────────────────────────────────────────────────────────────────
function openCreateModal() {
  void haptic.light();
  newTitle.value = '';
  newCode.value = String(100 + Math.floor(Math.random() * 899));
  newQuestionCount.value = 40;
  newAnswers.value = Array(40).fill('A');
  isCreateModalOpen.value = true;
}

function handleQuestionCountChange(count: 20 | 40) {
  newQuestionCount.value = count;
  if (newAnswers.value.length < count) {
    newAnswers.value = [...newAnswers.value, ...Array(count - newAnswers.value.length).fill('A')];
  } else {
    newAnswers.value = newAnswers.value.slice(0, count);
  }
}

function randomizeAnswers() {
  void haptic.light();
  newAnswers.value = Array.from({ length: newQuestionCount.value }, () => {
    return ANSWER_OPTIONS[Math.floor(Math.random() * 4)];
  });
}

async function saveExam() {
  if (!newCode.value.trim()) return;
  void haptic.medium();

  await repo.create('exams', {
    answerKeyCode: newCode.value.trim(),
    title: newTitle.value.trim() || `Exam ${newCode.value.trim()}`,
    expectedAnswers: [...newAnswers.value],
  });

  isCreateModalOpen.value = false;
}

async function deleteExam(id: string) {
  if (!confirm('Are you sure you want to delete this answer key?')) return;
  void haptic.light();
  await repo.remove('exams', id);
}

async function clonePublicExam(item: PublicExamItem) {
  void haptic.medium();
  await repo.create('exams', {
    answerKeyCode: item.answerKeyCode,
    title: `${item.title} (Imported)`,
    expectedAnswers: [...item.expectedAnswers],
  });
  copiedId.value = item.id;
  setTimeout(() => (copiedId.value = null), 2000);
  activeTab.value = 'private';
}

async function shareToPublic(exam: ExamRecord) {
  void haptic.light();
  try {
    const pubRef = doc(firestore, 'public_exams', exam.id);
    await setDoc(pubRef, {
      title: exam.title || `Exam Code ${exam.answerKeyCode}`,
      answerKeyCode: exam.answerKeyCode,
      expectedAnswers: exam.expectedAnswers,
      authorName: user.value?.displayName || 'Anonymous Teacher',
      authorUid: user.value?.uid || null,
      updatedAt: Date.now(),
    });
    alert('Answer key successfully shared with the community!');
  } catch (err) {
    console.warn('Share error', err);
    alert('Could not share exam right now. Stored locally.');
  }
}

function startScanning(examId: string) {
  void haptic.light();
  router.push({ name: 'scanner', query: { examId } });
}

function openMaker(code: string) {
  void haptic.light();
  router.push({ name: 'maker', query: { code } });
}

async function fetchRemotePublicExams() {
  try {
    isPublicLoading.value = true;
    const snap = await getDocs(query(collection(firestore, 'public_exams'), limit(20)));
    if (!snap.empty) {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PublicExamItem);
      // Merge unique
      publicExams.value = [...items, ...publicExams.value.filter((m) => !items.some((i) => i.id === m.id))];
    }
  } catch {
    // Offline fallback to mock
  } finally {
    isPublicLoading.value = false;
  }
}

onMounted(() => {
  fetchRemotePublicExams();
});
</script>

<template>
  <div class="min-h-screen bg-neutral-100 pb-28 text-neutral-900 transition-colors dark:bg-neutral-950 dark:text-neutral-100">
    <main class="mx-auto max-w-4xl px-4 pt-6 space-y-6">
      <!-- Page Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="grid size-9 place-items-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-950">
              <BookOpenCheck class="size-5" />
            </span>
            <h1 class="text-xl font-bold tracking-tight">Exam Bank & Answer Keys</h1>
          </div>
          <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Create, manage, and share standardized multiple-choice answer keys.
          </p>
        </div>

        <button
          id="create-exam-btn"
          class="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-xs font-bold text-white shadow-md transition hover:scale-[1.02] active:scale-95 dark:bg-white dark:text-neutral-950"
          @click="openCreateModal"
        >
          <Plus class="size-4" />
          <span>New Answer Key</span>
        </button>
      </div>

      <!-- Tab Switcher & Search Bar -->
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <!-- Tabs -->
        <div class="flex rounded-2xl bg-neutral-200/80 p-1 dark:bg-neutral-900">
          <button
            class="flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95"
            :class="activeTab === 'private' ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-neutral-500'"
            @click="activeTab = 'private'"
          >
            <Lock class="size-3.5" />
            <span>My Answer Keys ({{ localExams.length }})</span>
          </button>
          <button
            class="flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition active:scale-95"
            :class="activeTab === 'public' ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white' : 'text-neutral-500'"
            @click="activeTab = 'public'"
          >
            <Globe class="size-3.5" />
            <span>Community Bank ({{ publicExams.length }})</span>
          </button>
        </div>

        <!-- Search -->
        <div class="relative w-full sm:w-64">
          <Search class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search code or title…"
            class="w-full min-h-[44px] rounded-2xl border border-black/5 bg-white pl-9 pr-3 text-xs font-medium placeholder-neutral-400 focus:outline-none dark:border-white/10 dark:bg-neutral-900"
          />
        </div>
      </div>

      <!-- Private Answer Keys Tab Content -->
      <div v-if="activeTab === 'private'" class="space-y-3">
        <div v-if="filteredLocal.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div
            v-for="exam in filteredLocal"
            :key="exam.id"
            class="group rounded-3xl border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-neutral-900"
          >
            <div class="flex items-start justify-between">
              <div>
                <span class="rounded-lg bg-neutral-100 px-2 py-0.5 font-mono text-xs font-black text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                  CODE {{ exam.answerKeyCode }}
                </span>
                <h3 class="mt-2 text-base font-bold tracking-tight">{{ exam.title || 'Untitled Exam' }}</h3>
                <p class="text-xs text-neutral-500">
                  {{ exam.expectedAnswers.length }} Questions · Standard A-D
                </p>
              </div>

              <!-- Quick action icons -->
              <div class="flex items-center gap-1">
                <button
                  class="grid size-9 place-items-center rounded-xl text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                  title="Share to Community Bank"
                  @click="shareToPublic(exam)"
                >
                  <Share2 class="size-4" />
                </button>
                <button
                  class="grid size-9 place-items-center rounded-xl text-neutral-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                  title="Delete key"
                  @click="deleteExam(exam.id)"
                >
                  <Trash2 class="size-4" />
                </button>
              </div>
            </div>

            <!-- Answers preview snippet -->
            <div class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="(ans, idx) in exam.expectedAnswers.slice(0, 10)"
                :key="idx"
                class="rounded bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {{ idx + 1 }}:<strong>{{ ans }}</strong>
              </span>
              <span v-if="exam.expectedAnswers.length > 10" class="text-[10px] text-neutral-400 self-center">
                +{{ exam.expectedAnswers.length - 10 }} more
              </span>
            </div>

            <!-- Footer actions -->
            <div class="mt-4 flex items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <button
                class="flex flex-1 min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-neutral-900 py-2 text-xs font-bold text-white transition active:scale-95 dark:bg-white dark:text-neutral-950"
                @click="startScanning(exam.id)"
              >
                <Camera class="size-3.5" />
                <span>Scan with Key</span>
              </button>
              <button
                class="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 transition hover:bg-neutral-50 active:scale-95 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
                title="Print answer sheet for this exam"
                @click="openMaker(exam.answerKeyCode)"
              >
                <Printer class="size-3.5" />
                <span class="hidden sm:inline">Print Sheet</span>
              </button>
            </div>
          </div>
        </div>

        <div v-else class="rounded-3xl border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-800">
          <BookOpenCheck class="mx-auto size-10 text-neutral-300 dark:text-neutral-700" />
          <h3 class="mt-3 text-sm font-semibold">No Answer Keys Found</h3>
          <p class="mt-1 text-xs text-neutral-500">Tap "New Answer Key" above to create an answer key for your test.</p>
        </div>
      </div>

      <!-- Public Exams Tab Content -->
      <div v-else class="space-y-3">
        <div v-if="filteredPublic.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div
            v-for="item in filteredPublic"
            :key="item.id"
            class="rounded-3xl border border-black/5 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-neutral-900"
          >
            <div class="flex items-start justify-between">
              <div>
                <span class="rounded-lg bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-black text-emerald-600 dark:text-emerald-400">
                  CODE {{ item.answerKeyCode }}
                </span>
                <h3 class="mt-2 text-base font-bold tracking-tight">{{ item.title }}</h3>
                <p class="text-xs text-neutral-500">
                  By {{ item.authorName || 'Teacher' }} · {{ item.expectedAnswers.length }} Qs
                </p>
              </div>

              <button
                class="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-neutral-200 px-3 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 active:scale-95 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
                @click="clonePublicExam(item)"
              >
                <Check v-if="copiedId === item.id" class="size-4 text-emerald-500" />
                <Copy v-else class="size-4" />
                <span>{{ copiedId === item.id ? 'Imported' : 'Import' }}</span>
              </button>
            </div>

            <!-- Preview answers -->
            <div class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="(ans, idx) in item.expectedAnswers.slice(0, 10)"
                :key="idx"
                class="rounded bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              >
                {{ idx + 1 }}:<strong>{{ ans }}</strong>
              </span>
              <span v-if="item.expectedAnswers.length > 10" class="text-[10px] text-neutral-400 self-center">
                +{{ item.expectedAnswers.length - 10 }} more
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Create Exam Modal -->
    <div
      v-if="isCreateModalOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      @click.self="isCreateModalOpen = false"
    >
      <div class="w-full max-w-xl max-h-[90vh] flex flex-col rounded-3xl bg-white shadow-2xl dark:bg-neutral-900 text-neutral-900 dark:text-white overflow-hidden">
        <div class="flex items-center justify-between border-b border-black/5 p-5 dark:border-white/10">
          <div>
            <h2 class="text-base font-bold">Create Answer Key</h2>
            <p class="text-xs text-neutral-500">Configure expected answers for automatic OMR scoring.</p>
          </div>
          <button
            class="grid size-9 place-items-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
            @click="isCreateModalOpen = false"
          >
            <X class="size-5" />
          </button>
        </div>

        <div class="p-5 space-y-4 overflow-y-auto flex-1">
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2">
              <label class="text-xs font-semibold text-neutral-500">Exam Title</label>
              <input
                v-model="newTitle"
                type="text"
                placeholder="e.g. Midterm Physics Grade 10"
                class="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-medium dark:border-neutral-800 dark:bg-neutral-800"
              />
            </div>
            <div>
              <label class="text-xs font-semibold text-neutral-500">Exam Code (3 Digits)</label>
              <input
                v-model="newCode"
                type="text"
                maxlength="3"
                class="mt-1 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-xs font-bold dark:border-neutral-800 dark:bg-neutral-800"
              />
            </div>
          </div>

          <!-- Question Count & Randomize Bar -->
          <div class="flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-neutral-500">Questions:</span>
              <div class="flex rounded-lg bg-neutral-100 p-0.5 dark:bg-neutral-800">
                <button
                  class="rounded-md px-2.5 py-1 text-xs font-bold"
                  :class="newQuestionCount === 20 ? 'bg-white shadow dark:bg-neutral-700' : 'text-neutral-500'"
                  @click="handleQuestionCountChange(20)"
                >
                  20 Qs
                </button>
                <button
                  class="rounded-md px-2.5 py-1 text-xs font-bold"
                  :class="newQuestionCount === 40 ? 'bg-white shadow dark:bg-neutral-700' : 'text-neutral-500'"
                  @click="handleQuestionCountChange(40)"
                >
                  40 Qs
                </button>
              </div>
            </div>

            <button
              class="flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400"
              @click="randomizeAnswers"
            >
              <Sparkles class="size-3.5" /> Randomize
            </button>
          </div>

          <!-- Visual Bubble Grid for Answer Key -->
          <div class="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-1 border border-neutral-100 rounded-2xl dark:border-neutral-800">
            <div
              v-for="qIndex in newQuestionCount"
              :key="qIndex"
              class="flex items-center justify-between rounded-xl bg-neutral-50 p-2 text-xs dark:bg-neutral-800/60"
            >
              <span class="font-mono font-bold text-neutral-500 w-7">Q{{ qIndex }}</span>
              <div class="flex gap-1">
                <button
                  v-for="opt in ANSWER_OPTIONS"
                  :key="opt"
                  class="size-7 rounded-full font-bold text-xs transition active:scale-90"
                  :class="[
                    newAnswers[qIndex - 1] === opt
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-950'
                      : 'border border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
                  ]"
                  @click="newAnswers[qIndex - 1] = opt"
                >
                  {{ opt }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-black/5 p-4 dark:border-white/10">
          <button
            class="min-h-[44px] rounded-xl px-4 text-xs font-medium text-neutral-600 dark:text-neutral-400"
            @click="isCreateModalOpen = false"
          >
            Cancel
          </button>
          <button
            id="save-new-exam-btn"
            class="min-h-[44px] rounded-xl bg-neutral-900 px-6 text-xs font-bold text-white shadow transition active:scale-95 dark:bg-white dark:text-neutral-950"
            @click="saveExam"
          >
            Save Answer Key
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
