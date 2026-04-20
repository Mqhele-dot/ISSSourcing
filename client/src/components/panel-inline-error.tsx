import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  description: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

/** Local panel/query failure — does not replace the whole page shell. */
export function PanelInlineError({ title, description, onRetry, retryLabel = "Retry", className }: Props) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="mt-2 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
        <span>{description}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => void onRetry()}>
            {retryLabel}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
