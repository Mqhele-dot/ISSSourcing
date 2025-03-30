import { useEffect, useState } from "react";
import { Maximize2, Minimize2, X, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { windowControls, isElectron } from "@/lib/electron-bridge";

interface TitleBarProps {
  title?: string;
  className?: string;
}

export const TitleBar = ({ title = "InvTrack", className }: TitleBarProps) => {
  const [isMaximized, setIsMaximized] = useState(false);

  // Check if window is maximized on mount and whenever the window size changes
  const checkMaximized = async () => {
    if (isElectron) {
      const maximized = await windowControls.isMaximized();
      setIsMaximized(maximized);
    }
  };

  useEffect(() => {
    checkMaximized();

    // Add event listener for resize to update maximized state
    window.addEventListener("resize", checkMaximized);
    return () => {
      window.removeEventListener("resize", checkMaximized);
    };
  }, []);

  // If not running in Electron, don't display the title bar
  if (!isElectron) {
    return null;
  }

  return (
    <div
      className={cn(
        "h-9 flex items-center bg-background border-b border-border select-none",
        className
      )}
    >
      <div className="flex-1 px-4 text-sm font-medium draggable">{title}</div>
      <div className="flex items-center">
        <button
          onClick={windowControls.minimize}
          className="h-9 w-12 inline-flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Minimize"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
        <button
          onClick={windowControls.maximize}
          className="h-9 w-12 inline-flex items-center justify-center hover:bg-muted transition-colors"
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <Square className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={windowControls.close}
          className="h-9 w-12 inline-flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};