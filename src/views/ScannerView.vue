<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDocumentVisibility } from '@vueuse/core';
import { X, Flashlight, FlashlightOff, CheckCircle2, FileSearch, ArrowRight, Loader2, CameraOff, Wand2 } from 'lucide-vue-next';
import { db, isAlive, repo, type ExamRecord, type ScanRecord } from '@/services/db';
import { haptic } from '@/services/haptics';
import { detectMarkers, loadOpenCV, scoreAnswers, simulateGrade, warpAndGrade } from '@/vision/omr';
import { formatScore } from '@/utils/format';

// ── Tunables ─────────────────────────────────────────────────────────────────
const PROCESS_INTERVAL_MS = 500; // 2 FPS CV budget — the <video> itself stays at native 30/60 FPS
const PROCESS_MAX_WIDTH = 640; // detection runs on a downscaled frame
const STABLE_FRAMES = 2; // markers must be seen on N consecutive ticks before capturing
const RESULT_DISPLAY_MS = 2200;
const LOST_FRAMES_TO_REARM = 2; // sheet must leave the frame before the next one is accepted

type Phase = 'starting' | 'searching' | 'processing' | 'result' | 'cooldown' | 'error';

const router = useRouter();
const route = useRoute();
const isDev = import.meta.env.DEV;

const videoEl = ref<HTMLVideoElement | null>(null);
const phase = ref<Phase>('starting');
const errorMessage = ref('');
const toast = ref('');
const markersFound = ref(false);
const torchSupported = ref(false);
const torchOn = ref(false);
const visionReady = ref(false);
const sessionCount = ref(0);
const exam = shallowRef<ExamRecord | null>(null);
const lastResult = shallowRef<ScanRecord | null>(null);

let stream: MediaStream | null = null;
let looping = false;
let loopTimer: number | undefined;
let dismissTimer: number | undefined;
let toastTimer: number | undefined;
let stableCount = 0;
let lostCount = 0;

// Low-res canvas: CPU-backed for fast getImageData. Hi-res canvas: one-shot captures.
const workCanvas = document.createElement('canvas');
const workCtx = workCanvas.getContext('2d', { willReadFrequently: true })!;
const captureCanvas = document.createElement('canvas');
const captureCtx = captureCanvas.getContext('2d')!;

// ── Derived UI state ─────────────────────────────────────────────────────────
const hint = computed(() => {
  switch (phase.value) {
    case 'starting': return 'Starting camera…';
    case 'searching': return markersFound.value ? 'Hold steady…' : 'Align the 3 corner markers';
    case 'processing': return 'Grading…';
    case 'cooldown': return 'Next sheet';
    default: return '';
  }
});

const guideTone = computed(() => {
  if (phase.value === 'processing') return 'text-sky-400';
  if (markersFound.value) return 'text-emerald-400';
  return 'text-white/85';
});

const resultStats = computed(() => {
  const r = lastResult.value;
  if (!r || !exam.value) return null;
  const total = exam.value.expectedAnswers.length;
  return { total, correct: total - r.wrongAnswers.length };
});

// ── Camera ───────────────────────────────────────────────────────────────────
function describeCameraError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Camera access was denied. Enable it in Settings to start scanning.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No suitable rear camera was found.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return (err as Error)?.message || 'Unable to start the camera.';
}

async function startCamera() {
  if (stream) return;
  phase.value = 'starting';
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API unavailable — use HTTPS or the native app.');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
    });
    const video = videoEl.value!;
    video.srcObject = stream;
    await video.play();

    const track = stream.getVideoTracks()[0];
    const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    torchSupported.value = !!caps.torch;
    torchOn.value = false;

    phase.value = 'searching';
    startLoop();
  } catch (err) {
    stopCamera();
    errorMessage.value = describeCameraError(err);
    phase.value = 'error';
  }
}

function stopCamera() {
  stopLoop();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  torchOn.value = false;
  if (videoEl.value) videoEl.value.srcObject = null;
}

async function toggleTorch() {
  const track = stream?.getVideoTracks()[0];
  if (!track || !torchSupported.value) {
    showToast('Flashlight not available on this device');
    return;
  }
  const next = !torchOn.value;
  try {
    await track.applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] });
    torchOn.value = next;
    void haptic.light();
  } catch {
    torchSupported.value = false;
    showToast('Flashlight not available on this device');
  }
}

/** Draws the current video frame into `canvas`, downscaled to `maxWidth`. */
function drawFrame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, maxWidth = Infinity): boolean {
  const v = videoEl.value;
  if (!v || v.readyState < 2 || !v.videoWidth) return false;
  const scale = Math.min(1, maxWidth / v.videoWidth);
  const w = Math.round(v.videoWidth * scale);
  const h = Math.round(v.videoHeight * scale);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.drawImage(v, 0, 0, w, h);
  return true;
}

// ── 2 FPS processing loop ────────────────────────────────────────────────────
// setTimeout chain (not setInterval / rAF): the next tick is scheduled only after the
// current one finishes, so slow devices never stack up work.
function startLoop() {
  if (looping) return;
  looping = true;
  void tick();
}

function stopLoop() {
  looping = false;
  clearTimeout(loopTimer);
}

async function tick() {
  if (!looping) return;
  const t0 = performance.now();
  try {
    await processFrame();
  } catch (err) {
    console.warn('[scanner] frame error', err);
  }
  if (looping) loopTimer = window.setTimeout(tick, Math.max(0, PROCESS_INTERVAL_MS - (performance.now() - t0)));
}

async function processFrame() {
  if (phase.value !== 'searching' && phase.value !== 'cooldown') return;
  if (!drawFrame(workCanvas, workCtx, PROCESS_MAX_WIDTH)) return;

  const frame = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
  const { found } = await detectMarkers(frame);
  markersFound.value = found;

  if (phase.value === 'cooldown') {
    // Wait for the graded sheet to leave the frame so it isn't scanned twice.
    lostCount = found ? 0 : lostCount + 1;
    if (lostCount >= LOST_FRAMES_TO_REARM) {
      stableCount = 0;
      phase.value = 'searching';
    }
    return;
  }

  if (!found) {
    stableCount = 0;
    return;
  }
  stableCount++;
  if (stableCount === 1) void haptic.light();
  if (stableCount >= STABLE_FRAMES) await captureAndGrade();
}

// ── Capture → grade → persist → feedback ─────────────────────────────────────
async function captureAndGrade(simulate = false) {
  if (!exam.value) {
    showToast('Create an exam first');
    return;
  }
  phase.value = 'processing';
  try {
    if (!drawFrame(captureCanvas, captureCtx)) throw new Error('Camera frame unavailable');
    const key = exam.value.expectedAnswers;
    const graded = simulate ? await simulateGrade(captureCanvas, key) : await warpAndGrade(captureCanvas, key.length);
    const { score, wrongAnswers } = scoreAnswers(graded.answers, key);

    const record = await repo.create('scans', {
      examId: exam.value.id,
      studentSBD: graded.studentSBD,
      answers: [...graded.answers],
      score,
      wrongAnswers,
      imageBlob: graded.flattened,
      timestamp: Date.now(),
    });

    sessionCount.value++;
    lastResult.value = record;
    void haptic.success();
    phase.value = 'result';
    dismissTimer = window.setTimeout(dismissResult, RESULT_DISPLAY_MS);
  } catch (err) {
    console.error('[scanner] grading failed', err);
    void haptic.error();
    showToast("Couldn't read the sheet — try again");
    stableCount = 0;
    phase.value = 'searching';
  }
}

function dismissResult() {
  clearTimeout(dismissTimer);
  if (phase.value !== 'result') return;
  lostCount = 0;
  stableCount = 0;
  phase.value = 'cooldown';
}

function openReview() {
  clearTimeout(dismissTimer);
  if (lastResult.value) void router.push({ name: 'review', params: { id: lastResult.value.id } });
}

function showToast(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ''), 2000);
}

async function resolveExam() {
  const id = route.query.examId as string | undefined;
  const found = id ? await db.exams.get(id) : await db.exams.orderBy('updatedAt').reverse().filter(isAlive).first();
  exam.value = found && isAlive(found) ? found : null;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
const visibility = useDocumentVisibility();
watch(visibility, (v) => (v === 'hidden' ? stopCamera() : void startCamera()));

onMounted(async () => {
  void loadOpenCV()
    .then(() => (visionReady.value = true))
    .catch((e) => console.warn('[scanner] OpenCV unavailable', e));
  await resolveExam();
  await startCamera();
});

onBeforeUnmount(() => {
  stopCamera();
  clearTimeout(dismissTimer);
  clearTimeout(toastTimer);
});
</script>

<template>
  <main class="fixed inset-0 select-none overflow-hidden bg-black text-white">
    <!-- Live camera feed (GPU-composited; unaffected by the 2 FPS CV loop) -->
    <video ref="videoEl" class="absolute inset-0 h-full w-full object-cover" autoplay muted playsinline />

    <!-- Viewfinder: A4 portrait guide with 3 QR-style finder markers -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center pb-10">
      <div
        class="relative aspect-[1/1.414] h-[min(68dvh,116vw,622px)] rounded-[22px] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] transition-colors duration-300"
        :class="guideTone"
      >
        <!-- Finder markers: TL, TR, BL -->
        <span
          v-for="pos in ['-left-1.5 -top-1.5', '-right-1.5 -top-1.5', '-left-1.5 -bottom-1.5']"
          :key="pos"
          class="absolute grid size-11 place-items-center rounded-[10px] border-[5px] border-current transition-transform duration-300"
          :class="[pos, markersFound ? 'scale-110' : 'scale-100']"
        >
          <span class="size-3.5 rounded-[3px] bg-current" />
        </span>
        <!-- 4th corner: plain bracket -->
        <span class="absolute -bottom-1.5 -right-1.5 size-9 rounded-br-[14px] border-b-[5px] border-r-[5px] border-current" />

        <!-- Scan line sweep -->
        <div v-if="phase === 'searching'" class="absolute inset-0 overflow-hidden rounded-[22px]">
          <div class="h-full w-full animate-scan">
            <div class="mx-4 h-0.5 rounded-full bg-current opacity-70 shadow-[0_0_16px_2px_currentColor]" />
          </div>
        </div>

        <!-- Processing veil -->
        <div v-if="phase === 'processing'" class="absolute inset-0 grid place-items-center rounded-[22px] bg-sky-400/10">
          <Loader2 class="size-10 animate-spin text-white" />
        </div>
      </div>
    </div>

    <!-- Top bar -->
    <header class="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
      <button
        id="scanner-close"
        class="grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-xl transition active:scale-90"
        aria-label="Close scanner"
        @click="router.push({ name: 'dashboard' })"
      >
        <X class="size-5" />
      </button>

      <div class="flex items-center gap-2 rounded-full bg-black/35 px-3.5 py-2 text-[13px] font-medium backdrop-blur-xl">
        <span class="size-1.5 rounded-full" :class="visionReady ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'" />
        <span class="max-w-[38vw] truncate">{{ exam ? exam.title || `Code ${exam.answerKeyCode}` : 'No exam' }}</span>
        <span class="text-white/50">·</span>
        <span class="tabular-nums">{{ sessionCount }}</span>
      </div>

      <button
        id="scanner-torch"
        class="grid size-11 place-items-center rounded-full backdrop-blur-xl transition active:scale-90"
        :class="[torchOn ? 'bg-white text-black' : 'bg-black/35 text-white', !torchSupported && 'opacity-50']"
        :aria-pressed="torchOn"
        aria-label="Toggle flashlight"
        @click="toggleTorch"
      >
        <Flashlight v-if="torchOn" class="size-5" />
        <FlashlightOff v-else class="size-5" />
      </button>
    </header>

    <!-- Hint pill -->
    <div class="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+40px)] flex flex-col items-center gap-3">
      <Transition name="fade" mode="out-in">
        <p
          v-if="hint && phase !== 'error'"
          :key="hint"
          class="rounded-full bg-black/45 px-4 py-2 text-sm font-medium backdrop-blur-xl"
        >
          {{ hint }}
        </p>
      </Transition>

      <button
        v-if="isDev && (phase === 'searching' || phase === 'cooldown')"
        id="scanner-simulate"
        class="flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-medium backdrop-blur-xl active:scale-95"
        @click="captureAndGrade(true)"
      >
        <Wand2 class="size-3.5" /> Simulate scan (dev)
      </button>
    </div>

    <!-- Toast -->
    <Transition name="fade">
      <div
        v-if="toast"
        class="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+72px)] mx-auto w-fit rounded-full bg-neutral-900/90 px-4 py-2 text-sm backdrop-blur-xl"
      >
        {{ toast }}
      </div>
    </Transition>

    <!-- Camera error -->
    <div v-if="phase === 'error'" class="absolute inset-0 grid place-items-center bg-black/80 p-8 text-center backdrop-blur-sm">
      <div class="max-w-xs">
        <CameraOff class="mx-auto mb-4 size-12 text-white/60" />
        <h2 class="mb-2 text-lg font-semibold">Camera unavailable</h2>
        <p class="mb-6 text-sm text-white/70">{{ errorMessage }}</p>
        <button id="scanner-retry" class="rounded-full bg-white px-6 py-3 text-sm font-semibold text-black active:scale-95" @click="startCamera">
          Try again
        </button>
      </div>
    </div>

    <!-- No exam -->
    <div
      v-else-if="phase !== 'starting' && !exam"
      class="absolute inset-x-6 bottom-[calc(env(safe-area-inset-bottom)+96px)] rounded-2xl bg-amber-400/95 p-4 text-sm font-medium text-amber-950"
    >
      No answer key yet. Create an exam from the dashboard before scanning.
    </div>

    <!-- Result bottom sheet -->
    <Transition name="sheet">
      <section
        v-if="phase === 'result' && lastResult"
        class="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white px-6 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-3 text-neutral-900 shadow-2xl dark:bg-neutral-900 dark:text-white"
        @click.self="dismissResult"
      >
        <!-- Auto-dismiss countdown -->
        <div class="mx-auto mb-5 h-1 w-10 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            class="h-full w-full origin-left animate-countdown bg-neutral-400"
            :style="{ animationDuration: `${RESULT_DISPLAY_MS}ms` }"
          />
        </div>

        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <CheckCircle2 class="size-4" /> Graded
            </p>
            <h2 class="mt-1 text-xl font-semibold tracking-tight">
              {{ lastResult.studentSBD ? `SBD ${lastResult.studentSBD}` : 'Unknown student' }}
            </h2>
            <p v-if="resultStats" class="mt-0.5 text-sm text-neutral-500">
              {{ resultStats.correct }} / {{ resultStats.total }} correct
            </p>
          </div>
          <div class="text-right">
            <span class="text-5xl font-bold tabular-nums tracking-tight">{{ formatScore(lastResult.score) }}</span>
            <span class="text-lg text-neutral-400">/10</span>
          </div>
        </div>

        <div v-if="lastResult.wrongAnswers.length" class="mt-4 flex flex-wrap gap-1.5">
          <span
            v-for="q in lastResult.wrongAnswers.slice(0, 14)"
            :key="q"
            class="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-rose-600 dark:bg-rose-500/15 dark:text-rose-300"
          >
            Q{{ q }}
          </span>
          <span v-if="lastResult.wrongAnswers.length > 14" class="px-1 py-0.5 text-xs text-neutral-400">
            +{{ lastResult.wrongAnswers.length - 14 }}
          </span>
        </div>

        <div class="mt-6 grid grid-cols-2 gap-3">
          <button
            id="result-review"
            class="flex items-center justify-center gap-2 rounded-2xl bg-neutral-100 py-3.5 text-[15px] font-semibold active:scale-[0.98] dark:bg-neutral-800"
            @click="openReview"
          >
            <FileSearch class="size-4" /> Review
          </button>
          <button
            id="result-next"
            class="flex items-center justify-center gap-2 rounded-2xl bg-neutral-900 py-3.5 text-[15px] font-semibold text-white active:scale-[0.98] dark:bg-white dark:text-black"
            @click="dismissResult"
          >
            Next <ArrowRight class="size-4" />
          </button>
        </div>
      </section>
    </Transition>
  </main>
</template>
