import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, FileImage, FileText, Save, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, requestJson } from "@/lib/queryClient";

type CompanyProfile = {
  displayName: string;
  legalName: string;
  registrationNumber: string | null;
  taxNumber: string | null;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  logoUrl: string | null;
  reportFooter: string | null;
  countryCode: string;
  locale: string;
  timezone: string;
  reportingCurrencyCode: string;
};

type CompanyProfileResponse = { profile: CompanyProfile; complete: boolean; missingFields: string[] };

const emptyProfile: CompanyProfile = {
  displayName: "",
  legalName: "",
  registrationNumber: "",
  taxNumber: "",
  address: "",
  contactEmail: "",
  contactPhone: "",
  website: "",
  logoUrl: "",
  reportFooter: "",
  countryCode: "ZA",
  locale: "en-ZA",
  timezone: "Africa/Johannesburg",
  reportingCurrencyCode: "ZAR",
};

export default function CompanySetupPage() {
  const { toast } = useToast();
  const [form, setForm] = useState<CompanyProfile>(emptyProfile);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const profileQuery = useQuery({
    queryKey: ["/api/organization/company-profile"],
    queryFn: () => requestJson<CompanyProfileResponse>("GET", "/api/organization/company-profile"),
  });

  useEffect(() => {
    if (profileQuery.data?.profile) setForm(profileQuery.data.profile);
  }, [profileQuery.data]);

  useEffect(() => () => {
    if (logoPreviewUrl?.startsWith("blob:")) URL.revokeObjectURL(logoPreviewUrl);
  }, [logoPreviewUrl]);

  const setField = (field: keyof CompanyProfile, value: string) =>
    setForm((current) => ({ ...current, [field]: value }));

  const selectLogo = (file: File | null) => {
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
    if (file && (!allowedTypes.has(file.type) || file.size > 5 * 1024 * 1024)) {
      setLogoFile(null);
      setLogoPreviewUrl(null);
      toast({
        title: "Logo not selected",
        description: file.size > 5 * 1024 * 1024
          ? "Choose an image that is 5 MB or smaller."
          : "Choose a PNG, JPEG, WebP, or SVG image.",
        variant: "destructive",
      });
      return;
    }
    setLogoFile(file);
    setLogoPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const saveMutation = useMutation({
    mutationFn: () => requestJson("PUT", "/api/organization/company-profile", form),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/organization/company-profile"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/organization/settings"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/user"] }),
      ]);
      toast({ title: "Company profile saved", description: "Newly generated documents will use this company identity." });
    },
    onError: (error: Error) => toast({ title: "Company profile was not saved", description: error.message, variant: "destructive" }),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("logo", file);
      const response = await apiRequest("POST", "/api/organization/company-logo", body);
      const payload = await response.json() as { data?: { logoUrl?: string } };
      if (!payload.data?.logoUrl) throw new Error("The server did not return a logo path.");
      return payload.data.logoUrl;
    },
    onSuccess: (logoUrl) => {
      setField("logoUrl", logoUrl);
      setLogoFile(null);
      toast({ title: "Logo uploaded", description: "Save the company profile to apply it to future documents." });
    },
    onError: (error: Error) => toast({ title: "Logo upload failed", description: error.message, variant: "destructive" }),
  });

  const requiredReady = form.displayName.trim().length >= 2 && form.legalName.trim().length >= 2 && form.countryCode.trim().length === 2;
  const documentIdentity = [
    form.legalName,
    form.registrationNumber ? `Registration ${form.registrationNumber}` : "",
    form.taxNumber ? `Tax ${form.taxNumber}` : "",
    form.address,
    form.contactEmail,
    form.contactPhone,
    form.website,
    form.reportFooter,
  ].filter(Boolean).join(" | ");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6" data-testid="company-setup-page">
      <PageHeader
        title="Company setup"
        subtitle="Manage the legal identity and branding printed on generated documents"
        breadcrumb={<span>Admin / Company setup</span>}
        icon={<Building2 className="h-6 w-6 text-primary" />}
        actions={<Button onClick={() => saveMutation.mutate()} disabled={!requiredReady || profileQuery.isLoading || saveMutation.isPending}><Save className="mr-2 h-4 w-4" />{saveMutation.isPending ? "Saving…" : "Save company profile"}</Button>}
      />

      {profileQuery.isError ? (
        <Alert variant="destructive"><AlertTitle>Company profile unavailable</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{profileQuery.error.message}</span><Button variant="outline" size="sm" onClick={() => void profileQuery.refetch()}>Retry</Button></AlertDescription></Alert>
      ) : null}
      {profileQuery.data && !profileQuery.data.complete ? (
        <Alert><AlertTitle>Complete the document identity</AlertTitle><AlertDescription>Recommended missing fields: {profileQuery.data.missingFields.join(", ")}. Documents can still be generated, but completing these fields improves legal and supplier-facing output.</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card>
          <CardHeader><CardTitle>Business identity</CardTitle><CardDescription>This is tenant-owned data. It does not change historical document snapshots.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="company-display-name">Trading/display name *</Label><Input id="company-display-name" value={form.displayName} onChange={(e) => setField("displayName", e.target.value)} autoComplete="organization" /></div>
            <div className="space-y-2"><Label htmlFor="company-legal-name">Registered legal name *</Label><Input id="company-legal-name" value={form.legalName} onChange={(e) => setField("legalName", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="company-registration">Registration number</Label><Input id="company-registration" value={form.registrationNumber ?? ""} onChange={(e) => setField("registrationNumber", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="company-tax">Tax/VAT number</Label><Input id="company-tax" value={form.taxNumber ?? ""} onChange={(e) => setField("taxNumber", e.target.value)} /></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="company-address">Registered or principal address</Label><Textarea id="company-address" value={form.address ?? ""} onChange={(e) => setField("address", e.target.value)} rows={3} /></div>
            <div className="space-y-2"><Label htmlFor="company-email">Company email</Label><Input id="company-email" type="email" value={form.contactEmail ?? ""} onChange={(e) => setField("contactEmail", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="company-phone">Company phone</Label><Input id="company-phone" value={form.contactPhone ?? ""} onChange={(e) => setField("contactPhone", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="company-website">Website</Label><Input id="company-website" type="url" placeholder="https://example.com" value={form.website ?? ""} onChange={(e) => setField("website", e.target.value)} /></div>
            <div className="space-y-3 sm:col-span-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <FileImage className="h-4 w-4 text-primary" />
                <Label htmlFor="company-logo-file">Company logo</Label>
              </div>
              <Input
                id="company-logo-file"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                aria-describedby="company-logo-help"
                onChange={(event) => selectLogo(event.target.files?.[0] ?? null)}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!logoFile || uploadLogoMutation.isPending}
                  onClick={() => logoFile && uploadLogoMutation.mutate(logoFile)}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {uploadLogoMutation.isPending ? "Uploading…" : "Upload selected logo"}
                </Button>
                <span id="company-logo-help" className="text-xs text-muted-foreground">
                  PNG, JPEG, WebP, or SVG; maximum 5 MB.
                </span>
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">Use an externally hosted logo URL</summary>
                <div className="mt-2">
                  <Label className="sr-only" htmlFor="company-logo">Logo URL</Label>
                  <Input
                    id="company-logo"
                    value={form.logoUrl ?? ""}
                    onChange={(event) => {
                      setField("logoUrl", event.target.value);
                      setLogoPreviewUrl(null);
                    }}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
              </details>
            </div>
            <div className="space-y-2"><Label htmlFor="company-country">Country code</Label><Input id="company-country" maxLength={2} value={form.countryCode} onChange={(e) => setField("countryCode", e.target.value.toUpperCase())} /></div>
            <div className="space-y-2"><Label htmlFor="company-timezone">Timezone</Label><Input id="company-timezone" value={form.timezone} onChange={(e) => setField("timezone", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="company-locale">Locale</Label><Input id="company-locale" value={form.locale} onChange={(e) => setField("locale", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="company-currency">Reporting currency</Label><Input id="company-currency" value={form.reportingCurrencyCode} readOnly aria-describedby="company-currency-help" /><p id="company-currency-help" className="text-xs text-muted-foreground">Change reporting currency in Settings after configuring it in Master Data.</p></div>
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="company-footer">Additional document footer</Label><Textarea id="company-footer" value={form.reportFooter ?? ""} onChange={(e) => setField("reportFooter", e.target.value)} placeholder="Banking, compliance, or legal notice" /></div>
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Document preview</CardTitle><CardDescription>Identity block used on newly generated reports, vouchers, remittances, and delivery notes.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {logoPreviewUrl || form.logoUrl ? (
              <img
                src={logoPreviewUrl ?? (form.logoUrl?.startsWith("/uploads/company-logos/") ? "/api/organization/company-logo" : form.logoUrl ?? "")}
                alt={`${form.displayName || "Company"} logo preview`}
                className="max-h-24 max-w-full rounded object-contain object-left"
              />
            ) : (
              <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                No logo configured
              </div>
            )}
            <div><p className="text-xl font-semibold">{form.displayName || "Company name"}</p><p className="text-sm text-muted-foreground">{form.legalName || "Registered legal name"}</p></div>
            <div className="rounded-md border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground break-words">{documentIdentity || "Complete company information to preview the document footer."}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
