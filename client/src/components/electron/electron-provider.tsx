import { ReactNode, createContext, useContext, useEffect, useState } from "react";
import { appControls, isElectron } from "@/lib/electron-bridge";

interface UpdateInfo {
  version: string;
  releaseDate: string;
  releaseNotes: string;
}

interface ElectronContextType {
  isElectron: boolean;
  appVersion: string;
  updateAvailable: UpdateInfo | null;
  updateDownloaded: UpdateInfo | null;
  installUpdate: () => void;
}

const ElectronContext = createContext<ElectronContextType>({
  isElectron: false,
  appVersion: "",
  updateAvailable: null,
  updateDownloaded: null,
  installUpdate: () => {},
});

export const useElectron = () => useContext(ElectronContext);

interface ElectronProviderProps {
  children: ReactNode;
}

export const ElectronProvider = ({ children }: ElectronProviderProps) => {
  const [appVersion, setAppVersion] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Get application version
    const getAppVersion = async () => {
      if (isElectron) {
        const version = await appControls.getVersion();
        setAppVersion(version);
      }
    };

    getAppVersion();

    // Set up update listeners
    if (isElectron) {
      const removeUpdateAvailableListener = appControls.onUpdateAvailable((info) => {
        setUpdateAvailable(info);
      });

      const removeUpdateDownloadedListener = appControls.onUpdateDownloaded((info) => {
        setUpdateDownloaded(info);
      });

      return () => {
        removeUpdateAvailableListener();
        removeUpdateDownloadedListener();
      };
    }
  }, []);

  const installUpdate = () => {
    if (isElectron && updateDownloaded) {
      appControls.installUpdate();
    }
  };

  return (
    <ElectronContext.Provider
      value={{
        isElectron,
        appVersion,
        updateAvailable,
        updateDownloaded,
        installUpdate,
      }}
    >
      {children}
    </ElectronContext.Provider>
  );
};