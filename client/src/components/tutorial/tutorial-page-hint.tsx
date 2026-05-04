import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { BookOpen, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTutorial } from "@/contexts/tutorial-context";
import { useTrainingPanel } from "@/contexts/training-panel-context";
import { getPageTourForPath, pageTourStorageKey } from "@/components/tutorial/tutorial-route-map";
import { pathToTrainingModuleId } from "@/lib/training/training-path-map";

/**
 * Lightweight prompt for the current route: offers a page-scoped interactive tour.
 * Dismissal is remembered per tour id in localStorage.
 */
export function TutorialPageHint() {
  const [path] = useLocation();
  const { startTutorial, isTutorialActive } = useTutorial();
  const { openTrainingPanel } = useTrainingPanel();
  const [dismissed, setDismissed] = useState(true);

  const meta = getPageTourForPath(path);

  useEffect(() => {
    if (!meta) {
      setDismissed(true);
      return;
    }
    try {
      setDismissed(localStorage.getItem(pageTourStorageKey(meta.tourId)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [meta]);

  const pathOnly = path.split("?")[0] || "/";
  const contextualModuleId = pathToTrainingModuleId(pathOnly);

  const dismissAndRemember = useCallback(() => {
    if (!meta) return;
    try {
      localStorage.setItem(pageTourStorageKey(meta.tourId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, [meta]);

  const launchLearningPanel = useCallback(() => {
    if (!meta) return;
    if (contextualModuleId) {
      openTrainingPanel(contextualModuleId);
    } else if (!startTutorial(meta.tourId)) {
      return;
    }
    dismissAndRemember();
  }, [meta, contextualModuleId, openTrainingPanel, startTutorial, dismissAndRemember]);

  const launchSpotlightTour = useCallback(() => {
    if (!meta) return;
    if (!startTutorial(meta.tourId)) return;
    dismissAndRemember();
  }, [meta, startTutorial, dismissAndRemember]);

  if (!meta || dismissed || isTutorialActive) return null;

  return (
    <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="text-foreground/90">
          New here? <strong className="font-medium">{meta.label}</strong> — start with{" "}
          {contextualModuleId ? "the short lesson on this page" : "the guided tour"}, or use the spotlight tour to
          highlight controls. Skipping onboarding increases mismatched inventory, late POs, and AP errors.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 shrink-0">
        <Button type="button" size="sm" className="h-8 gap-1" onClick={launchLearningPanel}>
          <BookOpen className="h-3.5 w-3.5" aria-hidden />
          {contextualModuleId ? "Open lesson" : "Start tour"}
        </Button>
        {contextualModuleId ? (
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={launchSpotlightTour}>
            Spotlight tour
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={dismissAndRemember}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
