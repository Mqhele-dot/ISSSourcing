import { useMemo, useState } from "react";
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
import { getTrainingProgress } from "@/lib/training/training-progress";

export default function GetEducatedPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TrainingCategory | "all">("all");
  const progress = useMemo(() => getTrainingProgress(), [query, category]);

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
          const done = progress.markedUnderstood.includes(m.id);
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
