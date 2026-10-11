import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  Database,
  FileCheck2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useAppReadinessState } from "@/hooks/use-app-readiness-state";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { pathWithoutQuery } from "@/lib/path-utils";
import { requestJson } from "@/lib/queryClient";

type CoachStep = {
  id: string;
  title: string;
  description: string;
  route: string;
  action: string;
  icon: typeof Database;
  adminOnly?: boolean;
};

const VERSION = "v2";

const SETUP_STEPS: CoachStep[] = [
  {
    id: "company",
    title: "Add company details",
    description: "Confirm the business name and document details used throughout the app.",
    route: APP_ROUTES.admin.companySetup,
    action: "Open Company Setup",
    icon: Database,
    adminOnly: true,
  },
  {
    id: "warehouse",
    title: "Set a default warehouse",
    description: "Choose where incoming stock is received and counted by default.",
    route: APP_ROUTES.admin.masterDataSection("warehouses"),
    action: "Open Warehouses",
    icon: FileCheck2,
    adminOnly: true,
  },
  {
    id: "tax",
    title: "Confirm tax codes",
    description: "Review the active tax codes that purchasing documents can use.",
    route: APP_ROUTES.admin.masterDataSection("taxCodes"),
    action: "Open Tax Codes",
    icon: FileCheck2,
    adminOnly: true,
  },
  {
    id: "supplier",
    title: "Add suppliers",
    description: "Create supplier profiles with currency, terms, tax, incoterms, carrier, and AP defaults.",
    route: APP_ROUTES.procurement.suppliers,
    action: "Open Suppliers",
    icon: Users,
  },
  {
    id: "csv-import",
    title: "Try a CSV import (optional)",
    description: "Import a small, reviewed item file when you are ready; manual item entry is also available.",
    route: APP_ROUTES.admin.documentExtractorMode("import"),
    action: "Open Import",
    icon: FileCheck2,
    adminOnly: true,
  },
];

function storageKey(userId: number | string | undefined): string {
  return `invtrack:first-run-coach:${VERSION}:${userId ?? "anon"}`;
}

function userCanUseStep(role: string | null | undefined, step: CoachStep): boolean {
  if (!step.adminOnly) return true;
  return role === "admin";
}

function readDismissed(key: string): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(key) === "done";
}

function markDismissed(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, "done");
}

export function FirstRunOnboardingCoach() {
  const { user } = useAuth();
  const [path] = useLocation();
  const pathBase = pathWithoutQuery(path);
  const { phase, setup } = useAppReadinessState();
  const progressQuery = useQuery({
    queryKey: ["/api/onboarding/setup-progress", pathBase],
    queryFn: () => requestJson<{ steps: Array<{ id: string; complete: boolean; required: boolean }> }>("GET", "/api/onboarding/setup-progress"),
    enabled: Boolean(user),
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const key = storageKey(user?.id);
  const availableSteps = SETUP_STEPS;
  const activeStep = availableSteps[Math.min(activeIndex, availableSteps.length - 1)];
  const completed = progressQuery.data?.steps.filter((step) => step.complete).length ?? 0;
  const progress = (completed / SETUP_STEPS.length) * 100;

  useEffect(() => {
    if (!user || readDismissed(key)) return;
    if (pathBase === APP_ROUTES.auth || pathBase === APP_ROUTES.admin.onboarding) return;
    if (phase === "pending" || phase === "setup_check_temporarily_failed") return;
    if (setup?.onboarding.required && pathBase !== APP_ROUTES.setup.product) return;
    if (!progressQuery.data || progressQuery.data.steps.every((step) => step.complete)) return;

    const timer = window.setTimeout(() => setOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [key, pathBase, phase, setup?.onboarding.required, user, progressQuery.data]);

  if (!user || availableSteps.length === 0 || !activeStep) return null;

  const Icon = activeStep.icon;

  const closeForNow = () => {
    markDismissed(key);
    setOpen(false);
  };

  const goNext = () => {
    if (activeIndex >= availableSteps.length - 1) {
      closeForNow();
      return;
    }
    setActiveIndex((value) => Math.min(value + 1, availableSteps.length - 1));
  };

  const goBack = () => {
    setActiveIndex((value) => Math.max(value - 1, 0));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeForNow())}>
      <DialogContent className="max-h-[92svh] max-w-3xl overflow-y-auto p-0">
        <div className="grid min-h-[520px] md:grid-cols-[240px_1fr]">
          <aside className="border-b bg-muted/40 p-5 md:border-b-0 md:border-r">
            <div className="space-y-2">
              <Badge variant="secondary">First setup guide</Badge>
              <h2 className="text-xl font-semibold leading-tight">Get ISSSourcing ready</h2>
              <p className="text-sm text-muted-foreground">
                These checks reflect your saved company data, even when another administrator completes a step.
              </p>
            </div>
            <div className="mt-5 space-y-2">
              {availableSteps.map((step, index) => {
                const StepIcon = step.icon;
                const selected = index === activeIndex;
                const done = progressQuery.data?.steps.some((entry) => entry.id === step.id && entry.complete) ?? false;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${
                      selected
                        ? "border-primary bg-background shadow-sm"
                        : "border-transparent hover:border-border hover:bg-background/70"
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    ) : (
                      <StepIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={selected ? "font-medium text-foreground" : "text-muted-foreground"}>
                      {step.title}{done ? " — done" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="flex min-w-0 flex-col p-6">
            <DialogHeader className="space-y-3 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <DialogTitle className="leading-tight">{activeStep.title}</DialogTitle>
                    <DialogDescription className="mt-1">{activeStep.description}</DialogDescription>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={closeForNow}>
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close guide</span>
                </Button>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    Step {activeIndex + 1} of {availableSteps.length}
                  </span>
                  <span>{completed} of {SETUP_STEPS.length} complete</span>
                </div>
                <Progress value={progress} />
              </div>
            </DialogHeader>

            <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="font-medium">What to do</p>
                <p className="mt-1 text-muted-foreground">Open the linked workspace and complete the basics before moving on.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">Why it matters</p>
                <p className="mt-1 text-muted-foreground">This keeps supplier, stock, AP, logistics, and reports in sync.</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="font-medium">When to return</p>
                <p className="mt-1 text-muted-foreground">Use the side navigation to revisit each setup area whenever the business changes.</p>
              </div>
            </div>

            <div className="mt-6 rounded-md border bg-muted/30 p-4 text-sm">
              <p className="font-medium">Recommended order</p>
              <p className="mt-1 text-muted-foreground">
                Company details, default warehouse, tax codes, then your first supplier. CSV import is optional.
              </p>
            </div>

            <DialogFooter className="mt-auto gap-2 pt-6 sm:justify-between sm:space-x-0">
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={goBack} disabled={activeIndex === 0}>
                  Back
                </Button>
                <Button type="button" variant="outline" onClick={goNext}>
                  {activeIndex >= availableSteps.length - 1 ? "Finish" : "Next"}
                </Button>
              </div>
              {userCanUseStep(user.role, activeStep) ? (
                <Button type="button" asChild onClick={closeForNow}>
                  <Link href={activeStep.route}>
                    {activeStep.action}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : <p className="self-center text-sm text-muted-foreground">An administrator completes this step.</p>}
            </DialogFooter>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
