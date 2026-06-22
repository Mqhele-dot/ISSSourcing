import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

type TrainingPanelContextValue = {
  /** Opening this module id expands matching panels (and can flash expand state) */
  focusedModuleId: string | null;
  openTrainingPanel: (moduleId: string) => void;
  clearTrainingFocus: () => void;
};

const TrainingPanelContext = createContext<TrainingPanelContextValue | null>(null);

export function TrainingPanelProvider({ children }: { children: ReactNode }) {
  const [focusedModuleId, setFocusedModuleId] = useState<string | null>(null);

  const openTrainingPanel = useCallback((moduleId: string) => {
    setFocusedModuleId(moduleId);
  }, []);

  const clearTrainingFocus = useCallback(() => {
    setFocusedModuleId(null);
  }, []);

  const value = useMemo(
    () => ({ focusedModuleId, openTrainingPanel, clearTrainingFocus }),
    [focusedModuleId, openTrainingPanel, clearTrainingFocus],
  );

  return <TrainingPanelContext.Provider value={value}>{children}</TrainingPanelContext.Provider>;
}

export function useTrainingPanel(): TrainingPanelContextValue {
  const ctx = useContext(TrainingPanelContext);
  if (!ctx) {
    throw new Error("useTrainingPanel must be used within TrainingPanelProvider");
  }
  return ctx;
}
