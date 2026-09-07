import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AccentName = "blue" | "teal" | "purple" | "orange" | "rose";

export type AccentConfig = {
  hue: number;
  saturation: number;
  lightness: number;
  preset: AccentName | "custom";
};

type AccentProviderProps = {
  children: React.ReactNode;
  defaultAccent?: AccentName;
  storageKey?: string;
};

type AccentContextState = {
  accent: AccentName | "custom";
  accentConfig: AccentConfig;
  setAccent: (accent: AccentName) => void;
  cycleAccent: () => void;
  setAccentConfig: (next: Partial<Omit<AccentConfig, "preset">>) => void;
  setPreset: (preset: AccentName) => void;
};

const PRESET_CONFIGS: Record<AccentName, Omit<AccentConfig, "preset">> = {
  blue: { hue: 221, saturation: 83, lightness: 53 },
  teal: { hue: 173, saturation: 80, lightness: 40 },
  purple: { hue: 266, saturation: 85, lightness: 58 },
  orange: { hue: 28, saturation: 96, lightness: 53 },
  rose: { hue: 340, saturation: 82, lightness: 55 },
};

const accents: AccentName[] = ["blue", "teal", "purple", "orange", "rose"];

const AccentContext = createContext<AccentContextState | undefined>(undefined);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildShadeValue(hue: number, saturation: number, lightness: number, offset: number) {
  const nextLightness = clamp(lightness + offset, 8, 98);
  const nextSaturation = clamp(saturation + Math.round(offset * -0.15), 25, 100);
  return `${Math.round(hue)} ${Math.round(nextSaturation)}% ${Math.round(nextLightness)}%`;
}

function applyAccent(config: AccentConfig, accentName: AccentName | "custom") {
  if (typeof document === "undefined") {
    return;
  }

  const hue = clamp(config.hue, 0, 360);
  const saturation = clamp(config.saturation, 20, 100);
  const lightness = clamp(config.lightness, 25, 75);

  const shades = {
    100: buildShadeValue(hue, saturation, lightness, 38),
    200: buildShadeValue(hue, saturation, lightness, 30),
    300: buildShadeValue(hue, saturation, lightness, 22),
    400: buildShadeValue(hue, saturation, lightness, 12),
    500: buildShadeValue(hue, saturation, lightness, 0),
    600: buildShadeValue(hue, saturation, lightness, -8),
    700: buildShadeValue(hue, saturation, lightness, -15),
    800: buildShadeValue(hue, saturation, lightness, -22),
    900: buildShadeValue(hue, saturation, lightness, -30),
  } as const;

  const hueTwo = (hue + 18) % 360;
  const root = document.documentElement;
  root.setAttribute("data-accent", accentName);
  root.style.setProperty("--accent-100", shades[100]);
  root.style.setProperty("--accent-200", shades[200]);
  root.style.setProperty("--accent-300", shades[300]);
  root.style.setProperty("--accent-400", shades[400]);
  root.style.setProperty("--accent-500", shades[500]);
  root.style.setProperty("--accent-600", shades[600]);
  root.style.setProperty("--accent-700", shades[700]);
  root.style.setProperty("--accent-800", shades[800]);
  root.style.setProperty("--accent-900", shades[900]);
  root.style.setProperty("--primary", shades[500]);
  root.style.setProperty("--ring", shades[600]);
  root.style.setProperty("--chart-1", shades[500]);
  root.style.setProperty("--chart-2", `${hueTwo} ${Math.round(clamp(saturation - 6, 20, 100))}% ${Math.round(clamp(lightness, 22, 68))}%`);
  root.style.setProperty("--chart-3", `${(hue + 36) % 360} ${Math.round(clamp(saturation - 4, 20, 100))}% ${Math.round(clamp(lightness - 4, 20, 64))}%`);
  root.style.setProperty(
    "--accent-gradient",
    `linear-gradient(135deg, hsl(${shades[500]}), hsl(${hueTwo} ${Math.round(clamp(saturation + 4, 25, 100))}% ${Math.round(clamp(lightness - 6, 20, 60))}%))`,
  );
  root.style.setProperty(
    "--accent-glow",
    `0 0 0 1px hsl(${shades[500]} / 0.16), 0 18px 45px -28px hsl(${shades[500]} / 0.58)`,
  );
}

export function AccentProvider({
  children,
  defaultAccent = "blue",
  storageKey = "invtrack-accent",
}: AccentProviderProps) {
  const configStorageKey = `${storageKey}-hsl`;

  const [accent, setAccentState] = useState<AccentName | "custom">(() => {
    if (typeof window === "undefined") {
      return defaultAccent;
    }
    const stored = window.localStorage.getItem(storageKey) as AccentName | "custom" | null;
    if (stored && (stored === "custom" || accents.includes(stored as AccentName))) {
      return stored;
    }
    return defaultAccent;
  });

  const [accentConfig, setAccentConfigState] = useState<AccentConfig>(() => {
    if (typeof window === "undefined") {
      return {
        ...PRESET_CONFIGS[defaultAccent],
        preset: defaultAccent,
      };
    }

    const stored = window.localStorage.getItem(configStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<AccentConfig>;
        if (
          typeof parsed.hue === "number" &&
          typeof parsed.saturation === "number" &&
          typeof parsed.lightness === "number"
        ) {
          return {
            hue: parsed.hue,
            saturation: parsed.saturation,
            lightness: parsed.lightness,
            preset:
              parsed.preset && (parsed.preset === "custom" || accents.includes(parsed.preset))
                ? parsed.preset
                : defaultAccent,
          };
        }
      } catch {
        // ignore malformed local storage and use defaults
      }
    }

    return {
      ...PRESET_CONFIGS[defaultAccent],
      preset: defaultAccent,
    };
  });

  useEffect(() => {
    applyAccent(accentConfig, accent);
    window.localStorage.setItem(storageKey, accent);
    window.localStorage.setItem(configStorageKey, JSON.stringify(accentConfig));
  }, [accent, accentConfig, configStorageKey, storageKey]);

  const value = useMemo<AccentContextState>(
    () => ({
      accent,
      accentConfig,
      setAccent: (nextAccent) => {
        const preset = PRESET_CONFIGS[nextAccent];
        setAccentState(nextAccent);
        setAccentConfigState({
          ...preset,
          preset: nextAccent,
        });
      },
      setPreset: (preset) => {
        const next = PRESET_CONFIGS[preset];
        setAccentState(preset);
        setAccentConfigState({
          ...next,
          preset,
        });
      },
      setAccentConfig: (next) => {
        setAccentState("custom");
        setAccentConfigState((current) => ({
          hue: clamp(next.hue ?? current.hue, 0, 360),
          saturation: clamp(next.saturation ?? current.saturation, 20, 100),
          lightness: clamp(next.lightness ?? current.lightness, 25, 75),
          preset: "custom",
        }));
      },
      cycleAccent: () => {
        const cycleBase = accent === "custom" ? defaultAccent : accent;
        const currentIndex = accents.indexOf(cycleBase);
        const nextIndex = (currentIndex + 1) % accents.length;
        const nextAccent = accents[nextIndex];
        const preset = PRESET_CONFIGS[nextAccent];
        setAccentState(nextAccent);
        setAccentConfigState({
          ...preset,
          preset: nextAccent,
        });
      },
    }),
    [accent, accentConfig, defaultAccent],
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
