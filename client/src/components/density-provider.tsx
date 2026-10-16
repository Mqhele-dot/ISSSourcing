import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type DensityMode = "compact" | "comfortable" | "spacious";

type DensityProviderProps = {
  children: React.ReactNode;
  defaultDensity?: DensityMode;
  storageKey?: string;
};

type DensityContextState = {
  density: DensityMode;
  setDensity: (density: DensityMode) => void;
};

const DensityContext = createContext<DensityContextState | undefined>(undefined);

export function DensityProvider({
  children,
  defaultDensity = "comfortable",
  storageKey = "invtrack-density",
}: DensityProviderProps) {
  const [density, setDensityState] = useState<DensityMode>(() => {
    if (typeof window === "undefined") {
      return defaultDensity;
    }
    const stored = window.localStorage.getItem(storageKey) as DensityMode | null;
    if (stored === "compact" || stored === "comfortable" || stored === "spacious") {
      return stored;
    }
    return defaultDensity;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    window.localStorage.setItem(storageKey, density);
  }, [density, storageKey]);

  const value = useMemo<DensityContextState>(
    () => ({
      density,
      setDensity: (nextDensity) => setDensityState(nextDensity),
    }),
    [density],
  );

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity() {
  const context = useContext(DensityContext);
  if (!context) {
    throw new Error("useDensity must be used within a DensityProvider");
  }
  return context;
}
