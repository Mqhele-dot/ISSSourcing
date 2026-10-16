import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { fetchDiagnosticsScan, fixDiagnostics } from "@/api/client";
import { SpotlightTourLayer } from "@/components/tutorial/spotlight-tour-layer";
import {
  getStepPlacement,
  getStepTargetSelector,
  shouldUseSpotlightShell,
  type TutorialStep,
} from "@/components/tutorial/tutorial-types";

export type { TutorialStep } from "@/components/tutorial/tutorial-types";

interface TutorialContextType {
  startTutorial: (tourId?: string) => boolean;
  endTutorial: () => void;
  isTutorialActive: boolean;
  currentStep: number;
  registerTutorial: (tourId: string, steps: TutorialStep[]) => void;
  scanForErrors: () => Promise<{ [key: string]: string[] }>;
  fixErrors: (errorType: string) => Promise<{ success: boolean; message?: string }>;
  activeTourSteps: TutorialStep[] | null;
  goToNextStep: () => void;
  goToPreviousStep: () => void;
}

const TutorialContext = createContext<TutorialContextType | undefined>(undefined);

function normalizePath(p: string) {
  const base = p.split("?")[0] || "/";
  if (base === "/") return "/";
  return base.replace(/\/$/, "") || "/";
}

function pathMatchesRoute(location: string, route: string, exact: boolean): boolean {
  const loc = normalizePath(location);
  const r = normalizePath(route);
  if (exact) return loc === r;
  if (loc === r) return true;
  return loc.startsWith(`${r}/`);
}

interface TutorialProviderProps {
  children: ReactNode;
}

export function TutorialProvider({ children }: TutorialProviderProps) {
  const [locationPath, setLocation] = useLocation();
  const [isTutorialActive, setIsTutorialActive] = useState(false);
  const [activeTour, setActiveTour] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [tutorials, setTutorials] = useState<{ [key: string]: TutorialStep[] }>({});
  const [stepReady, setStepReady] = useState(false);
  const [spotRect, setSpotRect] = useState<DOMRect | null>(null);
  const [targetEl, setTargetEl] = useState<Element | null>(null);

  const goToNextRef = useRef<() => void>(() => {});
  const goToPrevRef = useRef<() => void>(() => {});
  const endTutorialRef = useRef<() => void>(() => {});

  const registerTutorial = useCallback((tourId: string, steps: TutorialStep[]) => {
    setTutorials((prev) => ({
      ...prev,
      [tourId]: steps,
    }));
  }, []);

  const activeTourSteps = activeTour && tutorials[activeTour] ? tutorials[activeTour] : null;
  const step = activeTourSteps?.[currentStep];

  const endTutorial = useCallback(() => {
    setIsTutorialActive(false);
    setActiveTour(null);
    setCurrentStep(0);
    setStepReady(false);
    setSpotRect(null);
    setTargetEl(null);
  }, []);

  const goToNextStep = useCallback(() => {
    if (!activeTourSteps) return;
    if (currentStep < activeTourSteps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      endTutorial();
    }
  }, [activeTourSteps, currentStep, endTutorial]);

  const goToPreviousStep = useCallback(() => {
    if (!activeTourSteps) return;
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [activeTourSteps, currentStep]);

  useEffect(() => {
    goToNextRef.current = goToNextStep;
    goToPrevRef.current = goToPreviousStep;
    endTutorialRef.current = endTutorial;
  }, [goToNextStep, goToPreviousStep, endTutorial]);

  const startTutorial = useCallback(
    (tourId = "main"): boolean => {
      if (!tutorials[tourId]) {
        console.warn(`Tutorial with ID "${tourId}" not found.`);
        return false;
      }
      setActiveTour(tourId);
      setCurrentStep(0);
      setIsTutorialActive(true);
      setStepReady(false);
      setSpotRect(null);
      setTargetEl(null);
      return true;
    },
    [tutorials],
  );

  // Route alignment for the current step
  useEffect(() => {
    if (!isTutorialActive || !step) {
      setStepReady(false);
      return;
    }
    setStepReady(false);
    let cancelled = false;
    const settle = step.settleMs ?? 0;
    const proceed = () => {
      if (!cancelled) setStepReady(true);
    };
    const route = step.route?.trim();
    if (!route) {
      const id = window.setTimeout(proceed, settle);
      return () => {
        cancelled = true;
        window.clearTimeout(id);
      };
    }
    const exact = step.routeExact ?? false;
    const ok = pathMatchesRoute(locationPath, route, exact);
    if (!ok) {
      setStepReady(false);
      setLocation(route);
      const id = window.setTimeout(proceed, Math.max(settle, 380));
      return () => {
        cancelled = true;
        window.clearTimeout(id);
      };
    }
    const id = window.setTimeout(proceed, Math.max(settle, 16));
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [isTutorialActive, step, locationPath, setLocation]);

  const selector = useMemo(() => getStepTargetSelector(step), [step]);
  const useSpotlightShell = useMemo(() => shouldUseSpotlightShell(step), [step]);
  const placement = useMemo(() => getStepPlacement(step), [step]);

  // Measure spotlight target + keep in sync on scroll/resize
  useLayoutEffect(() => {
    if (!isTutorialActive || !stepReady || !step) {
      setSpotRect(null);
      setTargetEl(null);
      return;
    }
    if (!useSpotlightShell) {
      setSpotRect(null);
      setTargetEl(null);
      return;
    }
    let ro: ResizeObserver | null = null;
    let poll: number | null = null;
    const update = () => {
      if (!selector) {
        setSpotRect(null);
        setTargetEl(null);
        return;
      }
      const el = document.querySelector(selector);
      if (!el) {
        setSpotRect(null);
        setTargetEl(null);
        return;
      }
      setTargetEl(el);
      setSpotRect(el.getBoundingClientRect());
    };
    update();
    const el = selector ? document.querySelector(selector) : null;
    if (el) {
      ro = new ResizeObserver(() => update());
      ro.observe(el);
    } else if (selector) {
      let n = 0;
      poll = window.setInterval(() => {
        n += 1;
        update();
        if (document.querySelector(selector) || n > 40) {
          if (poll) window.clearInterval(poll);
        }
      }, 200);
    }
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      if (poll) window.clearInterval(poll);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [isTutorialActive, stepReady, step, selector, useSpotlightShell]);

  // Scroll legacy targetSelector / attach target into view
  useEffect(() => {
    if (!isTutorialActive || !activeTourSteps || !stepReady) return;
    const sel = selector;
    if (!sel) return;
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(sel);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [isTutorialActive, activeTourSteps, currentStep, selector, stepReady]);

  // Click-to-advance (e.g. inventory / PO row)
  useEffect(() => {
    if (!isTutorialActive || !step?.advanceOnTargetClick || !targetEl || !stepReady) return;
    const root = targetEl;
    const onPointerDown = (ev: Event) => {
      const e = ev.target;
      if (!(e instanceof Element) || !root.contains(e)) return;
      const tr = e.closest("tr");
      if (!tr || !tr.closest("tbody")) return;
      window.setTimeout(() => goToNextRef.current(), 200);
    };
    root.addEventListener("pointerdown", onPointerDown, true);
    return () => root.removeEventListener("pointerdown", onPointerDown, true);
  }, [isTutorialActive, step?.advanceOnTargetClick, step?.id, targetEl, stepReady]);

  // Escape closes tour
  useEffect(() => {
    if (!isTutorialActive) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        endTutorialRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isTutorialActive]);

  const scanForErrors = async (): Promise<{ [key: string]: string[] }> => {
    const result: { [key: string]: string[] } = {
      database: [],
      configuration: [],
      data: [],
      system: [],
    };
    try {
      const serverResult = await fetchDiagnosticsScan();
      result.database = serverResult.database ?? [];
      result.configuration = serverResult.configuration ?? [];
      result.data = serverResult.data ?? [];
      result.system = serverResult.system ?? [];
    } catch {
      result.database = ["Could not reach server to run diagnostics"];
    }
    if (typeof navigator !== "undefined") {
      if (navigator.permissions?.query) {
        try {
          const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
          if (perm.state === "denied") {
            result.system.push("Camera access not granted");
          }
        } catch {
          result.system.push("Camera access not granted");
        }
      } else if (!navigator.mediaDevices?.getUserMedia) {
        result.system.push("Camera access not granted");
      }
    }
    try {
      const used = typeof localStorage !== "undefined" ? localStorage.length : 0;
      const quota = 5000;
      if (used > quota) {
        result.system.push("Local storage nearly full");
      }
    } catch {
      result.system.push("Local storage nearly full");
    }
    const filtered: { [key: string]: string[] } = {};
    for (const [key, arr] of Object.entries(result)) {
      if (Array.isArray(arr) && arr.length > 0) filtered[key] = arr;
    }
    return filtered;
  };

  const fixErrors = async (errorType: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const fixResult = await fixDiagnostics(errorType);
      const success = fixResult.success;
      const message =
        fixResult.message ??
        (success && fixResult.fixed?.length ? `Fixed: ${fixResult.fixed.length} item(s).` : undefined);
      return { success, message };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Fix failed.";
      return { success: false, message };
    }
  };

  const contextValue = {
    startTutorial,
    endTutorial,
    isTutorialActive,
    currentStep,
    registerTutorial,
    scanForErrors,
    fixErrors,
    activeTourSteps,
    goToNextStep,
    goToPreviousStep,
  };

  const showSpotlight =
    isTutorialActive &&
    activeTourSteps &&
    step &&
    stepReady &&
    useSpotlightShell;

  const advanceHint = step?.advanceOnTargetClick
    ? "Try it: click a row in the highlighted area to jump ahead — or use Next."
    : undefined;

  return (
    <TutorialContext.Provider value={contextValue}>
      {children}

      {showSpotlight ? (
        <SpotlightTourLayer
          rect={spotRect}
          placement={placement}
          title={step.title}
          description={step.text}
          stepIndex={currentStep}
          stepCount={activeTourSteps.length}
          canGoBack={currentStep > 0}
          isLast={currentStep === activeTourSteps.length - 1}
          advanceHint={advanceHint}
          onNext={goToNextStep}
          onPrev={goToPreviousStep}
          onDismiss={endTutorial}
        />
      ) : null}

      {isTutorialActive && activeTourSteps && step && stepReady && !showSpotlight ? (
        <Dialog open onOpenChange={(open) => !open && endTutorial()}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{step.title || "Tutorial"}</DialogTitle>
              <DialogDescription className="whitespace-pre-wrap">
                {step.text || "Follow these steps to learn about the application."}
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-between items-center pt-4">
              <div className="text-sm text-muted-foreground">
                Step {currentStep + 1} of {activeTourSteps.length}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={goToPreviousStep} disabled={currentStep === 0}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <Button variant="default" size="sm" onClick={goToNextStep}>
                  {currentStep === activeTourSteps.length - 1 ? "Finish" : "Next"}
                  {currentStep < activeTourSteps.length - 1 ? <ChevronRight className="h-4 w-4 ml-1" /> : null}
                </Button>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="ghost" size="sm" onClick={endTutorial}>
                <X className="h-4 w-4 mr-1" />
                Skip Tutorial
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (context === undefined) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return context;
}
