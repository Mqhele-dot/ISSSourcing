import { useEffect, useState } from "react";
import { Link, Redirect, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { getTrainingModuleById } from "@/lib/training/training-content";
import { useTrainingProgress } from "@/hooks/use-training-progress";
import { useTutorial } from "@/contexts/tutorial-context";
import { getGuidedLearningTopicForRoute } from "@/lib/training/guided-learning";
import { AlertTriangle, CheckCircle2, PlayCircle } from "lucide-react";

export default function GetEducatedModulePage() {
  const [, params] = useRoute<{ moduleId: string }>("/get-educated/:moduleId");
  const moduleId = params?.moduleId ? decodeURIComponent(params.moduleId) : "";
  const mod = moduleId ? getTrainingModuleById(moduleId) : undefined;
  const { startTutorial } = useTutorial();
  const { recordLessonOpened, recordQuizCompleted, recordGuidedTopicStarted, toggleModuleUnderstood, progress, isModuleUnderstood } =
    useTrainingProgress();
  const [quizSelections, setQuizSelections] = useState<Record<number, string>>({});
  const [showQuizResult, setShowQuizResult] = useState<Record<number, "correct" | "wrong" | null>>({});

  useEffect(() => {
    if (!mod) return;
    recordLessonOpened(mod.id);
  }, [mod, recordLessonOpened]);

  const quizzes = mod?.quickQuiz ?? [];
  const understood = mod ? isModuleUnderstood(mod.id) : false;
  const guidedTopic = mod ? getGuidedLearningTopicForRoute(mod.route) : undefined;

  if (!moduleId) {
    return <Redirect to={APP_ROUTES.training.getEducated} />;
  }
  if (!mod) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <p className="text-sm text-muted-foreground">Lesson not found.</p>
        <Button asChild variant="outline">
          <Link href={APP_ROUTES.training.getEducated}>Back to Get Educated</Link>
        </Button>
      </div>
    );
  }

  const handleQuizPick = (index: number, optionIndex: number) => {
    const q = quizzes[index];
    if (!q) return;
    const chosen = q.options[optionIndex];
    if (chosen === undefined) return;
    const valueKey = String(optionIndex);
    setQuizSelections((s) => ({ ...s, [index]: valueKey }));
    const ok = chosen === q.answer;
    setShowQuizResult((r) => ({ ...r, [index]: ok ? "correct" : "wrong" }));
    if (ok) {
      recordQuizCompleted(mod.id, index);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-10" data-testid="training-lesson-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="training-lesson-title">
            {mod.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mod.category} | ~{mod.estimatedMinutes} minutes | {mod.whoUsesIt}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild data-testid="training-back-button">
            <Link href={APP_ROUTES.training.getEducated}>Back to Get Educated</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href={mod.route}>Go to this module</Link>
          </Button>
          {guidedTopic ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (startTutorial(guidedTopic.tourId)) recordGuidedTopicStarted(guidedTopic.id);
              }}
              data-testid="training-guided-tour-button"
            >
              <PlayCircle className="mr-2 h-4 w-4" />Tour this tab
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant={understood ? "default" : "secondary"}
            onClick={() => {
              toggleModuleUnderstood(mod.id);
            }}
          >
            {understood ? "Marked understood" : "Mark as understood"}
          </Button>
        </div>
      </div>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">What is this?</h2>
        <p className="text-muted-foreground">{mod.beginnerSummary}</p>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">Why is it necessary?</h2>
        <p className="text-muted-foreground">{mod.workplacePurpose}</p>
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">If this is ignored: </span>
          {mod.ifIgnored}
        </p>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">Who uses this?</h2>
        <p className="text-muted-foreground">{mod.whoUsesIt}</p>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">What decisions does it support?</h2>
        <p className="text-muted-foreground">{mod.decisionsSupported}</p>
      </section>

      {guidedTopic ? (
        <Card className="border-primary/25 bg-primary/5" data-testid="training-tab-instructions">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Instructions for the live tab</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 text-sm md:grid-cols-2">
            <div>
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-primary" />Working sequence</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
                {guidedTopic.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
              </ol>
            </div>
            <div>
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-amber-600" />Control check</p>
              <p className="mt-2 text-muted-foreground">{guidedTopic.watchFor}</p>
              <Button
                type="button"
                className="mt-4"
                onClick={() => {
                  if (startTutorial(guidedTopic.tourId)) recordGuidedTopicStarted(guidedTopic.id);
                }}
              >
                <PlayCircle className="mr-2 h-4 w-4" />Show me on the live tab
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">Key terms</h2>
        <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
          {mod.keyTerms.map((k) => (
            <li key={k.term}>
              <span className="font-medium text-foreground">{k.term}:</span> {k.simpleDefinition}
              {k.whyItMatters ? (
                <span className="mt-0.5 block text-xs">Why it matters: {k.whyItMatters}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 text-sm" data-testid="training-functions-section">
        <h2 className="text-lg font-medium">Main functions</h2>
        <div className="space-y-4">
          {mod.functions.map((f) => (
            <Card key={f.id}>
              <CardHeader className="py-3">
                <CardTitle className="text-base">{f.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">What it does: </span>
                  {f.whatItDoes}
                </p>
                <p>
                  <span className="font-medium text-foreground">Why it matters: </span>
                  {f.whyItMatters}
                </p>
                <p className="font-medium text-foreground">How to use:</p>
                <ol className="list-decimal space-y-1 pl-5">
                  {f.howToUse.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ol>
                {f.commonMistakes?.length ? (
                  <p>
                    <span className="font-medium text-foreground">Common mistakes: </span>
                    {f.commonMistakes.join(" ")}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">How to use this tab</h2>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
          {mod.workflowExample.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>

      {quizzes.length > 0 ? (
        <section className="space-y-4" data-testid="training-quiz-section">
          <h2 className="text-lg font-medium">Check your understanding</h2>
          {quizzes.map((q, idx) => (
            <Card key={idx}>
              <CardHeader className="py-3">
                <CardTitle className="text-base font-medium">{q.question}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <RadioGroup
                  value={quizSelections[idx] ?? ""}
                  onValueChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    if (!Number.isNaN(n)) handleQuizPick(idx, n);
                  }}
                  className="space-y-2"
                >
                  {q.options.map((opt, optIdx) => {
                    const optionId = `${mod.id}-q${idx}-option-${optIdx}`;
                    return (
                      <div key={optIdx} className="flex items-center space-x-2">
                        <RadioGroupItem value={String(optIdx)} id={optionId} />
                        <Label htmlFor={optionId} className="cursor-pointer font-normal">
                          {opt}
                        </Label>
                      </div>
                    );
                  })}
                </RadioGroup>
                {showQuizResult[idx] === "correct" ? (
                  <p className="text-sm text-green-700 dark:text-green-400">{q.explanation}</p>
                ) : null}
                {showQuizResult[idx] === "wrong" ? (
                  <p className="text-sm text-destructive">Not quite - review the lesson and try again.</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Local progress: {progress.lessonsOpened.length} lesson(s) opened | {progress.quizzesCompleted.length} quiz item(s) |{" "}
        {progress.markedUnderstood.length} understood | {progress.guidedTopicsStarted.length} guided topic(s) started.
      </p>

      <div className="flex flex-wrap gap-2 border-t pt-6">
        <Button variant="outline" asChild>
          <Link href={APP_ROUTES.training.getEducated}>Back to Get Educated</Link>
        </Button>
        <Button asChild>
          <Link href={mod.route}>Go to this module</Link>
        </Button>
      </div>
    </div>
  );
}
