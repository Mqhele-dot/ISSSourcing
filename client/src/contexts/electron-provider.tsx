import React, { createContext, useContext, useEffect, useState } from 'react';
import { ElectronBridge, isElectronEnvironment } from '../lib/electron-bridge';

export interface ElectronContextType {
  isElectron: boolean;
  bridge: ElectronBridge | null;
  electron?: {
    on: (channel: string, callback: (...args: any[]) => void) => () => void;
    invoke: (channel: string, ...args: any[]) => Promise<any>;
    send: (channel: string, ...args: any[]) => void;
  } | null;
}

const ElectronContext = createContext<ElectronContextType>({
  isElectron: false,
  bridge: null,
  electron: null,
});

interface ElectronProviderProps {
  children: React.ReactNode;
}

export const ElectronProvider: React.FC<ElectronProviderProps> = ({ children }) => {
  const [isElectron, setIsElectron] = useState(false);
  const [bridge, setBridge] = useState<ElectronBridge | null>(null);
  const [electron, setElectron] = useState<ElectronContextType['electron']>(null);

  useEffect(() => {
    // Check if we're running in Electron
    const inElectron = isElectronEnvironment();
    setIsElectron(inElectron);

    if (inElectron) {
      // Create electron bridge instance
      const electronBridge = new ElectronBridge();
      setBridge(electronBridge);

      // Create a wrapper for the electron IPC API
      setElectron({
        on: (channel, callback) => {
          // @ts-ignore - window.electron is injected by Electron preload script
          const removeListener = window.electron.on(channel, callback);
          return removeListener;
        },
        invoke: (channel, ...args) => {
          // @ts-ignore - window.electron is injected by Electron preload script
          return window.electron.invoke(channel, ...args);
        },
        send: (channel, ...args) => {
          // @ts-ignore - window.electron is injected by Electron preload script
          window.electron.send(channel, ...args);
        },
      });
    }
  }, []);

  return (
    <ElectronContext.Provider value={{ isElectron, bridge, electron }}>
      {children}
    </ElectronContext.Provider>
  );
};

export const useElectron = () => useContext(ElectronContext);