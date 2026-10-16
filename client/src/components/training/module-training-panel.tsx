import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ChevronDown, ChevronUp, GraduationCap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { getTrainingModuleById } from "@/lib/training/training-content";
import { useTrainingPanel } from "@/contexts/training-panel-context";

type Props = {
  moduleId: string;
};

function dismissedStorageKey(moduleId: string): string {
  return `invtrack:training-dismissed:${moduleId}`;
}

export function ModuleTrainingPanel({ moduleId }: Props) {
  const mod = getTrainingModuleById(moduleId);
  const { focusedModuleId, clearTrainingFocus } = useTrainingPanel();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem(dismissedStorageKey(moduleId)) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (focusedModuleId === moduleId) {
      setOpen(true);
      setDismissed(false);
      try {
        localStorage.removeItem(dismissedStorageKey(moduleId));
      } catch {
        /* ignore */
      }
      clearTrainingFocus();
      window.requestAnimationFrame(() => {
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        panelRef.current?.focus({ preventScroll: true });
      });
    }
  }, [focusedModuleId, moduleId, clearTrainingFocus]);

  if (!mod || dismissed) return null;

  const dismissForSession = () => {
    try {
      localStorage.setItem(dismissedStorageKey(moduleId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const mistakeLines = mod.functions
    .flatMap((f) => (f.commonMistakes ?? []).map((m) => ({ fn: f.name, m })))
    .slice(0, 5);

  return (
    <Card ref={panelRef} tabIndex={-1} aria-live="polite" className="border-primary/25 bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="module-training-panel">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 py-3">
          <div className="flex items-start gap-2">
            <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="text-sm font-semibold leading-snug text-foreground">Learning: {mod.title}</p>
              <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                {mod.beginnerSummary.length > 180 ? `${mod.beginnerSummary.slice(0, 180)}…` : mod.beginnerSummary}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <CollapsibleTrigger asChild>
              <Button type="button" variant="secondary" size="sm" data-testid="module-training-open-button">
                {open ? (
                  <>
                    <ChevronUp className="mr-1 h-4 w-4" />
                    Hide lesson hints
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-1 h-4 w-4" />
                    Learn this tab
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Dismiss training panel for this visit"
              onClick={() => dismissForSession()}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4 border-t border-border/60 pt-4 text-sm">
            <section>
              <h4 className="font-medium text-foreground">Why this matters at work</h4>
              <p className="mt-1 text-muted-foreground">{mod.workplacePurpose}</p>
            </section>
            <section>
              <h4 className="font-medium text-foreground">Main functions</h4>
              <ul className="mt-1 list-disc space-y-2 pl-5 text-muted-foreground">
                {mod.functions.slice(0, 5).map((f) => (
                  <li key={f.id}>
                    <span className="font-medium text-foreground">{f.name}</span> — {f.whatItDoes}{" "}
                    <span className="text-xs">({f.whyItMatters})</span>
                  </li>
                ))}
              </ul>
            </section>
            {mistakeLines.length > 0 ? (
              <section>
                <h4 className="font-medium text-foreground">Common mistakes to avoid</h4>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {mistakeLines.map((row, i) => (
                    <li key={i}>
                      <span className="text-foreground/90">{row.fn}:</span> {row.m}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" asChild>
                <Link href={APP_ROUTES.training.getEducatedModule(moduleId)} data-testid="module-training-full-lesson-link">
                  Open full lesson
                </Link>
              </Button>
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link href={APP_ROUTES.training.getEducated}>All modules</Link>
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
