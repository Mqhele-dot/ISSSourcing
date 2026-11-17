import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { TourPlacement } from "@/components/tutorial/tutorial-types";

type Props = {
  rect: DOMRect | null;
  placement: TourPlacement;
  title: string;
  description: string;
  stepIndex: number;
  stepCount: number;
  canGoBack: boolean;
  isLast: boolean;
  advanceHint?: string;
  onNext: () => void;
  onPrev: () => void;
  onDismiss: () => void;
};

const OVERLAY_Z = 200;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

type TooltipSize = { width: number; height: number };

export function getSpotlightTooltipPosition(
  rect: Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height"> | null,
  placement: TourPlacement,
  viewport: { width: number; height: number },
  tooltip: TooltipSize,
): { left: number; top: number; horizontalTransform: boolean } | null {
  const margin = 12;
  const width = Math.min(tooltip.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(tooltip.height, Math.max(0, viewport.height - margin * 2));
  if (!rect) return null;

  const centeredLeft = clamp(rect.left + rect.width / 2, margin + width / 2, viewport.width - width / 2 - margin);
  const clampTop = (top: number) => clamp(top, margin, Math.max(margin, viewport.height - height - margin));
  const fitsBelow = rect.bottom + margin + height <= viewport.height - margin;
  const fitsAbove = rect.top - margin - height >= margin;

  if (placement === "bottom" || placement === "top") {
    const preferBelow = placement === "bottom";
    const useBelow = preferBelow ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
    const desiredTop = useBelow ? rect.bottom + margin : rect.top - margin - height;
    return { left: centeredLeft, top: clampTop(desiredTop), horizontalTransform: true };
  }

  const centeredTop = clampTop(rect.top + rect.height / 2 - height / 2);
  const fitsLeft = rect.left - margin - width >= margin;
  const fitsRight = rect.right + margin + width <= viewport.width - margin;
  const preferLeft = placement === "left";
  const useLeft = preferLeft ? fitsLeft || !fitsRight : !fitsRight && fitsLeft;
  const desiredLeft = useLeft ? rect.left - margin - width : rect.right + margin;
  return {
    left: clamp(desiredLeft, margin, Math.max(margin, viewport.width - width - margin)),
    top: centeredTop,
    horizontalTransform: false,
  };
}

function tooltipStyle(rect: DOMRect | null, placement: TourPlacement, tooltipSize: TooltipSize): CSSProperties {
  const margin = 12;
  const width = Math.min(340, Math.max(0, (typeof window !== "undefined" ? window.innerWidth : 1200) - margin * 2));
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const base: CSSProperties = {
    position: "fixed",
    width,
    maxWidth: "calc(100vw - 24px)",
    maxHeight: "calc(100vh - 24px)",
    overflowY: "auto",
    zIndex: OVERLAY_Z + 2,
  };
  if (!rect) {
    return {
      ...base,
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
    };
  }
  const position = getSpotlightTooltipPosition(
    rect,
    placement,
    { width: vw, height: vh },
    { width, height: tooltipSize.height || 220 },
  );
  if (!position) return base;
  return {
    ...base,
    left: position.left,
    top: position.top,
    transform: position.horizontalTransform ? "translateX(-50%)" : undefined,
  };
}

/** Dim overlay with optional “hole” around the target; tooltip is interactive. */
export function SpotlightTourLayer({
  rect,
  placement,
  title,
  description,
  stepIndex,
  stepCount,
  canGoBack,
  isLast,
  advanceHint,
  onNext,
  onPrev,
  onDismiss,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [tooltipSize, setTooltipSize] = useState<TooltipSize>({ width: 340, height: 220 });
  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!mounted) return;
    const node = tooltipRef.current;
    if (!node) return;
    const update = () => {
      const next = { width: node.offsetWidth, height: node.offsetHeight };
      setTooltipSize((current) =>
        Math.abs(current.width - next.width) < 1 && Math.abs(current.height - next.height) < 1 ? current : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [mounted, title, description, stepIndex]);

  if (!mounted || typeof document === "undefined") return null;

  const bands = rect
    ? {
        top: { position: "absolute" as const, top: 0, left: 0, right: 0, height: rect.top },
        left: { position: "absolute" as const, top: rect.top, left: 0, width: rect.left, height: rect.height },
        right: {
          position: "absolute" as const,
          top: rect.top,
          left: rect.right,
          right: 0,
          height: rect.height,
        },
        bottom: { position: "absolute" as const, top: rect.bottom, left: 0, right: 0, bottom: 0 },
      }
    : null;

  const node = (
    <div className="pointer-events-none fixed inset-0" style={{ zIndex: OVERLAY_Z }} aria-hidden={false}>
      {bands ? (
        <>
          <div className="pointer-events-none bg-foreground/55 backdrop-blur-[1px]" style={bands.top} />
          <div className="pointer-events-none bg-foreground/55 backdrop-blur-[1px]" style={bands.left} />
          <div className="pointer-events-none bg-foreground/55 backdrop-blur-[1px]" style={bands.right} />
          <div className="pointer-events-none bg-foreground/55 backdrop-blur-[1px]" style={bands.bottom} />
          <div
            className="pointer-events-none absolute rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background"
            style={
              rect
                ? {
                    top: rect.top - 4,
                    left: rect.left - 4,
                    width: rect.width + 8,
                    height: rect.height + 8,
                  }
                : undefined
            }
          />
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-foreground/50 backdrop-blur-[1px]" />
      )}

      <Card
        ref={tooltipRef}
        className="pointer-events-auto shadow-xl border-primary/20"
        style={tooltipStyle(rect, placement, tooltipSize)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-spotlight-title"
      >
        <CardHeader className="pb-2">
          <CardTitle id="tutorial-spotlight-title" className="text-base leading-snug">
            {title}
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed whitespace-pre-wrap">{description}</CardDescription>
          {advanceHint ? (
            <p className="text-xs font-medium text-primary pt-1 border-t border-border/60 mt-2">{advanceHint}</p>
          ) : null}
        </CardHeader>
        <CardContent className="pb-2 pt-0">
          <div className="text-xs text-muted-foreground">
            Step {stepIndex + 1} of {stepCount}
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/30">
          <Button type="button" variant="ghost" size="sm" className="pointer-events-auto" onClick={onDismiss}>
            <X className="h-4 w-4 mr-1" />
            Skip
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto"
              onClick={onPrev}
              disabled={!canGoBack}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <Button type="button" size="sm" className="pointer-events-auto" onClick={onNext}>
              {isLast ? "Done" : "Next"}
              {!isLast ? <ChevronRight className="h-4 w-4 ml-1" /> : null}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  );

  return createPortal(node, document.body);
}
