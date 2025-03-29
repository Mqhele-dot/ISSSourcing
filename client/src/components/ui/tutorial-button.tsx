import React from 'react';
import { Button } from '@/components/ui/button';
import { HelpCircle } from 'lucide-react';
import { useTutorial } from '@/contexts/TutorialContext';

interface TutorialButtonProps {
  pageName: string;
  className?: string;
}

export const TutorialButton: React.FC<TutorialButtonProps> = ({ 
  pageName,
  className 
}) => {
  const { startTutorial, isTutorialActive } = useTutorial();

  const handleStartTutorial = () => {
    startTutorial(pageName);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={`tutorial-button items-center ${className || ''}`}
      onClick={handleStartTutorial}
      disabled={isTutorialActive}
    >
      <HelpCircle className="h-4 w-4 mr-2" />
      <span>Tutorial</span>
    </Button>
  );
};

export default TutorialButton;