export type TourPlacement = "top" | "bottom" | "left" | "right";

export type TutorialPresentation = "modal" | "spotlight" | "auto";

export interface TutorialStep {
  id: string;
  title: string;
  text: string;
  /** CSS selector — scroll target (legacy) and/or spotlight target when attachTo omitted */
  targetSelector?: string;
  attachTo?: {
    element: string;
    on: TourPlacement;
  };
  /**
   * modal — centered dialog only.
   * spotlight — dim overlay + tooltip (centered if target missing).
   * auto — spotlight when a target selector resolves, otherwise modal.
   */
  presentation?: TutorialPresentation;
  /** Navigate to this path before showing the step (wouter pathname, no query). */
  route?: string;
  /** When true, current path must equal `route` (not a detail URL under it). */
  routeExact?: boolean;
  /** Extra delay after navigation or step change before measuring targets (ms). */
  settleMs?: number;
  /** On a successful target click (e.g. table row), advance to the next step. */
  advanceOnTargetClick?: boolean;
}

export function getStepTargetSelector(step: TutorialStep | undefined): string | undefined {
  if (!step) return undefined;
  const a = step.targetSelector?.trim();
  if (a) return a;
  return step.attachTo?.element?.trim();
}

export function getStepPlacement(step: TutorialStep | undefined): TourPlacement {
  const on = step?.attachTo?.on;
  if (on === "top" || on === "left" || on === "right") return on;
  return "bottom";
}

export function shouldUseSpotlightShell(step: TutorialStep | undefined): boolean {
  if (!step) return false;
  const pres = step.presentation ?? "auto";
  if (pres === "modal") return false;
  if (pres === "spotlight") return true;
  return Boolean(getStepTargetSelector(step));
}
