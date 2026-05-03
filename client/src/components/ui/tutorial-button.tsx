import { Button } from "@/components/ui/button";
import { useTutorial } from "@/contexts/tutorial-context";
import { useTrainingPanel } from "@/contexts/training-panel-context";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { HelpCircle } from "lucide-react";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { pathToTrainingModuleId } from "@/lib/training/training-path-map";

/** Per-page "Tutorial" button: opens the on-page training panel when the route maps to a module; otherwise starts the spotlight tour. For the full help dialog, use components/tutorial/tutorial-button.tsx. */
interface TutorialStepProps {
  page?: string;
  pageName?: string;
  className?: string;
}

const PAGE_ROUTES: Record<string, string> = {
  dashboard: "/dashboard",
  inventory: "/inventory",
  reports: "/reports",
  analytics: "/analytics",
  suppliers: APP_ROUTES.procurement.suppliers,
  users: "/user-roles",
  settings: "/settings",
  purchase: "/purchase",
  barcode: "/barcode-scanner",
};

export default function TutorialStep({ page, pageName, className = "" }: TutorialStepProps) {
  const { startTutorial } = useTutorial();
  const { openTrainingPanel } = useTrainingPanel();
  const { toast } = useToast();
  const [pathname, setLocation] = useLocation();
  const tutorialPage = page || pageName || "dashboard";

  const tryStartTutorial = (retryCount = 0) => {
    // Prefer page-specific tour, then fall back to main tour so the user always gets a dialog
    let started = startTutorial(tutorialPage);
    if (!started && tutorialPage !== "main") {
      started = startTutorial("main");
    }
    if (started) return;
    // Tutorials are registered in useLayoutEffect; retry once after a short delay in case of race
    if (retryCount < 2) {
      setTimeout(() => tryStartTutorial(retryCount + 1), 300);
      return;
    }
    toast({
      title: "Tutorial not available",
      description: "The tour could not start. Try refreshing the page and clicking Tutorial again.",
      variant: "destructive",
    });
  };

  const handleClick = () => {
    const pathOnly = pathname.split("?")[0] || "/";
    const contextualModuleId = pathToTrainingModuleId(pathOnly);
    if (contextualModuleId) {
      openTrainingPanel(contextualModuleId);
      toast({
        title: "Learning for this tab",
        description: "Expand the training card on this page for what each area does and why it matters.",
      });
      return;
    }

    const route = PAGE_ROUTES[tutorialPage];
    const currentPath = typeof window !== "undefined" ? window.location.pathname : "";
    const isOnCorrectPage = !route || currentPath.startsWith(route);

    if (!isOnCorrectPage && route) {
      setLocation(route);
      setTimeout(() => tryStartTutorial(), 600);
    } else {
      tryStartTutorial();
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      className={`gap-1 ${className}`}
      data-help-title="Page tutorial"
      data-help-description="Start the step-by-step tutorial for this page (e.g. Dashboard)."
    >
      <HelpCircle className="h-4 w-4" />
      <span>Tutorial</span>
    </Button>
  );
}