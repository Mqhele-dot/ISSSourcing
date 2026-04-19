import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { useToast } from "@/hooks/use-toast";
import { formatMutationError, queryClient, requestJson } from "@/lib/queryClient";
import type { AppSettings } from "@shared/schema";
import { APP_ROUTES } from "@/lib/routes/app-routes";
import { fetchReadinessStatus } from "@/app/app-readiness-banner";
import type { SetupStatusPayload } from "@/components/setup/product-onboarding-gate";
import { Link } from "wouter";

const STEPS = ["welcome", "business", "warehouse", "starter", "review"] as const;
type StepId = (typeof STEPS)[number];

const DATE_FORMAT_PRESETS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] as const;
const TIME_FORMAT_PRESETS = ["HH:mm", "hh:mm A"] as const;

async function fetchSetupStatus(): Promise<SetupStatusPayload> {
  return requestJson<SetupStatusPayload>("GET", "/api/setup/status");
}

export default function ProductSetupPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { settings } = useSettings();

  const { data: ready } = useQuery({
    queryKey: ["/api/ready"],
    queryFn: fetchReadinessStatus,
    staleTime: 15_000,
  });

  const { data: setup } = useQuery({
    queryKey: ["/api/setup/status"],
    queryFn: fetchSetupStatus,
  });

  const [step, setStep] = useState<StepId>("welcome");
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [currencyCode, setCurrencyCode] = useState(settings.currencyCode);
  const [businessCountryCode, setBusinessCountryCode] = useState(settings.businessCountryCode ?? "US");
  const [taxMode, setTaxMode] = useState<"none" | "vat" | "us_sales_tax">(
    (settings.taxMode as "none" | "vat" | "us_sales_tax") || "none",
  );
  const [warehouseName, setWarehouseName] = useState("Main warehouse");
  const [departmentCodes, setDepartmentCodes] = useState("OPS,PROC,FIN");
  const [paymentTermCode, setPaymentTermCode] = useState("NET30");
  const [paymentTermName, setPaymentTermName] = useState("Net 30");
  const [paymentTermNetDays, setPaymentTermNetDays] = useState("30");
  const [dateFormat, setDateFormat] = useState<(typeof DATE_FORMAT_PRESETS)[number]>(
    (settings.dateFormat as (typeof DATE_FORMAT_PRESETS)[number]) || "YYYY-MM-DD",
  );
  const [timeFormat, setTimeFormat] = useState<(typeof TIME_FORMAT_PRESETS)[number]>(
    (settings.timeFormat as (typeof TIME_FORMAT_PRESETS)[number]) || "HH:mm",
  );

  const hasSavedCheckpoint = Boolean(setup?.onboarding?.checkpoint);

  useEffect(() => {
    const cp = setup?.onboarding?.checkpoint as { step?: string; draft?: Record<string, unknown> } | null | undefined;
    if (cp?.draft && typeof cp.draft === "object") {
      const d = cp.draft;
      if (typeof d.companyName === "string") setCompanyName(d.companyName);
      if (typeof d.currencyCode === "string") setCurrencyCode(d.currencyCode);
      if (typeof d.businessCountryCode === "string") setBusinessCountryCode(d.businessCountryCode);
      if (d.taxMode === "none" || d.taxMode === "vat" || d.taxMode === "us_sales_tax") setTaxMode(d.taxMode);
      if (typeof d.warehouseName === "string") setWarehouseName(d.warehouseName);
      if (typeof d.departmentCodes === "string") setDepartmentCodes(d.departmentCodes);
      if (typeof d.paymentTermCode === "string") setPaymentTermCode(d.paymentTermCode);
      if (typeof d.paymentTermName === "string") setPaymentTermName(d.paymentTermName);
      if (typeof d.paymentTermNetDays === "string") setPaymentTermNetDays(d.paymentTermNetDays);
      if (typeof d.dateFormat === "string" && (DATE_FORMAT_PRESETS as readonly string[]).includes(d.dateFormat)) {
        setDateFormat(d.dateFormat as (typeof DATE_FORMAT_PRESETS)[number]);
      }
      if (typeof d.timeFormat === "string" && (TIME_FORMAT_PRESETS as readonly string[]).includes(d.timeFormat)) {
        setTimeFormat(d.timeFormat as (typeof TIME_FORMAT_PRESETS)[number]);
      }
    }
    if (cp?.step && STEPS.includes(cp.step as StepId)) {
      setStep(cp.step as StepId);
    }
  }, [setup?.onboarding?.checkpoint]);

  useEffect(() => {
    if (hasSavedCheckpoint) return;
    setCompanyName(settings.companyName);
    setCurrencyCode(settings.currencyCode);
    setBusinessCountryCode(settings.businessCountryCode ?? "US");
    const tm = settings.taxMode;
    if (tm === "none" || tm === "vat" || tm === "us_sales_tax") setTaxMode(tm);
    const df = settings.dateFormat;
    if (df && (DATE_FORMAT_PRESETS as readonly string[]).includes(df)) {
      setDateFormat(df as (typeof DATE_FORMAT_PRESETS)[number]);
    }
    const tf = settings.timeFormat;
    if (tf && (TIME_FORMAT_PRESETS as readonly string[]).includes(tf)) {
      setTimeFormat(tf as (typeof TIME_FORMAT_PRESETS)[number]);
    }
  }, [
    settings.companyName,
    settings.currencyCode,
    settings.businessCountryCode,
    settings.taxMode,
    settings.dateFormat,
    settings.timeFormat,
    hasSavedCheckpoint,
  ]);

  const checkpointMutation = useMutation({
    mutationFn: async (payload: { step: StepId; draft?: Record<string, unknown> }) => {
      return requestJson<AppSettings>("PUT", "/api/setup/product/checkpoint", payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const codes = departmentCodes
        .split(/[,\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      return requestJson<AppSettings>("POST", "/api/setup/product/complete", {
        companyName: companyName.trim(),
        currencyCode: currencyCode.trim().toUpperCase(),
        businessCountryCode: businessCountryCode.trim().toUpperCase(),
        taxMode,
        warehouseName: warehouseName.trim(),
        departmentCodes: codes.length ? codes : undefined,
        paymentTermCode: paymentTermCode.trim() || undefined,
        paymentTermName: paymentTermName.trim() || undefined,
        paymentTermNetDays: paymentTermNetDays ? Number(paymentTermNetDays) : undefined,
        dateFormat,
        timeFormat,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Setup complete", description: "Your workspace is ready." });
      setLocation(APP_ROUTES.home);
    },
    onError: (e: Error) => {
      toast({
        title: "Could not finish setup",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const persistStep = (next: StepId, draft?: Record<string, unknown>) => {
    setStep(next);
    if (user?.role === "admin") {
      checkpointMutation.mutate({
        step: next,
        draft: {
          companyName,
          currencyCode,
          businessCountryCode,
          taxMode,
          warehouseName,
          departmentCodes,
          paymentTermCode,
          paymentTermName,
          paymentTermNetDays,
          dateFormat,
          timeFormat,
          ...draft,
        },
      });
    }
  };

  if (!user) {
    return null;
  }

  if (ready?.productBootstrap?.needsFirstRunOnboarding) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <PageHeader
          title="Create your organization first"
          subtitle="Product setup runs after an organization exists"
          breadcrumb={<span>Setup</span>}
        />
        <Alert>
          <AlertTitle>No organization yet</AlertTitle>
          <AlertDescription>
            Use{" "}
            <Link href={APP_ROUTES.admin.onboarding} className="font-medium text-primary underline">
              organization bootstrap
            </Link>{" "}
            to create your company, then return here to finish currency, warehouse, and starter data.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <PageHeader
          title="Product setup in progress"
          subtitle="Administrator action required"
          breadcrumb={<span>Setup</span>}
        />
        <Alert>
          <AlertTitle>Waiting for an administrator</AlertTitle>
          <AlertDescription>
            An admin must sign in and complete the first-run wizard. You can review{" "}
            <Link href={APP_ROUTES.admin.systemDiagnostics} className="text-primary underline">
              system diagnostics
            </Link>{" "}
            if your IT team needs connection details.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const stepIndex = STEPS.indexOf(step);
  const checkpoint = setup?.onboarding?.checkpoint as
    | { step?: string; savedAt?: string; draft?: Record<string, unknown> }
    | null
    | undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      <PageHeader
        title="Welcome — let’s finish setup"
        subtitle="Company defaults, tax posture, warehouse, and starter reference data"
        breadcrumb={<span>Setup / Product</span>}
      />

      {setup?.onboarding?.required &&
      checkpoint != null &&
      typeof checkpoint === "object" &&
      (Boolean(checkpoint.step) || Boolean(checkpoint.draft)) ? (
        <Alert>
          <AlertTitle>Resume setup</AlertTitle>
          <AlertDescription className="text-sm">
            {checkpoint.step ? (
              <>
                You have saved progress at step <strong className="text-foreground">{checkpoint.step}</strong>
              </>
            ) : (
              <>You have saved wizard progress</>
            )}
            {checkpoint.savedAt ? (
              <>
                {" "}
                (last saved {new Date(checkpoint.savedAt).toLocaleString()})
              </>
            ) : null}
            . Use Next/Back to continue; each step saves automatically for admins.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={i <= stepIndex ? "font-semibold text-foreground" : ""}
          >{`${i + 1}. ${s}`}</span>
        ))}
      </div>

      {step === "welcome" && (
        <Card>
          <CardHeader>
            <CardTitle>Installable product setup</CardTitle>
            <CardDescription>
              This short wizard replaces hand-editing environment files for typical business defaults. You can resume
              later — progress is saved after each step. If you have not created your organization yet, complete{" "}
              <Link href={APP_ROUTES.admin.onboarding} className="font-medium text-primary underline">
                organization bootstrap
              </Link>{" "}
              first, then return here.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-end gap-2">
            <Button type="button" onClick={() => persistStep("business")}>
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "business" && (
        <Card>
          <CardHeader>
            <CardTitle>Company &amp; money</CardTitle>
            <CardDescription>Displayed name, reporting currency, country, and tax posture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="co">Company name</Label>
              <Input id="co" value={companyName} onChange={(e) => setCompanyName(e.target.value)} autoComplete="organization" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cc">Currency (ISO 4217)</Label>
                <Input
                  id="cc"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                  maxLength={3}
                  className="font-mono uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct">Country / region (ISO alpha-2)</Label>
                <Input
                  id="ct"
                  value={businessCountryCode}
                  onChange={(e) => setBusinessCountryCode(e.target.value.toUpperCase())}
                  maxLength={2}
                  className="font-mono uppercase"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Tax mode</Label>
              <Select value={taxMode} onValueChange={(v) => setTaxMode(v as typeof taxMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No VAT / generic</SelectItem>
                  <SelectItem value="vat">VAT (enable VAT fields in app)</SelectItem>
                  <SelectItem value="us_sales_tax">US sales tax style (VAT off)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Date format</Label>
                <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as (typeof DATE_FORMAT_PRESETS)[number])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FORMAT_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Time format</Label>
                <Select value={timeFormat} onValueChange={(v) => setTimeFormat(v as (typeof TIME_FORMAT_PRESETS)[number])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_FORMAT_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => persistStep("welcome")}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => persistStep("warehouse")}
                disabled={companyName.trim().length < 2 || currencyCode.length !== 3 || businessCountryCode.length !== 2}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "warehouse" && (
        <Card>
          <CardHeader>
            <CardTitle>Default warehouse</CardTitle>
            <CardDescription>Creates your primary stocking location and sets it as the default.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wh">Warehouse name</Label>
              <Input id="wh" value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} />
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => persistStep("business")}>
                Back
              </Button>
              <Button type="button" onClick={() => persistStep("starter")} disabled={!warehouseName.trim()}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "starter" && (
        <Card>
          <CardHeader>
            <CardTitle>Starter departments &amp; payment term</CardTitle>
            <CardDescription>Optional: comma-separated department codes and a default supplier payment term.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dept">Department codes</Label>
              <Input id="dept" value={departmentCodes} onChange={(e) => setDepartmentCodes(e.target.value)} placeholder="OPS,PROC,FIN" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="ptc">Payment term code</Label>
                <Input id="ptc" value={paymentTermCode} onChange={(e) => setPaymentTermCode(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="ptn">Payment term name</Label>
                <Input id="ptn" value={paymentTermName} onChange={(e) => setPaymentTermName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ptd">Net days</Label>
              <Input id="ptd" value={paymentTermNetDays} onChange={(e) => setPaymentTermNetDays(e.target.value)} />
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => persistStep("warehouse")}>
                Back
              </Button>
              <Button type="button" onClick={() => persistStep("review")}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "review" && (
        <Card>
          <CardHeader>
            <CardTitle>Review &amp; finish</CardTitle>
            <CardDescription>We will save org settings, create the warehouse, and seed starter rows.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                <span className="text-foreground">{companyName}</span> · {currencyCode} · {businessCountryCode} ·{" "}
                {taxMode} · dates {dateFormat} · times {timeFormat}
              </li>
              <li>Warehouse: {warehouseName}</li>
              <li>Departments: {departmentCodes || "(defaults)"}</li>
              <li>
                Payment term: {paymentTermCode} — {paymentTermName} ({paymentTermNetDays} days)
              </li>
              <li className="text-foreground">
                <strong>Starter approval rules</strong> (you can edit later under{" "}
                <Link href={APP_ROUTES.finance.approvalPolicies} className="text-primary underline">
                  Approval policies
                </Link>
                ): requisitions from $0–$5,000 require <span className="font-medium">manager</span> (or admin); purchase
                orders above $5,000 require <span className="font-medium">admin</span>.
              </li>
            </ul>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={() => persistStep("starter")}>
                Back
              </Button>
              <Button
                type="button"
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
              >
                {completeMutation.isPending ? "Saving…" : "Complete setup"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {checkpointMutation.isError ? (
        <p className="text-xs text-destructive">
          {formatMutationError("Save progress", "PUT", "/api/setup/product/checkpoint", checkpointMutation.error)}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Deployment mode: <span className="font-mono">{setup?.deploymentMode ?? "—"}</span>. Need to bypass during
        migration? Set <span className="font-mono">SKIP_PRODUCT_ONBOARDING=true</span> on the server.
      </p>
    </div>
  );
}
