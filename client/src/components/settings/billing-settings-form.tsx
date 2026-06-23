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
  FormMessage 
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Tabs, 
  TabsContent, 
  TabsList, 
  TabsTrigger 
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getQueryFn, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  AlertCircle, 
  CreditCard, 
  FileText,
  Save,
  ArrowRight,
  Globe,
  Wallet
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// Validation schema for billing settings
const billingSettingsSchema = z.object({
  // Payment processor settings
  paymentProcessorEnabled: z.boolean().default(false),
  paymentProcessor: z.string().optional(),
  
  // Invoice settings
  invoicePrefix: z.string().max(5).optional(),
  invoiceNumberFormat: z.string().optional(),
  defaultDueDays: z.number().int().min(0).max(90).default(30),
  defaultTerms: z.string().optional(),
  defaultNotes: z.string().optional(),
  companyInfo: z.string().optional(),
  
  // Payment settings
  allowedPaymentMethods: z.array(z.string()).default(["CASH", "CREDIT_CARD", "BANK_TRANSFER"]),
  allowPartialPayments: z.boolean().default(true),
  autoSendReceipts: z.boolean().default(true),
  requirePaymentReference: z.boolean().default(false),
  
  // Email settings
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

type BillingProviderReadiness = {
  activeProvider?: string;
  stripe?: {
    configured?: boolean;
    publicKeyConfigured?: boolean;
    secretKeyConfigured?: boolean;
    checkoutReady?: boolean;
    portalReady?: boolean;
    webhookConfigured?: boolean;
    priceMappingsConfigured?: number;
  };
  paypal?: {
    supported?: boolean;
    configured?: boolean;
    reason?: string;
  };
};

type SubscriptionSnapshot = {
  billingProviders?: BillingProviderReadiness;
  normalizedPlanTier?: string;
  access?: {
    code?: string;
    label?: string;
    message?: string;
    restricted?: boolean;
  };
  usageStatus?: {
    code?: string;
    message?: string;
    withinLimits?: boolean;
    overLimitKeys?: string[];
    atLimitKeys?: string[];
  };
  usageLimits?: Array<{
    key: string;
    label: string;
    current: number;
    limit: number | null;
    remaining: number | null;
    atLimit: boolean;
    overLimit: boolean;
  }>;
  upgradeHints?: string[];
};

export function BillingSettingsForm() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("payment-processors");
  
  // Fetch settings
  const {
    data: settings,
    isLoading: _isLoadingSettings,
  } = useQuery({
    queryKey: ["/api/settings/billing"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: false, // Disabled until API endpoint is ready
  });
  
  // Setup form with default values
  const form = useForm<BillingSettingsValues>({
    resolver: zodResolver(billingSettingsSchema),
    defaultValues: {
      // Payment processor settings
      paymentProcessorEnabled: false,
      paymentProcessor: "stripe",
      
      // Invoice settings
      invoicePrefix: "INV",
      invoiceNumberFormat: "{PREFIX}-{YEAR}{MONTH}{NUMBER}",
      defaultDueDays: 30,
      defaultTerms: "Payment is due within 30 days of invoice date.",
      defaultNotes: "Thank you for your business!",
      companyInfo: "Your Company Name\nAddress Line 1\nCity, State, Zip\nPhone: (123) 456-7890\nEmail: billing@example.com",
      
      // Payment settings
      allowedPaymentMethods: ["CASH", "CREDIT_CARD", "BANK_TRANSFER", "CHECK"],
      allowPartialPayments: true,
      autoSendReceipts: true,
      requirePaymentReference: false,
      
      // Email settings
      emailNotificationsEnabled: true,
      invoiceEmailSubject: "Invoice #{INVOICE_NUMBER} from {COMPANY_NAME}",
      invoiceEmailTemplate: "Dear {CUSTOMER_NAME},\n\nPlease find attached invoice #{INVOICE_NUMBER} in the amount of {AMOUNT}.\n\nThank you for your business!\n\n{COMPANY_NAME}",
      receiptEmailSubject: "Payment Receipt for Invoice #{INVOICE_NUMBER}",
      receiptEmailTemplate: "Dear {CUSTOMER_NAME},\n\nThank you for your payment of {AMOUNT} for invoice #{INVOICE_NUMBER}.\n\nPlease find attached your receipt.\n\n{COMPANY_NAME}",
      reminderEnabled: true,
      firstReminderDays: 3,
      secondReminderDays: 7,
      thirdReminderDays: 14,
    },
    // Merge with fetched settings when available
    values: (settings as BillingSettingsValues | undefined) || undefined,
  });
  
  const selectedPaymentProcessor = form.watch("paymentProcessor");
  const paymentProcessorEnabled = form.watch("paymentProcessorEnabled");
  const { data: subscriptionSnapshot } = useQuery<SubscriptionSnapshot>({
    queryKey: ["/api/subscription/current"],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const billingProviders = subscriptionSnapshot?.billingProviders;
  const stripeReadiness = billingProviders?.stripe;
  const paypalReadiness = billingProviders?.paypal;
  const accessState = subscriptionSnapshot?.access;
  const usageStatus = subscriptionSnapshot?.usageStatus;
  const usageLimits = subscriptionSnapshot?.usageLimits ?? [];
  const usageHighlights = usageLimits.filter((entry) => entry.atLimit || entry.overLimit);
  
  // Save settings mutation
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
  
  // Form submission
  const onSubmit = (data: BillingSettingsValues) => {
    saveSettingsMutation.mutate(data);
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Billing Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure how invoices, payments, and billing notifications work in your system.
        </p>
      </div>
      
      <Tabs 
        value={activeTab} 
        onValueChange={setActiveTab} 
        className="space-y-4"
      >
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
                    Configure payment processors to accept online payments.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {subscriptionSnapshot && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div className="rounded-lg border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">Plan access</p>
                              <p className="text-sm text-muted-foreground">
                                {accessState?.message ?? "Subscription access state is not available."}
                              </p>
                            </div>
                            <Badge variant={accessState?.restricted ? "destructive" : "default"}>
                              {accessState?.label ?? "Unknown"}
                            </Badge>
                          </div>
                        </div>
                        <div className="rounded-lg border p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-medium">Plan tier</p>
                              <p className="text-sm text-muted-foreground">
                                Backend-enforced SaaS tier for this organization.
                              </p>
                            </div>
                            <Badge variant="outline">
                              {(subscriptionSnapshot.normalizedPlanTier ?? "standard").toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {usageStatus && (
                        <Alert variant={usageStatus.withinLimits ? "default" : "destructive"}>
                          <AlertCircle className="h-4 w-4" />
                          <AlertTitle>{usageStatus.code === "USAGE_LIMIT_REACHED" ? "Usage limit reached" : "Usage status"}</AlertTitle>
                          <AlertDescription>{usageStatus.message}</AlertDescription>
                        </Alert>
                      )}

                      {usageHighlights.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          {usageHighlights.map((entry) => (
                            <div key={entry.key} className="rounded-lg border p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">{entry.label}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {entry.current} used
                                    {entry.limit != null ? ` of ${entry.limit}` : ""}
                                  </p>
                                </div>
                                <Badge variant={entry.overLimit ? "destructive" : "secondary"}>
                                  {entry.overLimit ? "Over" : "At limit"}
                                </Badge>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="paymentProcessorEnabled"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                        <div className="space-y-0.5">
                          <FormLabel>Enable Payment Processor</FormLabel>
                          <FormDescription>
                            Allow customers to pay invoices online.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
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
                            <Select 
                              onValueChange={field.onChange} 
                              defaultValue={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a payment processor" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="stripe">
                                  Stripe {stripeReadiness?.configured && <Badge className="ml-2">Configured</Badge>}
                                </SelectItem>
                                <SelectItem value="paypal">PayPal</SelectItem>
                                <SelectItem value="other">Other (Manual Configuration)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormDescription>
                              Select the payment processor you want to use.
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
                              Stripe credentials are configured by environment variables, not stored in
                              company settings. This keeps secret keys out of browser forms and audit logs.
                            </AlertDescription>
                          </Alert>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-lg border p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">Public key</p>
                                  <p className="text-sm text-muted-foreground">Client payment form readiness.</p>
                                </div>
                                <Badge variant={stripeReadiness?.publicKeyConfigured ? "default" : "secondary"}>
                                  {stripeReadiness?.publicKeyConfigured ? "Configured" : "Missing"}
                                </Badge>
                              </div>
                            </div>

                            <div className="rounded-lg border p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">Secret key</p>
                                  <p className="text-sm text-muted-foreground">Server checkout and portal readiness.</p>
                                </div>
                                <Badge variant={stripeReadiness?.secretKeyConfigured ? "default" : "secondary"}>
                                  {stripeReadiness?.secretKeyConfigured ? "Configured" : "Missing"}
                                </Badge>
                              </div>
                            </div>

                            <div className="rounded-lg border p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">Checkout prices</p>
                                  <p className="text-sm text-muted-foreground">
                                    {stripeReadiness?.priceMappingsConfigured ?? 0} plan price mapping(s) detected.
                                  </p>
                                </div>
                                <Badge variant={stripeReadiness?.checkoutReady ? "default" : "secondary"}>
                                  {stripeReadiness?.checkoutReady ? "Ready" : "Setup needed"}
                                </Badge>
                              </div>
                            </div>

                            <div className="rounded-lg border p-4">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium">Webhook signing</p>
                                  <p className="text-sm text-muted-foreground">Required for trusted subscription updates.</p>
                                </div>
                                <Badge variant={stripeReadiness?.webhookConfigured ? "default" : "secondary"}>
                                  {stripeReadiness?.webhookConfigured ? "Configured" : "Missing"}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                window.open('https://dashboard.stripe.com/apikeys', '_blank');
                              }}
                            >
                              Open Stripe Dashboard
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          </div>

                          {subscriptionSnapshot?.upgradeHints?.length ? (
                            <div className="rounded-lg border border-dashed p-4">
                              <p className="font-medium">Upgrade guidance</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {subscriptionSnapshot.upgradeHints.join(" ")}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      )}

                      {selectedPaymentProcessor === "paypal" && (
                        <div className="space-y-4">
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>PayPal Integration</AlertTitle>
                            <AlertDescription>
                              PayPal is not active in this build. The app reports this honestly instead of
                              accepting credentials that runtime billing will not use.
                            </AlertDescription>
                          </Alert>

                          <div className="rounded-lg border p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-medium">Provider status</p>
                                <p className="text-sm text-muted-foreground">
                                  {paypalReadiness?.reason ?? "PayPal is planned for a later billing provider integration."}
                                </p>
                              </div>
                              <Badge variant={paypalReadiness?.configured ? "default" : "secondary"}>
                                {paypalReadiness?.supported ? "Supported" : "Planned"}
                              </Badge>
                            </div>
                          </div>

                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                window.open('https://developer.paypal.com/developer/applications/', '_blank');
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
                    Configure invoice settings, including numbering, default terms, and company information.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="invoicePrefix"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Invoice Prefix</FormLabel>
                          <FormControl>
                            <Input 
                              placeholder="INV" 
                              {...field} 
                              value={field.value || ""}
                              maxLength={5}
                            />
                          </FormControl>
                          <FormDescription>
                            Short prefix for invoice numbers (e.g., INV, BILL).
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
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
                            Format for invoice numbers. Available tags: {"{PREFIX}"}, {"{YEAR}"}, {"{MONTH}"}, {"{DAY}"}, {"{NUMBER}"}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <FormField
                    control={form.control}
                    name="defaultDueDays"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default Payment Terms (days)</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min={0} 
                            max={90} 
                            {...field} 
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            value={field.value || 30}
                          />
                        </FormControl>
                        <FormDescription>
                          Default number of days until payment is due.
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
                        <FormLabel>Default Terms & Conditions</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Payment is due within 30 days of invoice date." 
                            className="min-h-[80px]"
                            {...field} 
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Default terms and conditions for all invoices.
                        </FormDescription>
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
                            placeholder="Thank you for your business!" 
                            className="min-h-[80px]"
                            {...field} 
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Default notes to include on all invoices.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="companyInfo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Information</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Your Company Name&#10;Address Line 1&#10;City, State, Zip&#10;Phone: (123) 456-7890&#10;Email: billing@example.com" 
                            className="min-h-[120px]"
                            {...field} 
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormDescription>
                          Company information to include on all invoices.
                        </FormDescription>
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
                    Configure payment methods and other payment-related settings.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                    <FormField
                      control={form.control}
                      name="allowPartialPayments"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                          <div className="space-y-0.5">
                            <FormLabel>Allow Partial Payments</FormLabel>
                            <FormDescription>
                              Allow customers to pay a portion of an invoice.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
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
                            <FormLabel>Automatically Send Receipts</FormLabel>
                            <FormDescription>
                              Send receipts automatically when payments are recorded.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
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
                            <FormDescription>
                              Require a reference number for all payments.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  
                  <Separator className="my-4" />
                  
                  <FormField
                    control={form.control}
                    name="allowedPaymentMethods"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Allowed Payment Methods</FormLabel>
                        <FormDescription className="mb-4">
                          Select the payment methods that you want to accept.
                        </FormDescription>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("CASH")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "CASH"]
                                    : (field.value || []).filter((v) => v !== "CASH");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">Cash</FormLabel>
                          </FormItem>
                          
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("CREDIT_CARD")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "CREDIT_CARD"]
                                    : (field.value || []).filter((v) => v !== "CREDIT_CARD");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">Credit Card</FormLabel>
                          </FormItem>
                          
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("DEBIT_CARD")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "DEBIT_CARD"]
                                    : (field.value || []).filter((v) => v !== "DEBIT_CARD");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">Debit Card</FormLabel>
                          </FormItem>
                          
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("BANK_TRANSFER")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "BANK_TRANSFER"]
                                    : (field.value || []).filter((v) => v !== "BANK_TRANSFER");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">Bank Transfer</FormLabel>
                          </FormItem>
                          
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("CHECK")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "CHECK"]
                                    : (field.value || []).filter((v) => v !== "CHECK");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">Check</FormLabel>
                          </FormItem>
                          
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("PAYPAL")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "PAYPAL"]
                                    : (field.value || []).filter((v) => v !== "PAYPAL");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">PayPal</FormLabel>
                          </FormItem>
                          
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                checked={field.value?.includes("OTHER")}
                                onChange={(e) => {
                                  const newValue = e.target.checked
                                    ? [...(field.value || []), "OTHER"]
                                    : (field.value || []).filter((v) => v !== "OTHER");
                                  field.onChange(newValue);
                                }}
                              />
                            </FormControl>
                            <FormLabel className="cursor-pointer font-normal">Other</FormLabel>
                          </FormItem>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                    Configure email notifications and reminders for invoices and payments.
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
                            Send email notifications for invoices and payments.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  
                  {form.watch("emailNotificationsEnabled") && (
                    <>
                      <Accordion type="single" collapsible className="w-full">
                        <AccordionItem value="invoice-emails">
                          <AccordionTrigger>Invoice Email Templates</AccordionTrigger>
                          <AccordionContent className="pb-6 space-y-4">
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
                                    Subject line for invoice emails. Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{CUSTOMER_NAME}"}, {"{AMOUNT}"}, {"{DUE_DATE}"}
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
                                      placeholder="Dear {CUSTOMER_NAME},&#10;&#10;Please find attached invoice #{INVOICE_NUMBER} in the amount of {AMOUNT}.&#10;&#10;Thank you for your business!&#10;&#10;{COMPANY_NAME}" 
                                      className="min-h-[120px]"
                                      {...field} 
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Email template for invoices. Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{CUSTOMER_NAME}"}, {"{AMOUNT}"}, {"{DUE_DATE}"}, {"{TERMS}"}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </AccordionContent>
                        </AccordionItem>
                        
                        <AccordionItem value="receipt-emails">
                          <AccordionTrigger>Receipt Email Templates</AccordionTrigger>
                          <AccordionContent className="pb-6 space-y-4">
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
                                    Subject line for receipt emails. Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{CUSTOMER_NAME}"}, {"{AMOUNT}"}, {"{PAYMENT_DATE}"}, {"{PAYMENT_METHOD}"}
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
                                      placeholder="Dear {CUSTOMER_NAME},&#10;&#10;Thank you for your payment of {AMOUNT} for invoice #{INVOICE_NUMBER}.&#10;&#10;Please find attached your receipt.&#10;&#10;{COMPANY_NAME}" 
                                      className="min-h-[120px]"
                                      {...field} 
                                      value={field.value || ""}
                                    />
                                  </FormControl>
                                  <FormDescription>
                                    Email template for receipts. Available tags: {"{INVOICE_NUMBER}"}, {"{COMPANY_NAME}"}, {"{CUSTOMER_NAME}"}, {"{AMOUNT}"}, {"{PAYMENT_DATE}"}, {"{PAYMENT_METHOD}"}
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
                              <FormDescription>
                                Send automated reminders for overdue invoices.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      
                      {form.watch("reminderEnabled") && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <FormField
                            control={form.control}
                            name="firstReminderDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>First Reminder (days after due date)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    min={0} 
                                    max={30} 
                                    {...field} 
                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                    value={field.value || 3}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <FormField
                            control={form.control}
                            name="secondReminderDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Second Reminder (days after due date)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    min={0} 
                                    max={60} 
                                    {...field} 
                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                    value={field.value || 7}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          
                          <FormField
                            control={form.control}
                            name="thirdReminderDays"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Third Reminder (days after due date)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    min={0} 
                                    max={90} 
                                    {...field} 
                                    onChange={(e) => field.onChange(Number(e.target.value))}
                                    value={field.value || 14}
                                  />
                                </FormControl>
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
            
            <div className="flex justify-end mt-6">
              <Button
                type="submit"
                disabled={saveSettingsMutation.isPending}
                className="gap-2"
              >
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
