import React from 'react';
import { Maximize2, Minimize2, X, Square } from 'lucide-react';
import { useElectron } from '@/contexts/electron-provider';

/**
 * Custom Electron window title bar
 * 
 * This component creates a custom title bar for the Electron application
 * that mimics the native window controls while providing consistent styling
 * across platforms.
 */
export function TitleBar() {
  const { isElectron, platform, isMaximized, appVersion, appControls } = useElectron();
  
  if (!isElectron || !appControls) {
    return null;
  }
  
  return (
    <div className="select-none bg-background border-b border-border flex items-center h-8 justify-between">
      {/* Drag region */}
      <div 
        className="flex-1 h-full px-3 flex items-center text-xs text-muted-foreground"
        style={{ WebkitAppRegion: 'drag' }}
      >
        <span className="font-semibold">Inventory Management</span>
        {appVersion && (
          <span className="ml-2 opacity-50">v{appVersion}</span>
        )}
      </div>
      
      {/* Window controls */}
      <div className="flex h-full">
        {/* Minimize */}
        <button
          className="h-full w-10 flex items-center justify-center hover:bg-muted transition-colors"
          onClick={appControls.minimizeWindow}
          title="Minimize"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
        
        {/* Maximize / Restore */}
        <button
          className="h-full w-10 flex items-center justify-center hover:bg-muted transition-colors"
          onClick={appControls.toggleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          {isMaximized ? <Square className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        
        {/* Close */}
        <button
          className="h-full w-10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
          onClick={appControls.closeWindow}
          title="Close"
          style={{ WebkitAppRegion: 'no-drag' }}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}