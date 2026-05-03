export const TRAINING_PROGRESS_STORAGE_KEY = "invtrack.training.progress";

const STORAGE_KEY = TRAINING_PROGRESS_STORAGE_KEY;

export type TrainingProgressState = {
  lessonsOpened: string[];
  quizzesCompleted: string[];
  markedUnderstood: string[];
  updatedAt: string;
};

function read(): TrainingProgressState {
  if (typeof localStorage === "undefined") {
    return { lessonsOpened: [], quizzesCompleted: [], markedUnderstood: [], updatedAt: new Date().toISOString() };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const p = JSON.parse(raw) as Partial<TrainingProgressState>;
    return {
      lessonsOpened: Array.isArray(p.lessonsOpened) ? p.lessonsOpened : [],
      quizzesCompleted: Array.isArray(p.quizzesCompleted) ? p.quizzesCompleted : [],
      markedUnderstood: Array.isArray(p.markedUnderstood) ? p.markedUnderstood : [],
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { lessonsOpened: [], quizzesCompleted: [], markedUnderstood: [], updatedAt: new Date().toISOString() };
  }
}

function write(s: TrainingProgressState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }));
}

export function getTrainingProgress(): TrainingProgressState {
  return read();
}

export function recordLessonOpened(moduleId: string): void {
  const s = read();
  if (!s.lessonsOpened.includes(moduleId)) {
    s.lessonsOpened = [...s.lessonsOpened, moduleId];
    write(s);
  }
}

export function recordQuizCompleted(moduleId: string, questionIndex: number): void {
  const key = `${moduleId}:${questionIndex}`;
  const s = read();
  if (!s.quizzesCompleted.includes(key)) {
    s.quizzesCompleted = [...s.quizzesCompleted, key];
    write(s);
  }
}

export function toggleModuleUnderstood(moduleId: string): boolean {
  const s = read();
  const on = s.markedUnderstood.includes(moduleId);
  s.markedUnderstood = on ? s.markedUnderstood.filter((x) => x !== moduleId) : [...s.markedUnderstood, moduleId];
  write(s);
  return !on;
}

export function isModuleUnderstood(moduleId: string): boolean {
  return read().markedUnderstood.includes(moduleId);
}
