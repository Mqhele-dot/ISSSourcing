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

  const pathOnly = pathname.split("?")[0] || "/";
  const contextualModuleId = pathToTrainingModuleId(pathOnly);

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
    if (contextualModuleId) {
      openTrainingPanel(contextualModuleId);
      toast({
        title: "Learning for this page",
        description:
          "Use the training card on this screen for context, why it matters at work, and mistakes to avoid. You can still run the spotlight tour from the second button.",
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

  const handleSpotlightOnly = () => {
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
    <div className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className="gap-1"
        data-help-title="Page tutorial"
        data-help-description={
          contextualModuleId
            ? "Open the on-page lesson first; use Spotlight for control highlights."
            : "Start the step-by-step spotlight tour for this page."
        }
      >
        <HelpCircle className="h-4 w-4" />
        <span>{contextualModuleId ? "Learning" : "Tutorial"}</span>
      </Button>
      {contextualModuleId ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSpotlightOnly}
          className="h-8 px-2 text-xs text-muted-foreground"
          data-help-title="Spotlight tour"
          data-help-description="Highlight specific controls on this page with the classic guided tour."
        >
          Spotlight
        </Button>
      ) : null}
    </div>
  );
}