import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, requestJson } from "@/lib/queryClient";

type ConfigDefinition = {
  key: string;
  label: string;
  type: "boolean" | "number" | "string" | "enum" | "json" | "duration" | "currency";
  category: string;
  minimumPlan: string;
  enabled: boolean;
  value: unknown;
  defaultValue: unknown;
  uiControl: "toggle" | "number" | "text" | "select" | "json" | "duration";
  options?: string[];
  invalidationMode: string;
  upgradeHint?: string;
};

type ConfigResponse = {
  definitions: ConfigDefinition[];
};

function displayValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? "");
}

export function CompanyConfigurationCenter() {
  const { toast } = useToast();
  const config = useQuery({
    queryKey: ["/api/company-configuration"],
    queryFn: () => requestJson<ConfigResponse>("GET", "/api/company-configuration"),
    throwOnError: false,
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ConfigDefinition[]>();
    for (const definition of config.data?.definitions ?? []) {
      map.set(definition.category, [...(map.get(definition.category) ?? []), definition]);
    }
    return Array.from(map.entries());
  }, [config.data]);

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      requestJson("PUT", `/api/company-configuration/${encodeURIComponent(key)}`, {
        scope: "organization",
        value,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/company-configuration"] });
      toast({ title: "Configuration updated", description: variables.key });
    },
    onError: (error) => {
      toast({
        title: "Configuration update failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  if (config.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Loading configuration registry...</CardContent>
      </Card>
    );
  }

  if (config.isError) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-sm text-destructive">Configuration center could not load.</p>
          <Button variant="outline" onClick={() => config.refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="company-configuration-center">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Settings2 className="h-5 w-5" />
            Company Configuration Center
          </CardTitle>
          <CardDescription>
            Typed, plan-aware controls for stock counts, approvals, inventory behavior, subscriptions, branding, notifications, integrations, and security.
          </CardDescription>
        </CardHeader>
      </Card>

      {grouped.map(([category, definitions]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle className="capitalize">{category}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {definitions.map((definition) => (
              <div key={definition.key} className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_280px] md:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Label className="text-base">{definition.label}</Label>
                    <Badge variant={definition.enabled ? "outline" : "secondary"}>{definition.minimumPlan}+</Badge>
                    <Badge variant="outline">{definition.invalidationMode}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{definition.key}</p>
                  {!definition.enabled && definition.upgradeHint ? (
                    <p className="mt-2 text-sm text-muted-foreground">{definition.upgradeHint}</p>
                  ) : null}
                </div>
                <div className="flex items-center justify-end gap-2">
                  {definition.uiControl === "toggle" ? (
                    <Switch
                      disabled={!definition.enabled || update.isPending}
                      checked={Boolean(definition.value)}
                      onCheckedChange={(checked) => update.mutate({ key: definition.key, value: checked })}
                    />
                  ) : definition.uiControl === "select" ? (
                    <Select
                      disabled={!definition.enabled || update.isPending}
                      value={String(definition.value ?? definition.defaultValue)}
                      onValueChange={(value) => update.mutate({ key: definition.key, value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(definition.options ?? []).map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      disabled={!definition.enabled || update.isPending}
                      type={definition.uiControl === "number" ? "number" : "text"}
                      defaultValue={String(displayValue(definition.value ?? definition.defaultValue))}
                      onBlur={(event) => {
                        const raw = event.currentTarget.value;
                        const value = definition.uiControl === "number" ? Number(raw) : raw;
                        update.mutate({ key: definition.key, value });
                      }}
                    />
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
