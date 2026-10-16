import React from 'react';
import { useElectron } from '../../contexts/electron-provider';
import { X, Minus, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TitleBarProps {
  title?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({ title = 'Inventory Management System' }) => {
  const { isElectron, electron } = useElectron();

  if (!isElectron) {
    return null;
  }

  const handleMinimize = () => {
    if (electron) {
      electron.invoke('window-minimize');
    }
  };

  const handleMaximize = () => {
    if (electron) {
      electron.invoke('window-maximize');
    }
  };

  const handleClose = () => {
    if (electron) {
      electron.invoke('window-close');
    }
  };

  return (
    <div className="h-9 flex items-center px-2 bg-primary/5 border-b border-border/40 select-none drag-region">
      <div className="flex items-center h-full">
        <div className="w-6 h-6 mr-2 flex items-center justify-center">
          <img src="/logo.svg" alt="Logo" className="w-4 h-4" />
        </div>
        <span className="text-xs font-medium">{title}</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center no-drag">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-sm hover:bg-muted"
          onClick={handleMinimize}
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-sm hover:bg-muted"
          onClick={handleMaximize}
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-sm hover:bg-destructive/90 hover:text-destructive-foreground"
          onClick={handleClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};