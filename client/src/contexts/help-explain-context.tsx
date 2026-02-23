import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type HelpExplainContextType = {
  explainMode: boolean;
  setExplainMode: (on: boolean) => void;
  toggleExplainMode: () => void;
};

const HelpExplainContext = createContext<HelpExplainContextType | undefined>(undefined);

const HELP_ATTR_TITLE = "data-help-title";
const HELP_ATTR_DESC = "data-help-description";

export function useHelpExplain() {
  const ctx = useContext(HelpExplainContext);
  if (ctx === undefined) throw new Error("useHelpExplain must be used within HelpExplainProvider");
  return ctx;
}

interface HelpExplainProviderProps {
  children: React.ReactNode;
}

export function HelpExplainProvider({ children }: HelpExplainProviderProps) {
  const [explainMode, setExplainModeState] = useState(false);
  const [tooltip, setTooltip] = useState<{ title: string; description: string; x: number; y: number; width: number; height: number } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setExplainMode = useCallback((on: boolean) => {
    setExplainModeState(on);
    if (!on) setTooltip(null);
  }, []);

  const toggleExplainMode = useCallback(() => {
    setExplainModeState((prev) => {
      if (!prev) setTooltip(null);
      return !prev;
    });
  }, []);

  const getHelpElement = useCallback((target: EventTarget | null): Element | null => {
    if (!target || !(target instanceof Element)) return null;
    return target.closest(`[${HELP_ATTR_TITLE}]`);
  }, []);

  const showForElement = useCallback((el: Element | null) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (!el) {
      setTooltip(null);
      return;
    }
    const title = el.getAttribute(HELP_ATTR_TITLE);
    const description = el.getAttribute(HELP_ATTR_DESC) || "";
    if (!title) {
      setTooltip(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setTooltip({
      title,
      description,
      x: rect.left,
      y: rect.bottom + 4,
      width: rect.width,
      height: rect.height,
    });
  }, []);

  useEffect(() => {
    if (!explainMode) return;

    const handleMouseOver = (e: MouseEvent) => {
      const el = getHelpElement(e.target);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (!el) {
        hoverTimeoutRef.current = setTimeout(() => setTooltip(null), 100);
        return;
      }
      hoverTimeoutRef.current = setTimeout(() => showForElement(el), 150);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      const el = getHelpElement(e.target);
      if (el && related && el.contains(related)) return;
      const tooltipEl = document.querySelector("[data-help-popover]");
      if (related && tooltipEl && tooltipEl.contains(related)) return;
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      hideTimeoutRef.current = setTimeout(() => setTooltip(null), 200);
    };

    const handleClick = (e: MouseEvent) => {
      const el = getHelpElement(e.target);
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        showForElement(el);
      }
    };

    document.addEventListener("mouseover", handleMouseOver, true);
    document.addEventListener("mouseout", handleMouseOut, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("mouseover", handleMouseOver, true);
      document.removeEventListener("mouseout", handleMouseOut, true);
      document.removeEventListener("click", handleClick, true);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, [explainMode, getHelpElement, showForElement]);

  const value: HelpExplainContextType = {
    explainMode,
    setExplainMode,
    toggleExplainMode,
  };

  return (
    <HelpExplainContext.Provider value={value}>
      {children}
      {explainMode &&
        createPortal(
          <>
            {/* Banner */}
            <div
              className="fixed top-14 left-0 right-0 z-[100] flex items-center justify-center gap-3 bg-primary text-primary-foreground px-4 py-2 shadow-md"
              role="status"
              aria-live="polite"
            >
              <span className="text-sm font-medium">
                Explain mode: hover or click any control to see what it does.
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setExplainMode(false)}
              >
                <X className="h-4 w-4 mr-1" />
                Exit explain mode
              </Button>
            </div>
            {/* Tooltip popover */}
            {tooltip && (
              <div
                data-help-popover
                className="fixed z-[101] max-w-sm rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
                style={{
                  left: Math.min(tooltip.x, window.innerWidth - 320),
                  top: tooltip.y,
                }}
              >
                <p className="font-semibold text-sm">{tooltip.title}</p>
                {tooltip.description && (
                  <p className="text-xs text-muted-foreground mt-1">{tooltip.description}</p>
                )}
              </div>
            )}
          </>,
          document.body
        )}
    </HelpExplainContext.Provider>
  );
}
