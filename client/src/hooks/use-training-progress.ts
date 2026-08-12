import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTrainingProgress,
  recordGuidedTopicStarted as persistGuidedTopicStarted,
  recordLessonOpened as persistLessonOpened,
  recordQuizCompleted as persistQuizCompleted,
  toggleModuleUnderstood as persistToggleUnderstood,
  TRAINING_PROGRESS_STORAGE_KEY,
  type TrainingProgressState,
} from "@/lib/training/training-progress";

/**
 * Live view of local training progress; updates after lesson/quiz/understood actions in the same tab
 * (storage events only sync other tabs).
 */
export function useTrainingProgress() {
  const [progress, setProgress] = useState<TrainingProgressState>(() => getTrainingProgress());

  const refresh = useCallback(() => {
    setProgress(getTrainingProgress());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRAINING_PROGRESS_STORAGE_KEY || e.key === null) {
        setProgress(getTrainingProgress());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const recordLessonOpened = useCallback(
    (moduleId: string) => {
      persistLessonOpened(moduleId);
      refresh();
    },
    [refresh],
  );

  const recordQuizCompleted = useCallback(
    (moduleId: string, questionIndex: number) => {
      persistQuizCompleted(moduleId, questionIndex);
      refresh();
    },
    [refresh],
  );

  const recordGuidedTopicStarted = useCallback(
    (topicId: string) => {
      persistGuidedTopicStarted(topicId);
      refresh();
    },
    [refresh],
  );

  const toggleModuleUnderstood = useCallback(
    (moduleId: string) => {
      const on = persistToggleUnderstood(moduleId);
      refresh();
      return on;
    },
    [refresh],
  );

  return useMemo(
    () => ({
      progress,
      refresh,
      refreshProgress: refresh,
      recordLessonOpened,
      recordQuizCompleted,
      recordGuidedTopicStarted,
      toggleModuleUnderstood,
      isModuleUnderstood: (moduleId: string) => progress.markedUnderstood.includes(moduleId),
    }),
    [progress, refresh, recordLessonOpened, recordQuizCompleted, recordGuidedTopicStarted, toggleModuleUnderstood],
  );
}
