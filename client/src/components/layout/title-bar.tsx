import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { useElectron } from '@/contexts/electron-provider';

export function TitleBar() {
  const { isElectron, isMaximized, toggleMaximize, minimizeWindow, closeWindow } = useElectron();

  // Only show the custom title bar in Electron environment
  if (!isElectron) return null;

  return (
    <div className="bg-secondary h-9 flex items-center justify-between px-2 select-none drag">
      <div className="text-sm font-medium text-foreground/70 px-2">InvTrack - Inventory Management System</div>
      <div className="flex no-drag">
        <button 
          className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-none transition-colors"
          onClick={minimizeWindow}
          aria-label="Minimize"
        >
          <Minus size={16} />
        </button>
        <button 
          className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-none transition-colors"
          onClick={toggleMaximize}
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          <Square size={14} />
        </button>
        <button 
          className="h-8 w-8 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground rounded-none transition-colors"
          onClick={closeWindow}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}