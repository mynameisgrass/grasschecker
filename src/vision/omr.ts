/**
 * OMR vision pipeline — PLACEHOLDERS.
 *
 * Planned pipeline (OpenCV.js / WASM):
 *   detectMarkers  : gray → GaussianBlur → adaptiveThreshold → findContours(RETR_TREE)
 *                    → keep square contours with ≥2 nested children (QR-style finder patterns)
 *                    → need exactly 3 → infer 4th corner.
 *   warpAndGrade   : getPerspectiveTransform → warpPerspective to a fixed template size
 *                    → for each bubble ROI: countNonZero(threshold) / area → fill ratio
 *                    → pick max ratio above threshold, flag ambiguous/erased bubbles.
 *
 * Performance notes (iPhone 7 Plus):
 *   - detectMarkers runs on a ≤640px downscaled frame at 2 FPS (ScannerView throttles it).
 *   - Always `.delete()` every cv.Mat — WASM heap does not GC.
 *   - Moving this module into a Web Worker (OffscreenCanvas / transferable ImageData)
 *     is the next step if main-thread jank appears; the API below is already async for that.
 */
import type { AnswerOption } from '@/services/db';
import { ANSWER_OPTIONS } from '@/services/db';

export interface Point {
  x: number;
  y: number;
}

export interface MarkerDetection {
  found: boolean;
  /** Normalized (0..1) corner positions: TL, TR, BL, (inferred) BR. */
  corners: Point[];
}

export interface GradeOutput {
  answers: (AnswerOption | null)[];
  studentSBD?: string;
  /** Perspective-corrected sheet image (JPEG). */
  flattened: Blob;
  /** 0..1 overall read confidence. */
  confidence: number;
}

// ── OpenCV loader (self-hosted in /public/opencv for offline) ────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CV = any;
let cvInstance: CV | null = null;
let loading: Promise<void> | null = null;

export const getCv = (): CV | null => cvInstance;

export function loadOpenCV(src = `${import.meta.env.BASE_URL}opencv/opencv.js`): Promise<void> {
  if (cvInstance) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      const w = window as unknown as { cv?: CV };
      const ready = (c: CV) => {
        cvInstance = c;
        resolve(); // resolve with void — the Emscripten module is thenable and would recurse
      };
      const c = w.cv;
      if (!c) return reject(new Error('OpenCV global missing'));
      if (c.Mat) return ready(c);
      if (typeof c.then === 'function') {
        c.then((m: CV) => {
          delete m.then; // break thenable self-reference
          ready(m);
        });
        return;
      }
      c.onRuntimeInitialized = () => ready(c);
    };
    script.onerror = () => {
      loading = null;
      reject(new Error(`Failed to load OpenCV.js from ${src}`));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// ── Pipeline placeholders ────────────────────────────────────────────────────

/** Fast pass on a downscaled frame: are all 3 finder markers visible? */
export async function detectMarkers(_frame: ImageData): Promise<MarkerDetection> {
  // TODO(opencv): implement finder-pattern detection.
  return { found: false, corners: [] };
}

/** Slow pass on a full-resolution capture: flatten + read bubbles + SBD. */
export async function warpAndGrade(_source: HTMLCanvasElement, _questionCount: number): Promise<GradeOutput> {
  // TODO(opencv): implement perspective warp + bubble reading.
  throw new Error('warpAndGrade not implemented yet');
}

// ── Pure grading logic (real, shared by Scanner + Review) ────────────────────

export function scoreAnswers(answers: readonly (AnswerOption | null)[], key: readonly AnswerOption[]) {
  const wrongAnswers: number[] = [];
  key.forEach((k, i) => {
    if (answers[i] !== k) wrongAnswers.push(i + 1);
  });
  const total = key.length;
  const correct = total - wrongAnswers.length;
  const score = total ? Math.round((correct / total) * 10 * 100) / 100 : 0; // 10-point scale
  return { score, correct, total, wrongAnswers };
}

/** DEV ONLY: fakes a grade from the current camera frame so the UI flow can be exercised. */
export async function simulateGrade(source: HTMLCanvasElement, key: readonly AnswerOption[]): Promise<GradeOutput> {
  await new Promise((r) => setTimeout(r, 250));
  const answers = key.map((k) => {
    const roll = Math.random();
    if (roll < 0.05) return null;
    if (roll < 0.2) return ANSWER_OPTIONS[Math.floor(Math.random() * 4)];
    return k;
  });
  const flattened = await new Promise<Blob>((resolve, reject) =>
    source.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.8),
  );
  const roll = String(1 + Math.floor(Math.random() * 40)).padStart(2, '0');
  return { answers, studentSBD: `91${roll}`, flattened, confidence: 0.9 };
}
