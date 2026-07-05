# ISSSourcing tutorial / training — implementation audit (internal)

## 1. Existing tutorial files / components

| Location | Role |
|----------|------|
| `client/src/contexts/tutorial-context.tsx` | `TutorialProvider`: registers tours, spotlight/dialog steps, `startTutorial`, diagnostics scan hooks |
| `client/src/components/tutorial/tutorial-steps.tsx` | Registers all tour IDs (`main`, `dashboard`, `inventory`, `analytics`, `full-app`, page-specific, etc.) on mount |
| `client/src/components/tutorial/tutorial-page-tours-data.ts` | `FULL_APP_TOUR_STEPS`, `PAGE_TOUR_DEFINITIONS` (spotlight selectors + copy) |
| `client/src/components/tutorial/tutorial-route-map.ts` | Path → suggested page tour (`getPageTourForPath`), `TOUR_START_ROUTES` |
| `client/src/components/tutorial/tutorial-types.ts` | `TutorialStep`, selector/placement helpers |
| `client/src/components/tutorial/spotlight-tour-layer.tsx` | Spotlight UI |
| `client/src/components/tutorial/tutorial-button.tsx` | Header **Help** dialog: tutorials, diagnostics, learning tab |
| `client/src/components/ui/tutorial-button.tsx` | Per-page **Tutorial** button (`TutorialStep`) |
| `client/src/components/tutorial/tutorial-page-hint.tsx` | Page hints (if mounted) |
| `client/src/contexts/help-explain-context.tsx` | “Explain mode” for controls |

**Related (not product tours):**

- `client/src/components/setup/product-onboarding-gate.tsx` — first-run org/product setup gating
- `client/src/pages/product-setup-page.tsx`, `onboarding-page.tsx` — setup wizards
- `data-tour="..."` attributes — anchors for spotlight/E2E across inventory, control tower, POs, exceptions, etc.
- `client/src/pages/home.tsx` — **Start Tutorial** (`full-app` prep + tour), **Run Demo Walkthrough** (API reset + checklist)

## 2. Current behavior

- **Help (header)** opens a dialog: page-suggested spotlight tour, grid of named tours, diagnostics, “Learning Center” tab with wizard/platform buttons.
- **Tutorial (per-page)** (`TutorialStep`): maps a `page` string to `startTutorial(page)` with navigation fallbacks.
- **Start Tutorial (home)**: `startTutorialPrep()` then `startTutorial("full-app")` spotlight chain.
- **Demo walkthrough**: destructive DB reset via API; redirects to auth; checklist in sessionStorage.
- **Product onboarding gate**: redirects incomplete installs to setup; separate from feature tours.

## 3. What we reuse

- `TutorialProvider` / `startTutorial` / spotlight pipeline — keep for “deep” click-through tours from Help.
- `tutorial-page-tours-data.ts` + `tutorial-steps.tsx` registration — keep; copy improved over time.
- `data-tour` anchors — unchanged.
- `help-explain-context` — unchanged.
- Product onboarding / setup pages — unchanged.

## 4. What we replace (behaviorally, not deleted)

- **Primary “Start Tutorial” on Control Tower (home)** — now opens the **contextual training panel** for this view (educational copy); users can still start spotlight tours from **Help → Tour …** or **Spotlight: operations walkthrough**.

## 5. What we rename / redirect into the new system

- **“Learning Center”** tab in Help dialog — supplemented by nav **Get Educated** (`/get-educated`) as the primary course catalog.
- **Per-page Tutorial button** — opens **training panel** when a `trainingModuleId` mapping exists; otherwise keeps `startTutorial` fallback.
- No file renames required for legacy tutorials; new content lives under `client/src/lib/training/` and `client/src/components/training/`.
