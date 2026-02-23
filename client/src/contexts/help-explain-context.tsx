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

const HOVER_SHOW_MS = 120;
const HOVER_HIDE_MS = 280;
const POPOVER_OFFSET = 6;
const POPOVER_MAX_WIDTH = 320;
const POPOVER_EST_HEIGHT = 80;

export function HelpExplainProvider({ children }: HelpExplainProviderProps) {
  const [explainMode, setExplainModeState] = useState(false);
  const [tooltip, setTooltip] = useState<{ title: string; description: string; x: number; y: number; width: number; height: number; above?: boolean } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinnedElementRef = useRef<Element | null>(null);

  const setExplainMode = useCallback((on: boolean) => {
    setExplainModeState(on);
    if (!on) {
      setTooltip(null);
      pinnedElementRef.current = null;
    }
  }, []);

  const toggleExplainMode = useCallback(() => {
    setExplainModeState((prev) => {
      if (!prev) setTooltip(null);
      pinnedElementRef.current = null;
      return !prev;
    });
  }, []);

  const getHelpElement = useCallback((target: EventTarget | null): Element | null => {
    if (!target || !(target instanceof Element)) return null;
    return target.closest(`[${HELP_ATTR_TITLE}]`);
  }, []);

  const showForElement = useCallback((el: Element | null, pinned: boolean = false) => {
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
      pinnedElementRef.current = null;
      return;
    }
    const title = el.getAttribute(HELP_ATTR_TITLE);
    const description = el.getAttribute(HELP_ATTR_DESC) || "";
    if (!title) {
      setTooltip(null);
      pinnedElementRef.current = null;
      return;
    }
    pinnedElementRef.current = pinned ? el : null;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < POPOVER_EST_HEIGHT + POPOVER_OFFSET;
    setTooltip({
      title,
      description,
      x: rect.left,
      y: above ? rect.top - POPOVER_OFFSET : rect.bottom + POPOVER_OFFSET,
      width: rect.width,
      height: rect.height,
      above,
    });
  }, []);

  useEffect(() => {
    if (!explainMode) return;

    const handleMouseOver = (e: MouseEvent) => {
      const el = getHelpElement(e.target);
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (!el) {
        hoverTimeoutRef.current = setTimeout(() => {
          if (!pinnedElementRef.current) setTooltip(null);
        }, HOVER_HIDE_MS);
        return;
      }
      hoverTimeoutRef.current = setTimeout(() => showForElement(el, false), HOVER_SHOW_MS);
    };

    const handleMouseOut = (e: MouseEvent) => {
      if (pinnedElementRef.current) return;
      const related = e.relatedTarget as Node | null;
      const el = getHelpElement(e.target);
      if (el && related && el.contains(related)) return;
      const tooltipEl = document.querySelector("[data-help-popover]");
      if (related && tooltipEl && tooltipEl.contains(related)) return;
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      hideTimeoutRef.current = setTimeout(() => setTooltip(null), HOVER_HIDE_MS);
    };

    const handleClick = (e: MouseEvent) => {
      const el = getHelpElement(e.target);
      const popoverEl = document.querySelector("[data-help-popover]");
      const clickedInPopover = popoverEl && (e.target instanceof Node && popoverEl.contains(e.target));
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        showForElement(el, true);
        return;
      }
      if (pinnedElementRef.current && !clickedInPopover) {
        pinnedElementRef.current = null;
        setTooltip(null);
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
                  left: Math.max(8, Math.min(tooltip.x, window.innerWidth - POPOVER_MAX_WIDTH - 8)),
                  top: tooltip.above ? undefined : tooltip.y,
                  bottom: tooltip.above ? window.innerHeight - tooltip.y : undefined,
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
