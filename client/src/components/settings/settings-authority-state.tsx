import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsAuthorityState(props: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Card role="status" aria-live="polite">
      <CardHeader><CardTitle>{props.loading ? "Loading settings" : "Settings unavailable"}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>{props.loading ? "Loading authoritative organization settings…" : "Editing is disabled because organization settings could not be loaded. No fallback values will be used."}</p>
        {!props.loading ? <Button type="button" variant="outline" onClick={props.onRetry}>Retry</Button> : null}
      </CardContent>
    </Card>
  );
}
