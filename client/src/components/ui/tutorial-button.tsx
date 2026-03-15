import { Button } from "@/components/ui/button";
import { useTutorial } from "@/contexts/tutorial-context";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { HelpCircle } from "lucide-react";

/** Per-page "Tutorial" button: starts the tour for the current page (e.g. dashboard, analytics). For the full help dialog with all tutorials, use components/tutorial/tutorial-button.tsx. */
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
  suppliers: "/suppliers",
  users: "/user-roles",
  settings: "/settings",
  purchase: "/purchase",
  barcode: "/barcode-scanner",
};

export default function TutorialStep({ page, pageName, className = "" }: TutorialStepProps) {
  const { startTutorial } = useTutorial();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
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