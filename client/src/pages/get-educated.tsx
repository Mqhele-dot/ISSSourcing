import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import {
  getAllTrainingModules,
  getTrainingCategories,
  type TrainingCategory,
  type TrainingModule,
  searchTrainingModules,
} from "@/lib/training/training-content";
import { useTrainingProgress } from "@/hooks/use-training-progress";

export default function GetEducatedPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TrainingCategory | "all">("all");
  const { progress, isModuleUnderstood, refreshProgress } = useTrainingProgress();

  useEffect(() => {
    refreshProgress();
  }, [refreshProgress]);

  const modules = useMemo(() => {
    let list: TrainingModule[] = query.trim() ? searchTrainingModules(query) : getAllTrainingModules();
    if (category !== "all") {
      list = list.filter((m) => m.category === category);
    }
    return list;
  }, [query, category]);

  const categories = getTrainingCategories();

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="get-educated-page">
      <PageHeader
        title="Get Educated"
        subtitle="Short lessons for InvTrack—written for newcomers, junior staff, and anyone new to procurement and supply chain."
        breadcrumb={<span>Learning / Overview</span>}
      />

      <Card className="border-primary/25 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Suggested learning paths</CardTitle>
          <CardDescription>
            Paths follow a typical source-to-pay flow (plan → source → make → deliver → return), similar to SCOR /
            APICS vocabulary—so onboarding matches how work actually hands off between teams.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="space-y-2">
            <p className="font-medium text-foreground">Operations and stock integrity</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("control-tower")}>
                  Control Tower
                </Link> — priorities and risk signals
              </li>
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("inventory")}>
                  Inventory
                </Link> — on-hand truth
              </li>
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("warehouse-operations")}>
                  Warehouse operations
                </Link> — floor execution
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Procurement</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("requisitions")}>
                  Requisitions
                </Link>
              </li>
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("purchase-orders")}>
                  Purchase orders
                </Link>
              </li>
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("suppliers")}>
                  Suppliers
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Finance and insight</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("accounts-payable")}>
                  Accounts payable
                </Link>
              </li>
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("payments")}>
                  Payments
                </Link>
              </li>
              <li>
                <Link className="text-primary underline-offset-4 hover:underline" href={APP_ROUTES.training.getEducatedModule("analytics")}>
                  Analytics
                </Link>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Input
            aria-label="Search training modules"
            data-testid="training-search-input"
            placeholder="Search modules, e.g. AP, invoice, PO, requisition, stock…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pr-3"
          />
        </div>
        <div className="flex flex-wrap gap-2" data-testid="training-category-filter">
          <Button
            type="button"
            size="sm"
            variant={category === "all" ? "default" : "outline"}
            onClick={() => setCategory("all")}
          >
            All
          </Button>
          {categories.map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={category === c ? "default" : "outline"}
              onClick={() => setCategory(c)}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Progress (this browser): {progress.lessonsOpened.length} lesson(s) opened · {progress.markedUnderstood.length}{" "}
        marked “understood” · stored locally only.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {modules.map((m) => {
          const done = isModuleUnderstood(m.id);
          return (
            <Card key={m.id} className="flex flex-col" data-testid="training-module-card">
              <CardHeader className="space-y-1 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{m.title}</CardTitle>
                  <Badge variant="secondary" className="text-xs font-normal">
                    {m.category}
                  </Badge>
                  {done ? (
                    <Badge variant="default" className="text-xs">
                      Understood
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>
                  ~{m.estimatedMinutes} min · {m.whoUsesIt}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex flex-1 flex-col gap-3 pt-0">
                <p className="text-sm text-muted-foreground">{m.beginnerSummary}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Why it matters: </span>
                  {m.workplacePurpose.slice(0, 200)}
                  {m.workplacePurpose.length > 200 ? "…" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" asChild data-testid="training-start-button">
                    <Link href={APP_ROUTES.training.getEducatedModule(m.id)}>Open lesson</Link>
                  </Button>
                  <Button size="sm" variant="outline" asChild data-testid="training-go-to-module-button">
                    <Link href={m.route}>Go to module</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {modules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No modules match that search. Try “PO”, “AP”, or “stock”.</p>
      ) : null}
    </div>
  );
}
