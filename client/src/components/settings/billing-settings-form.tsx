import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  CreditCard,
  FileText,
  Save,
  AlertTriangle,
  ArrowRight,
  Globe,
  Wallet,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";

const billingSettingsSchema = z.object({
  paymentProcessorEnabled: z.boolean().default(false),
  paymentProcessor: z.string().optional(),
  invoicePrefix: z.string().max(5).optional(),
  invoiceNumberFormat: z.string().optional(),
  defaultDueDays: z.number().int().min(0).max(90).default(30),
  defaultTerms: z.string().optional(),
  defaultNotes: z.string().optional(),
  companyInfo: z.string().optional(),
  allowedPaymentMethods: z.array(z.string()).default(["CASH", "CREDIT_CARD", "BANK_TRANSFER"]),
  allowPartialPayments: z.boolean().default(true),
  autoSendReceipts: z.boolean().default(true),
  requirePaymentReference: z.boolean().default(false),
  emailNotificationsEnabled: z.boolean().default(true),
  invoiceEmailSubject: z.string().optional(),
  invoiceEmailTemplate: z.string().optional(),
  receiptEmailSubject: z.string().optional(),
  receiptEmailTemplate: z.string().optional(),
  reminderEnabled: z.boolean().default(true),
  firstReminderDays: z.number().int().min(1).max(30).default(3),
  secondReminderDays: z.number().int().min(1).max(60).default(7),
  thirdReminderDays: z.number().int().min(1).max(90).default(14),
});

type BillingSettingsValues = z.infer<typeof billingSettingsSchema>;

type BillingProviderStatus = {
  provider: "stripe" | "paypal";
  supported: boolean;
  configured: boolean;
  publicKeyConfigured: boolean;
  secretKeyConfigured: boolean;
  checkoutReady: boolean;
  portalReady: boolean;
  webhookConfigured: boolean;
  priceMappingsConfigured: boolean;
};

type SubscriptionSnapshot = {
  billingProviders?: {
    activeProvider: "stripe" | "paypal" | null;
    stripe: BillingProviderStatus;
    paypal: BillingProviderStatus;
  };
};

const paymentMethodOptions = [
  { key: "CASH", label: "Cash" },
  { key: "CREDIT_CARD", label: "Credit Card" },
  { key: "DEBIT_CARD", label: "Debit Card" },
  { key: "BANK_TRANSFER", label: "Bank Transfer" },
  { key: "CHECK", label: "Check" },
  { key: "PAYPAL", label: "PayPal" },
  { key: "OTHER", label: "Other" },
] as const;

function StatusBadge({
  ready,
  trueLabel = "Ready",
  falseLabel = "Not ready",
}: {
  ready: boolean;
  trueLabel?: string;
  falseLabel?: string;
}) {
  return <Badge variant={ready ? "default" : "secondary"}>{ready ? trueLabel : falseLabel}</Badge>;
}

function ProviderStatusCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: Array<{ label: string; ready: boolean; trueLabel?: string; falseLabel?: string }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <span>{row.label}</span>
            <StatusBadge
              ready={row.ready}
              trueLabel={row.trueLabel}
              falseLabel={row.falseLabel}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function BillingSettingsForm() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("payment-processors");

  const {
    data: settings,
    isLoading: _isLoadingSettings,
  } = useQuery({
    queryKey: ["/api/settings/billing"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: false,
  });

  const { data: subscriptionSnapshot } = useQuery({
    queryKey: ["/api/subscription/current"],
    queryFn: getQueryFn<SubscriptionSnapshot>({ on401: "throw" }),
  });

  const form = useForm<BillingSettingsValues>({
    resolver: zodResolver(billingSettingsSchema),
    defaultValues: {
      paymentProcessorEnabled: false,
      paymentProcessor: "stripe",
      invoicePrefix: "INV",
      invoiceNumberFormat: "{PREFIX}-{YEAR}{MONTH}{NUMBER}",
      defaultDueDays: 30,
      defaultTerms: "Payment is due within 30 days of invoice date.",
      defaultNotes: "Thank you for your business!",
      companyInfo:
        "Your Company Name\nAddress Line 1\nCity, State, Zip\nPhone: (123) 456-7890\nEmail: billing@example.com",
      allowedPaymentMethods: ["CASH", "CREDIT_CARD", "BANK_TRANSFER", "CHECK"],
      allowPartialPayments: true,
      autoSendReceipts: true,
      requirePaymentReference: false,
      emailNotificationsEnabled: true,
      invoiceEmailSubject: "Invoice #{INVOICE_NUMBER} from {COMPANY_NAME}",
      invoiceEmailTemplate:
        "Dear {CUSTOMER_NAME},\n\nPlease find attached invoice #{INVOICE_NUMBER} in the amount of {AMOUNT}.\n\nThank you for your business!\n\n{COMPANY_NAME}",
      receiptEmailSubject: "Payment Receipt for Invoice #{INVOICE_NUMBER}",
      receiptEmailTemplate:
        "Dear {CUSTOMER_NAME},\n\nThank you for your payment of {AMOUNT} for invoice #{INVOICE_NUMBER}.\n\nPlease find attached your receipt.\n\n{COMPANY_NAME}",
      reminderEnabled: true,
      firstReminderDays: 3,
      secondReminderDays: 7,
      thirdReminderDays: 14,
    },
    values: (settings as BillingSettingsValues | undefined) || undefined,
  });

  const selectedPaymentProcessor = form.watch("paymentProcessor");
  const paymentProcessorEnabled = form.watch("paymentProcessorEnabled");
  const emailNotificationsEnabled = form.watch("emailNotificationsEnabled");
  const reminderEnabled = form.watch("reminderEnabled");
  const stripeStatus = subscriptionSnapshot?.billingProviders?.stripe;
  const paypalStatus = subscriptionSnapshot?.billingProviders?.paypal;
  const activeProvider = subscriptionSnapshot?.billingProviders?.activeProvider;

  const saveSettingsMutation = useMutation({
    mutationFn: async (data: BillingSettingsValues) => {
      const res = await apiRequest("POST", "/api/settings/billing", data);
      if (!res.ok) throw new Error("Failed to save settings");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/billing"] });
      toast({
        title: "Settings saved",
        description: "Billing settings have been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to save settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: BillingSettingsValues) => {
    saveSettingsMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Billing Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure invoice defaults, payment operations, and billing notifications.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          <TabsTrigger value="payment-processors" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Payment Processors
          </TabsTrigger>
          <TabsTrigger value="invoice-settings" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Invoice Settings
          </TabsTrigger>
          <TabsTrigger value="payment-settings" className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Payment Settings
          </TabsTrigger>
          <TabsTrigger value="notification-settings" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            Notifications
          </TabsTrigger>
        </TabsList>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <TabsContent value="payment-processors" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Payment Processors
                  </CardTitle>
                  <CardDescription>
                    Enable customer-facing payment flows and inspect backend provider readiness.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="paymentProcessorEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Enable Payment Processor</FormLabel>
                          <FormDescription>
                            Allow customers to pay invoices online when the provider is ready.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {paymentProcessorEnabled && (
                    <>
                      <FormField
                        control={form.control}
                        name="paymentProcessor"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Payment Processor</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a payment processor" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="stripe">
                                  Stripe {stripeStatus?.configured && <Badge className="ml-2">Configured</Badge>}
                                </SelectItem>
                                <SelectItem value="paypal">
                                  PayPal {!paypalStatus?.supported && (
                                    <Badge className="ml-2" variant="secondary">
                                      Planned
                                    </Badge>
                                  )}
                                </SelectItem>
                                <SelectItem value="other">Other (Manual Configuration)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              Frontend selection does not override backend entitlement or provider readiness.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {selectedPaymentProcessor === "stripe" && (
                        <div className="space-y-4">
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Stripe Integration</AlertTitle>
                            <AlertDescription>
                              SaaS billing credentials are environment-managed. This screen reports provider readiness
                              but does not accept or persist Stripe secrets.
                            </AlertDescription>
                          </Alert>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <ProviderStatusCard
                              title="Provider Readiness"
                              description={`Active provider: ${activeProvider ?? "not configured"}`}
                              rows={[
                                { label: "Public key", ready: Boolean(stripeStatus?.publicKeyConfigured) },
                                { label: "Secret key", ready: Boolean(stripeStatus?.secretKeyConfigured) },
                                { label: "Price mappings", ready: Boolean(stripeStatus?.priceMappingsConfigured) },
                                { label: "Webhook", ready: Boolean(stripeStatus?.webhookConfigured) },
                              ]}
                            />
                            <ProviderStatusCard
                              title="Capability Status"
                              description="Checkout and portal remain backend-authoritative."
                              rows={[
                                { label: "Configured", ready: Boolean(stripeStatus?.configured) },
                                { label: "Checkout", ready: Boolean(stripeStatus?.checkoutReady) },
                                { label: "Customer portal", ready: Boolean(stripeStatus?.portalReady) },
                                { label: "Provider support", ready: Boolean(stripeStatus?.supported) },
                              ]}
                            />
                          </div>

                          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Secret handling hardened</AlertTitle>
                            <AlertDescription>
                              Configure Stripe credentials in server environment variables and deployment secrets only.
                              Frontend settings now expose readiness instead of editable secret fields.
                            </AlertDescription>
                          </Alert>

                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                window.open("https://dashboard.stripe.com/apikeys", "_blank");
                              }}
                            >
                              Open Stripe Dashboard
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {selectedPaymentProcessor === "paypal" && (
                        <div className="space-y-4">
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>PayPal Integration</AlertTitle>
                            <AlertDescription>
                              PayPal status is reported here, but SaaS billing secrets are not editable in the app.
                            </AlertDescription>
                          </Alert>

                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <ProviderStatusCard
                              title="Provider Readiness"
                              description="PayPal remains a planned provider path in this build."
                              rows={[
                                { label: "Client ID", ready: Boolean(paypalStatus?.publicKeyConfigured) },
                                { label: "Client secret", ready: Boolean(paypalStatus?.secretKeyConfigured) },
                                { label: "Webhook", ready: Boolean(paypalStatus?.webhookConfigured) },
                                { label: "Configured", ready: Boolean(paypalStatus?.configured) },
                              ]}
                            />
                            <ProviderStatusCard
                              title="Capability Status"
                              description="Backend transport is not enabled for PayPal yet."
                              rows={[
                                {
                                  label: "Provider support",
                                  ready: Boolean(paypalStatus?.supported),
                                  trueLabel: "Enabled",
                                  falseLabel: "Planned",
                                },
                                { label: "Checkout", ready: Boolean(paypalStatus?.checkoutReady) },
                                { label: "Customer portal", ready: Boolean(paypalStatus?.portalReady) },
                                { label: "Price mappings", ready: Boolean(paypalStatus?.priceMappingsConfigured) },
                              ]}
                            />
                          </div>

                          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Secret handling hardened</AlertTitle>
                            <AlertDescription>
                              Keep PayPal credentials in deployment secrets. This UI now reports readiness and support
                              status without accepting secret values.
                            </AlertDescription>
                          </Alert>

                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                window.open("https://developer.paypal.com/developer/applications/", "_blank");
                              }}
                            >
                              Open PayPal Developer Dashboard
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="invoice-settings" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Invoice Settings
                  </CardTitle>
                  <CardDescription>
                    Configure invoice numbering, default terms, and company copy.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="invoicePrefix"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Invoice Prefix</FormLabel>
                          <FormControl>
                            <Input placeholder="INV" maxLength={5} {...field} value={field.value || ""} />
                          </FormControl>
                          <FormDescription>Short prefix for invoice numbers.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="defaultDueDays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Due Days</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={90}
                              {...field}
                              onChange={(e) => field.onChange(Number(e.target.value))}
                              value={field.value}
                            />
                          </FormControl>
                          <FormDescription>Days from invoice date before payment is due.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="invoiceNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Invoice Number Format</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="{PREFIX}-{YEAR}{MONTH}{NUMBER}"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Available tags: {"{PREFIX}"}, {"{YEAR}"}, {"{MONTH}"}, {"{NUMBER}"}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="defaultTerms"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default Terms</FormLabel>
                        <FormControl>
                          <Textarea
                            className="min-h-[100px]"
                            placeholder="Payment is due within 30 days of invoice date."
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>Shown on newly generated invoices.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="defaultNotes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            className="min-h-[100px]"
                            placeholder="Thank you for your business!"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>Appended to invoice messages and print views.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="companyInfo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Info Block</FormLabel>
                        <FormControl>
                          <Textarea
                            className="min-h-[140px]"
                            placeholder="Company details shown on invoice templates"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>Used in invoice templates and customer-facing documents.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="payment-settings" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wallet className="h-5 w-5" />
                    Payment Settings
                  </CardTitle>
                  <CardDescription>
                    Control accepted payment methods and payment capture behavior.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="allowedPaymentMethods"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Allowed Payment Methods</FormLabel>
                        <FormDescription>
                          These options affect invoice operations, not SaaS provider secret storage.
                        </FormDescription>
                        <div className="grid grid-cols-1 gap-3 rounded-lg border p-4 md:grid-cols-2">
                          {paymentMethodOptions.map((option) => (
                            <label
                              key={option.key}
                              className="flex items-center gap-3 text-sm font-normal"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes(option.key)}
                                onChange={(e) => {
                                  const current = field.value || [];
                                  field.onChange(
                                    e.target.checked
                                      ? [...current, option.key]
                                      : current.filter((value) => value !== option.key),
                                  );
                                }}
                              />
                              <span>{option.label}</span>
                            </label>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="allowPartialPayments"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                          <div className="space-y-0.5">
                            <FormLabel>Allow Partial Payments</FormLabel>
                            <FormDescription>Accept split invoice settlement.</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="autoSendReceipts"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                          <div className="space-y-0.5">
                            <FormLabel>Auto-Send Receipts</FormLabel>
                            <FormDescription>Email receipts after payment capture.</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="requirePaymentReference"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                          <div className="space-y-0.5">
                            <FormLabel>Require Payment Reference</FormLabel>
                            <FormDescription>Capture traceable payment references.</FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notification-settings" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    Notification Settings
                  </CardTitle>
                  <CardDescription>
                    Configure invoice email templates and reminder timing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="emailNotificationsEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Enable Email Notifications</FormLabel>
                          <FormDescription>
                            Send invoice and receipt communication to customers.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {emailNotificationsEnabled && (
                    <>
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="invoice-emails">
                          <AccordionTrigger>Invoice Email Templates</AccordionTrigger>
                          <AccordionContent className="space-y-4 pb-6">
                            <FormField
                              control={form.control}
                              name="invoiceEmailSubject"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Invoice Email Subject</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="Invoice #{INVOICE_NUMBER} from {COMPANY_NAME}"
                                      {...field}
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{CUSTOMER_NAME}"}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="invoiceEmailTemplate"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Invoice Email Template</FormLabel>
                                  <FormControl>
                                    <Textarea
                                      className="min-h-[120px]"
                                      placeholder="Dear {CUSTOMER_NAME}, ..."
                                      {...field}
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{AMOUNT}"}, {"{DUE_DATE}"}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="receipt-emails">
                          <AccordionTrigger>Receipt Email Templates</AccordionTrigger>
                          <AccordionContent className="space-y-4 pb-6">
                            <FormField
                              control={form.control}
                              name="receiptEmailSubject"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Receipt Email Subject</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="Payment Receipt for Invoice #{INVOICE_NUMBER}"
                                      {...field}
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{PAYMENT_DATE}"}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="receiptEmailTemplate"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Receipt Email Template</FormLabel>
                                  <FormControl>
                                    <Textarea
                                      className="min-h-[120px]"
                                      placeholder="Dear {CUSTOMER_NAME}, ..."
                                      {...field}
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{AMOUNT}"}, {"{PAYMENT_METHOD}"}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>

                      <FormField
                        control={form.control}
                        name="reminderEnabled"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                            <div className="space-y-0.5">
                              <FormLabel>Enable Payment Reminders</FormLabel>
                              <FormDescription>Send follow-up reminders for overdue invoices.</FormDescription>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {reminderEnabled && (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                          <FormField
                            control={form.control}
                            name="firstReminderDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>First Reminder</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={30}
                                    {...field}
                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                    value={field.value}
                                  />
                                </FormControl>
                                <FormDescription>Days after due date.</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="secondReminderDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Second Reminder</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={60}
                                    {...field}
                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                    value={field.value}
                                  />
                                </FormControl>
                                <FormDescription>Days after due date.</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="thirdReminderDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Third Reminder</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min={1}
                                    max={90}
                                    {...field}
                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                    value={field.value}
                                  />
                                </FormControl>
                                <FormDescription>Days after due date.</FormDescription>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <div className="flex justify-end">
              <Button type="submit" disabled={saveSettingsMutation.isPending} className="gap-2">
                <Save className="h-4 w-4" />
                {saveSettingsMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </form>
        </Form>
      </Tabs>
    </div>
  );
}
