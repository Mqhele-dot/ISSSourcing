import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AccentName = "blue" | "teal" | "purple" | "orange";

type AccentProviderProps = {
  children: React.ReactNode;
  defaultAccent?: AccentName;
  storageKey?: string;
};

type AccentContextState = {
  accent: AccentName;
  setAccent: (accent: AccentName) => void;
  cycleAccent: () => void;
};

const accents: AccentName[] = ["blue", "teal", "purple", "orange"];

const AccentContext = createContext<AccentContextState | undefined>(undefined);

function applyAccent(accent: AccentName) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-accent", accent);
}

export function AccentProvider({
  children,
  defaultAccent = "blue",
  storageKey = "invtrack-accent",
}: AccentProviderProps) {
  const [accent, setAccentState] = useState<AccentName>(() => {
    if (typeof window === "undefined") {
      return defaultAccent;
    }

    const stored = window.localStorage.getItem(storageKey) as AccentName | null;
    if (stored && accents.includes(stored)) {
      return stored;
    }

    return defaultAccent;
  });

  useEffect(() => {
    applyAccent(accent);
    window.localStorage.setItem(storageKey, accent);
  }, [accent, storageKey]);

  const value = useMemo<AccentContextState>(
    () => ({
      accent,
      setAccent: (nextAccent) => setAccentState(nextAccent),
      cycleAccent: () => {
        const currentIndex = accents.indexOf(accent);
        const nextIndex = (currentIndex + 1) % accents.length;
        setAccentState(accents[nextIndex]);
      },
    }),
    [accent],
  );

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

export function useAccent() {
  const context = useContext(AccentContext);
  if (!context) {
    throw new Error("useAccent must be used within an AccentProvider");
  }
  return context;
}
