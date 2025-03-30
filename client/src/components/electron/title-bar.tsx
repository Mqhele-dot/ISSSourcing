import React, { useState, useEffect } from 'react';
import { useElectron } from '@/contexts/electron-provider';
import { Maximize2, Minimize2, Minus, Square, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TitleBarProps {
  title?: string;
}

/**
 * Custom window title bar for Electron application
 * 
 * Provides window controls (minimize, maximize/restore, close) and displays the app title.
 * This component is designed to match the look and feel of native title bars while
 * allowing for custom styling consistent with the application theme.
 */
export function TitleBar({ title = 'InvTrack' }: TitleBarProps) {
  const { 
    isElectron,
    isMaximized,
    minimizeWindow,
    maximizeWindow,
    unmaximizeWindow,
    closeWindow,
    appVersion 
  } = useElectron();
  
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  
  useEffect(() => {
    if (isElectron && title) {
      document.title = title;
    }
  }, [isElectron, title]);
  
  if (!isElectron) {
    return null;
  }
  
  return (
    <div
      className="h-9 flex items-center justify-between bg-background border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center px-3">
        <img src="/logo-small.svg" alt="InvTrack Logo" className="h-5 w-5 mr-2" />
        <span className="text-sm font-medium">{title}</span>
        {appVersion && (
          <span className="text-xs text-muted-foreground ml-2">v{appVersion}</span>
        )}
      </div>
      
      <div className="flex items-center" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          className={cn(
            "h-9 w-12 flex items-center justify-center text-muted-foreground transition-colors",
            hoveredButton === 'minimize' ? 'hover:bg-muted/50' : ''
          )}
          onClick={minimizeWindow}
          onMouseEnter={() => setHoveredButton('minimize')}
          onMouseLeave={() => setHoveredButton(null)}
          aria-label="Minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        
        <button
          className={cn(
            "h-9 w-12 flex items-center justify-center text-muted-foreground transition-colors",
            hoveredButton === 'maximize' ? 'hover:bg-muted/50' : ''
          )}
          onClick={isMaximized ? unmaximizeWindow : maximizeWindow}
          onMouseEnter={() => setHoveredButton('maximize')}
          onMouseLeave={() => setHoveredButton(null)}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        
        <button
          className={cn(
            "h-9 w-12 flex items-center justify-center text-muted-foreground transition-colors",
            hoveredButton === 'close' ? 'hover:bg-red-500 hover:text-white' : ''
          )}
          onClick={closeWindow}
          onMouseEnter={() => setHoveredButton('close')}
          onMouseLeave={() => setHoveredButton(null)}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}