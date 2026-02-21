import { Button } from "@/components/ui/button";
import { useTutorial } from "@/contexts/tutorial-context";
import { useToast } from "@/hooks/use-toast";
import { HelpCircle } from "lucide-react";

interface TutorialStepProps {
  page?: string;
  pageName?: string;
  className?: string;
}

export default function TutorialStep({ page, pageName, className = "" }: TutorialStepProps) {
  const { startTutorial } = useTutorial();
  const { toast } = useToast();
  const tutorialPage = page || pageName || "dashboard";

  const handleClick = () => {
    const started = startTutorial(tutorialPage);
    if (!started) {
      toast({
        title: "Tutorial not available",
        description: `No steps registered for "${tutorialPage}". Try the Help menu for the full tour.`,
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      className={`gap-1 ${className}`}
    >
      <HelpCircle className="h-4 w-4" />
      <span>Tutorial</span>
    </Button>
  );
}