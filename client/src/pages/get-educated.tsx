import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/page-header";
import { BookOpenCheck, CheckCircle2, PlayCircle, Route } from "lucide-react";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import {
  getAllTrainingModules,
  getTrainingCategories,
  type TrainingCategory,
  type TrainingModule,
  searchTrainingModules,
} from "@/lib/training/training-content";
import { useTrainingProgress } from "@/hooks/use-training-progress";
import { useTutorial } from "@/contexts/tutorial-context";
import { GUIDED_LEARNING_TOPICS, getGuidedLearningTopic } from "@/lib/training/guided-learning";

export default function GetEducatedPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TrainingCategory | "all">("all");
  const [selectedTopicId, setSelectedTopicId] = useState(
    () => GUIDED_LEARNING_TOPICS.find((topic) => topic.route === APP_ROUTES.operations.controlTower)?.id ?? GUIDED_LEARNING_TOPICS[0]?.id ?? "",
  );
  const [tourMessage, setTourMessage] = useState("");
  const { startTutorial } = useTutorial();
  const { progress, isModuleUnderstood, refreshProgress, recordGuidedTopicStarted } = useTrainingProgress();

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
  const selectedTopic = getGuidedLearningTopic(selectedTopicId);
  const guidedSections = Array.from(new Set(GUIDED_LEARNING_TOPICS.map((topic) => topic.section)));
  const guidedProgressPercent = GUIDED_LEARNING_TOPICS.length
    ? Math.round((progress.guidedTopicsStarted.length / GUIDED_LEARNING_TOPICS.length) * 100)
    : 0;
  const lessonProgressPercent = getAllTrainingModules().length
    ? Math.round((progress.markedUnderstood.length / getAllTrainingModules().length) * 100)
    : 0;

  const startSelectedTour = () => {
    if (!selectedTopic) return;
    if (!startTutorial(selectedTopic.tourId)) {
      setTourMessage("The guided tour is still loading. Try again in a moment.");
      return;
    }
    recordGuidedTopicStarted(selectedTopic.id);
    setTourMessage(`Starting ${selectedTopic.title}. The tour will open that tab and highlight the live workspace.`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-testid="get-educated-page">
      <PageHeader
        title="Get Educated"
        subtitle="Choose any tab, learn why it exists, follow its working instructions, and launch a guided tour on the live page."
        breadcrumb={<span>Learning / Overview</span>}
      />

      <Card className="overflow-hidden border-primary/30" data-testid="guided-learning-launcher">
        <CardHeader className="bg-primary/5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Route className="h-5 w-5 text-primary" />
                Learn a tab with a guided tour
              </CardTitle>
              <CardDescription>
                Select what you want to learn. The walkthrough opens the real tab, highlights its workspace, and explains the purpose, workflow, and control checks.
              </CardDescription>
            </div>
            <Badge variant="secondary">{GUIDED_LEARNING_TOPICS.length} tab guides</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.5fr)]">
          <div className="space-y-2">
            <label htmlFor="guided-topic" className="text-sm font-medium">What would you like to learn?</label>
            <select
              id="guided-topic"
              data-testid="guided-topic-select"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={selectedTopicId}
              onChange={(event) => {
                setSelectedTopicId(event.target.value);
                setTourMessage("");
              }}
            >
              {guidedSections.map((section) => (
                <optgroup key={section} label={section}>
                  {GUIDED_LEARNING_TOPICS.filter((topic) => topic.section === section).map((topic) => (
                    <option key={topic.id} value={topic.id}>{topic.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Guided topics started in this browser: {progress.guidedTopicsStarted.length}
            </p>
            <Progress value={guidedProgressPercent} aria-label="Guided topic progress" />
            <p className="text-xs text-muted-foreground">{guidedProgressPercent}% of guided topics explored</p>
          </div>

          {selectedTopic ? (
            <div className="space-y-4" aria-live="polite" data-testid="guided-topic-preview">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{selectedTopic.title}</h2>
                  <Badge variant="outline">{selectedTopic.section}</Badge>
                  {progress.guidedTopicsStarted.includes(selectedTopic.id) ? (
                    <Badge variant="secondary" className="gap-1"><CheckCircle2 className="h-3 w-3" />Started</Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{selectedTopic.summary}</p>
              </div>
              <div className="rounded-lg border bg-muted/25 p-4 text-sm">
                <p><span className="font-medium">Why it matters: </span><span className="text-muted-foreground">{selectedTopic.whyItMatters}</span></p>
                <p className="mt-3 font-medium">How to use this tab</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                  {selectedTopic.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                </ol>
                <p className="mt-3"><span className="font-medium">Watch for: </span><span className="text-muted-foreground">{selectedTopic.watchFor}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={startSelectedTour} data-testid="guided-tour-start-button">
                  <PlayCircle className="mr-2 h-4 w-4" />Start guided tour
                </Button>
                {selectedTopic.moduleId ? (
                  <Button variant="outline" asChild>
                    <Link href={APP_ROUTES.training.getEducatedModule(selectedTopic.moduleId)}>
                      <BookOpenCheck className="mr-2 h-4 w-4" />Open full lesson
                    </Link>
                  </Button>
                ) : (
                  <Button variant="outline" asChild><Link href={selectedTopic.route}>Open tab without tour</Link></Button>
                )}
              </div>
              {tourMessage ? <p className="text-sm text-primary" role="status">{tourMessage}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-primary/25 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Suggested learning paths</CardTitle>
          <CardDescription>
            Paths follow a typical source-to-pay flow (plan -&gt; source -&gt; make -&gt; deliver -&gt; return), similar to
            SCOR / APICS vocabulary, so onboarding matches how work actually hands off between teams.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="space-y-2">
            <p className="font-medium text-foreground">Operations and stock integrity</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("control-tower")}
                >
                  Control Tower
                </Link>{" "}
                - priorities and risk signals
              </li>
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("inventory")}
                >
                  Inventory
                </Link>{" "}
                - on-hand truth
              </li>
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("warehouse-operations")}
                >
                  Warehouse operations
                </Link>{" "}
                - floor execution
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Procurement</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("requisitions")}
                >
                  Requisitions
                </Link>
              </li>
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("purchase-orders")}
                >
                  Purchase orders
                </Link>
              </li>
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("suppliers")}
                >
                  Suppliers
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Finance and insight</p>
            <ul className="list-disc space-y-1.5 pl-4 text-muted-foreground">
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("accounts-payable")}
                >
                  Accounts payable
                </Link>
              </li>
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("payments")}
                >
                  Payments
                </Link>
              </li>
              <li>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={APP_ROUTES.training.getEducatedModule("analytics")}
                >
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
            placeholder="Search modules, e.g. AP, invoice, PO, requisition, stock..."
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
        Progress (this browser): {progress.lessonsOpened.length} lesson(s) opened | {progress.markedUnderstood.length}{" "}
        marked "understood" | {progress.guidedTopicsStarted.length} guided topic(s) started | stored locally only.
      </p>
      <div className="grid gap-3 sm:grid-cols-3" data-testid="training-progress-summary">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Lessons opened</p><p className="text-2xl font-semibold">{progress.lessonsOpened.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Lessons understood</p><p className="text-2xl font-semibold">{progress.markedUnderstood.length}</p><Progress className="mt-2" value={lessonProgressPercent} aria-label="Written lesson progress" /></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Guided topics explored</p><p className="text-2xl font-semibold">{progress.guidedTopicsStarted.length}</p><Progress className="mt-2" value={guidedProgressPercent} aria-label="Guided tour progress" /></CardContent></Card>
      </div>

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
                <CardDescription>~{m.estimatedMinutes} min | {m.whoUsesIt}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto flex flex-1 flex-col gap-3 pt-0">
                <p className="text-sm text-muted-foreground">{m.beginnerSummary}</p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Why it matters: </span>
                  {m.workplacePurpose.slice(0, 200)}
                  {m.workplacePurpose.length > 200 ? "..." : ""}
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
        <p className="text-sm text-muted-foreground">No modules match that search. Try "PO", "AP", or "stock".</p>
      ) : null}
    </div>
  );
}
