import { Button } from "@/components/ui/button";
import { useTutorial } from "@/contexts/TutorialContext";
import { HelpCircle } from "lucide-react";

interface TutorialStepProps {
  page?: string;
  pageName?: string;
  className?: string;
}

export default function TutorialStep({ page, pageName, className = "" }: TutorialStepProps) {
  const { startTutorial } = useTutorial();
  const tutorialPage = page || pageName || "dashboard";
  
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => startTutorial(tutorialPage)}
      className={`gap-1 ${className}`}
    >
      <HelpCircle className="h-4 w-4" />
      <span>Tutorial</span>
    </Button>
  );
}