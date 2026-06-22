import { createPortal } from "react-dom";
import { useLayoutEffect, useState, type CSSProperties } from "react";
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

function tooltipStyle(rect: DOMRect | null, placement: TourPlacement): CSSProperties {
  const margin = 12;
  const width = 340;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const base: CSSProperties = {
    position: "fixed",
    width,
    maxWidth: "calc(100vw - 24px)",
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
  if (placement === "bottom") {
    return {
      ...base,
      left: clamp(rect.left + rect.width / 2, margin + width / 2, vw - width / 2 - margin),
      top: rect.bottom + margin,
      transform: "translate(-50%, 0)",
    };
  }
  if (placement === "top") {
    return {
      ...base,
      left: clamp(rect.left + rect.width / 2, margin + width / 2, vw - width / 2 - margin),
      top: rect.top - margin,
      transform: "translate(-50%, -100%)",
    };
  }
  if (placement === "left") {
    return {
      ...base,
      left: clamp(rect.left - width - margin, margin, vw - width - margin),
      top: clamp(rect.top + rect.height / 2, margin + 80, vh - margin),
      transform: "translate(0, -50%)",
    };
  }
  return {
    ...base,
    left: clamp(rect.right + margin, margin, vw - width - margin),
    top: clamp(rect.top + rect.height / 2, margin + 80, vh - margin),
    transform: "translate(0, -50%)",
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
  useLayoutEffect(() => {
    setMounted(true);
  }, []);

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
        className="pointer-events-auto shadow-xl border-primary/20"
        style={tooltipStyle(rect, placement)}
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
