import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTutorial } from "@/contexts/tutorial-context";
import { getPageTourForPath, pageTourStorageKey } from "@/components/tutorial/tutorial-route-map";

/**
 * Lightweight prompt for the current route: offers a page-scoped interactive tour.
 * Dismissal is remembered per tour id in localStorage.
 */
export function TutorialPageHint() {
  const [path] = useLocation();
  const { startTutorial, isTutorialActive } = useTutorial();
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
  }, [meta?.tourId]);

  const dismiss = useCallback(() => {
    if (!meta) return;
    try {
      localStorage.setItem(pageTourStorageKey(meta.tourId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, [meta]);

  const launch = useCallback(() => {
    if (!meta) return;
    if (!startTutorial(meta.tourId)) return;
    try {
      localStorage.setItem(pageTourStorageKey(meta.tourId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, [meta, startTutorial]);

  if (!meta || dismissed || isTutorialActive) return null;

  return (
    <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm shadow-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="text-foreground/90">
          New here? Take the <strong className="font-medium">{meta.label}</strong> tour — it highlights real controls on
          this screen.
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button type="button" size="sm" className="h-8" onClick={launch}>
          Start
        </Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={dismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
