import { repo, type AnswerOption, type ExamRecord, ANSWER_OPTIONS } from './db';

export interface QuestionOption {
  key: AnswerOption;
  text: string;
}

export interface MasterQuestion {
  id?: string;
  originalIndex: number;
  text: string;
  options: QuestionOption[];
  correctAnswer: AnswerOption;
}

export interface ShuffledQuestion {
  questionNumber: number; // 1-based in new paper
  originalNumber: number; // reference to master
  text: string;
  options: {
    key: AnswerOption;
    text: string;
    originalKey: AnswerOption;
  }[];
  correctAnswer: AnswerOption;
}

export interface ExamVariant {
  variantCode: string; // e.g. "101", "102"
  title: string;
  expectedAnswers: AnswerOption[];
  questions: ShuffledQuestion[];
}

export interface ShuffleOptions {
  baseCode: string; // e.g. "101"
  variantCount: number; // e.g. 4
  title: string;
  shuffleQuestions?: boolean; // default true
  shuffleOptions?: boolean; // default true
}

/**
 * Standard unbiased Fisher-Yates array shuffle (returns a new array).
 */
export function fisherYatesShuffle<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generates N variants of an exam from master questions.
 * Permutes question order and option order, recalculating the correct answer key.
 */
export function generateExamVariants(
  masterQuestions: MasterQuestion[],
  options: ShuffleOptions,
): ExamVariant[] {
  const {
    baseCode,
    variantCount,
    title,
    shuffleQuestions = true,
    shuffleOptions = true,
  } = options;

  const variants: ExamVariant[] = [];
  const baseNum = parseInt(baseCode, 10) || 101;

  for (let v = 0; v < variantCount; v++) {
    // Generate sequential code: e.g. 101, 102, 103, 104
    const variantCode = String(baseNum + v).padStart(3, '0').slice(-3);
    const variantTitle = `${title} - Mã đề ${variantCode}`;

    // 1. Determine question sequence (first variant can stay original if desired, or all randomized)
    const questionsPool = v === 0 && !shuffleQuestions
      ? [...masterQuestions]
      : (shuffleQuestions ? fisherYatesShuffle(masterQuestions) : [...masterQuestions]);

    const shuffledQuestions: ShuffledQuestion[] = [];
    const expectedAnswers: AnswerOption[] = [];

    questionsPool.forEach((q, qIdx) => {
      let finalOptions: ShuffledQuestion['options'];
      let newCorrectKey: AnswerOption = 'A';

      if (shuffleOptions) {
        // Randomize the 4 options
        const shuffledRawOptions = fisherYatesShuffle(q.options);
        finalOptions = shuffledRawOptions.map((opt, optIdx) => {
          const assignedKey = ANSWER_OPTIONS[optIdx];
          if (opt.key === q.correctAnswer) {
            newCorrectKey = assignedKey;
          }
          return {
            key: assignedKey,
            text: opt.text,
            originalKey: opt.key,
          };
        });
      } else {
        // Keep options A, B, C, D as originally placed
        finalOptions = q.options.map((opt) => ({
          key: opt.key,
          text: opt.text,
          originalKey: opt.key,
        }));
        newCorrectKey = q.correctAnswer;
      }

      shuffledQuestions.push({
        questionNumber: qIdx + 1,
        originalNumber: q.originalIndex,
        text: q.text,
        options: finalOptions,
        correctAnswer: newCorrectKey,
      });

      expectedAnswers.push(newCorrectKey);
    });

    variants.push({
      variantCode,
      title: variantTitle,
      expectedAnswers,
      questions: shuffledQuestions,
    });
  }

  return variants;
}

/**
 * Fast Key-Only Shuffler:
 * When teacher only enters raw answer keys (e.g. A, B, C, D...) without typing question bodies.
 */
export function generateKeyOnlyVariants(
  masterKeys: AnswerOption[],
  options: ShuffleOptions,
): ExamVariant[] {
  const dummyQuestions: MasterQuestion[] = masterKeys.map((key, i) => ({
    originalIndex: i + 1,
    text: `Câu ${i + 1}`,
    options: ANSWER_OPTIONS.map((opt) => ({ key: opt, text: `Lựa chọn ${opt}` })),
    correctAnswer: key,
  }));

  return generateExamVariants(dummyQuestions, options);
}

/**
 * Persists generated variants directly into Dexie.js so the OMR scanner
 * can dynamically recognize and score any of the generated exam codes immediately.
 */
export async function saveVariantsToDexie(variants: ExamVariant[]): Promise<ExamRecord[]> {
  const savedRecords: ExamRecord[] = [];

  for (const variant of variants) {
    const record = await repo.create('exams', {
      answerKeyCode: variant.variantCode,
      title: variant.title,
      expectedAnswers: [...variant.expectedAnswers],
    });
    savedRecords.push(record);
  }

  return savedRecords;
}
