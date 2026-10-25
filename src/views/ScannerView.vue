<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDocumentVisibility } from '@vueuse/core';
import { X, Flashlight, FlashlightOff, SwitchCamera, CheckCircle2, FileSearch, ArrowRight, Loader2, CameraOff, Wand2, Upload } from 'lucide-vue-next';
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

import { Capacitor } from '@capacitor/core';
import { Camera as CapCamera } from '@capacitor/camera';

// ── Camera ───────────────────────────────────────────────────────────────────
function describeCameraError(err: unknown): string {
  const name = (err as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera access was denied. Please allow camera permissions in iOS Settings > Safari (or Settings > Grasschecker).';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Could not initialize rear camera with requested settings. Tap below to retry with basic video.';
  }
  if (name === 'NotReadableError') return 'Camera is being used by another application.';
  return (err as Error)?.message || 'Unable to start camera.';
}

const currentFacing = ref<'environment' | 'user'>('environment');

async function startCamera() {
  if (stream) return;
  phase.value = 'starting';
  errorMessage.value = '';

  try {
    // 1. In native Capacitor iOS / Android, request permissions through native plugin first
    if (Capacitor.isNativePlatform()) {
      try {
        const permStatus = await CapCamera.checkPermissions();
        if (permStatus.camera !== 'granted') {
          const req = await CapCamera.requestPermissions({ permissions: ['camera'] });
          if (req.camera !== 'granted') {
            throw new Error('Camera permission denied in system settings.');
          }
        }
      } catch (permErr) {
        console.warn('[scanner] Capacitor camera permission notice:', permErr);
      }
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API unavailable. Make sure you are using HTTPS or the installed app.');
    }

    // 2. Progressive constraint resolution for iOS Safari & older devices (e.g. iPhone 7 Plus)
    const candidates: MediaStreamConstraints[] = [
      {
        audio: false,
        video: {
          facingMode: { ideal: currentFacing.value },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      {
        audio: false,
        video: { facingMode: currentFacing.value },
      },
      {
        audio: false,
        video: { facingMode: { ideal: currentFacing.value } },
      },
      {
        audio: false,
        video: true,
      },
    ];

    let acquired: MediaStream | null = null;
    let lastErr: unknown = null;

    for (const c of candidates) {
      try {
        acquired = await navigator.mediaDevices.getUserMedia(c);
        if (acquired) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!acquired) {
      throw lastErr || new Error('No camera stream could be acquired.');
    }

    stream = acquired;
    const video = videoEl.value;
    if (video) {
      video.muted = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.srcObject = stream;
      await video.play().catch((playErr) => {
        console.warn('[scanner] Autoplay blocked, will play on touch:', playErr);
      });
    }

    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
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

async function flipCamera() {
  currentFacing.value = currentFacing.value === 'environment' ? 'user' : 'environment';
  stopCamera();
  await startCamera();
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

const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerFileInput() {
  void haptic.light();
  fileInputRef.value?.click();
}

async function onPhotoSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  void haptic.medium();
  phase.value = 'processing';

  try {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);

    captureCanvas.width = img.naturalWidth || img.width;
    captureCanvas.height = img.naturalHeight || img.height;
    captureCtx.drawImage(img, 0, 0);

    await captureAndGrade(false, true);
  } catch (err) {
    console.error('[scanner] photo load error:', err);
    showToast('Failed to load image from device');
    phase.value = 'searching';
  } finally {
    if (e.target) (e.target as HTMLInputElement).value = '';
  }
}

function handleScreenTap() {
  if (videoEl.value && videoEl.value.paused) {
    videoEl.value.play().catch(() => {});
  }
}

// ── Capture → grade → persist → feedback ─────────────────────────────────────
async function captureAndGrade(simulate = false, useExistingCanvas = false) {
  if (!exam.value) {
    await resolveExam();
    if (!exam.value) {
      // Auto-create sample key so grading is never blocked
      const sampleKey: ('A' | 'B' | 'C' | 'D')[] = [
        'A', 'C', 'B', 'D', 'A', 'A', 'D', 'B', 'C', 'A',
        'B', 'D', 'C', 'A', 'D', 'B', 'A', 'C', 'C', 'B',
        'D', 'A', 'B', 'C', 'A', 'D', 'C', 'B', 'A', 'D',
        'B', 'C', 'D', 'A', 'B', 'A', 'D', 'C', 'B', 'A',
      ];
      const created = await repo.create('exams', {
        answerKeyCode: '101',
        title: 'Standard Examination 2026',
        expectedAnswers: sampleKey,
      });
      exam.value = created;
    }
  }

  phase.value = 'processing';
  try {
    if (!useExistingCanvas) {
      const drawn = drawFrame(captureCanvas, captureCtx);
      if (!drawn) {
        if (simulate) {
          // In simulation without active camera feed, synthesize an image
          captureCanvas.width = 640;
          captureCanvas.height = 900;
          captureCtx.fillStyle = '#ffffff';
          captureCtx.fillRect(0, 0, 640, 900);
        } else {
          throw new Error('Camera frame unavailable');
        }
      }
    }

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
  <main class="fixed inset-0 select-none overflow-hidden bg-black text-white" @click="handleScreenTap">
    <!-- Hidden native file input for picking photo / using iOS native camera dialog -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      @change="onPhotoSelected"
    />

    <!-- Live camera feed (GPU-composited; unaffected by the 2 FPS CV loop) -->
    <video ref="videoEl" class="absolute inset-0 h-full w-full object-cover" autoplay muted playsinline webkit-playsinline />

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

      <div class="flex items-center gap-2">
        <!-- Native Camera Snap / Gallery Upload Button -->
        <button
          id="scanner-upload"
          class="grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-xl text-white transition active:scale-90"
          aria-label="Upload photo"
          title="Upload Sheet / Snap with Native Camera"
          @click="triggerFileInput"
        >
          <Upload class="size-5" />
        </button>

        <button
          id="scanner-flip"
          class="grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-xl text-white transition active:scale-90"
          aria-label="Flip camera"
          title="Switch Front/Rear Camera"
          @click="flipCamera"
        >
          <SwitchCamera class="size-5" />
        </button>

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
      </div>
    </header>

    <!-- Hint pill & Test Scan button -->
    <div class="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+40px)] flex flex-col items-center gap-3">
      <Transition name="fade" mode="out-in">
        <p
          v-if="hint && phase !== 'error'"
          :key="hint"
          class="rounded-full bg-black/55 px-4 py-2 text-sm font-medium backdrop-blur-xl border border-white/10"
        >
          {{ hint }}
        </p>
      </Transition>

      <button
        v-if="phase === 'searching' || phase === 'cooldown' || phase === 'starting'"
        id="scanner-simulate"
        class="flex items-center gap-1.5 rounded-full bg-emerald-600/90 text-white px-4 py-2 text-xs font-semibold backdrop-blur-xl shadow-lg transition active:scale-95"
        @click="captureAndGrade(true)"
      >
        <Wand2 class="size-3.5" /> Test Scan (Simulate)
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
    <div v-if="phase === 'error'" class="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center backdrop-blur-md">
      <div class="max-w-xs space-y-3">
        <CameraOff class="mx-auto size-12 text-rose-400" />
        <h2 class="text-lg font-semibold text-white">Camera Unavailable</h2>
        <p class="text-xs text-white/70 leading-relaxed">{{ errorMessage }}</p>
        
        <div class="flex flex-col gap-2 pt-2">
          <button id="scanner-retry" class="w-full rounded-2xl bg-white py-3 text-sm font-semibold text-black active:scale-95 shadow-md" @click="startCamera">
            Retry Rear Camera
          </button>
          <button class="w-full rounded-2xl border border-white/20 bg-white/10 py-3 text-sm font-semibold text-white active:scale-95" @click="flipCamera">
            Switch to Front Camera
          </button>
          <button class="w-full flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/40 bg-emerald-500/20 py-3 text-sm font-semibold text-emerald-300 active:scale-95" @click="triggerFileInput">
            <Upload class="size-4" /> Snap Photo with Native Camera
          </button>
          <button class="w-full rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white active:scale-95 shadow-lg" @click="captureAndGrade(true)">
            Test Grading Engine (Sample Sheet)
          </button>
        </div>
      </div>
    </div>

    <!-- No exam -->
    <div
      v-else-if="phase !== 'starting' && !exam"
      class="absolute inset-x-6 bottom-[calc(env(safe-area-inset-bottom)+96px)] rounded-2xl bg-amber-500/90 p-4 text-sm font-medium text-white shadow-xl backdrop-blur-md flex items-center justify-between"
    >
      <span>No answer key selected.</span>
      <button
        class="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-amber-950 active:scale-95"
        @click="async () => { await resolveExam(); if (!exam) { await repo.create('exams', { answerKeyCode: '101', title: 'Default Standard Exam', expectedAnswers: ['A','B','C','D','A','B','C','D','A','B','C','D','A','B','C','D','A','B','C','D'] }); await resolveExam(); } }"
      >
        Create Quick Key
      </button>
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
            class="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 py-3.5 text-[15px] font-semibold text-white active:scale-[0.98] shadow-md shadow-emerald-600/30"
            @click="dismissResult"
          >
            Next <ArrowRight class="size-4" />
          </button>
        </div>
      </section>
    </Transition>
  </main>
</template>
