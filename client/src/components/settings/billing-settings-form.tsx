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
  CardFooter, 
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
  DollarSign, 
  Receipt, 
  FileText,
  Save,
  AlertTriangle,
  ArrowRight,
  Globe,
  Lock,
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
  stripePublicKey: z.string().optional(),
  stripeSecretKey: z.string().optional(),
  paypalClientId: z.string().optional(),
  paypalClientSecret: z.string().optional(),
  
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

export function BillingSettingsForm() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("payment-processors");
  
  // Fetch settings
  const {
    data: settings,
    isLoading: isLoadingSettings,
  } = useQuery({
    queryKey: ["/api/settings/billing"],
    queryFn: getQueryFn(),
    enabled: false, // Disabled until API endpoint is ready
  });
  
  // Setup form with default values
  const form = useForm<BillingSettingsValues>({
    resolver: zodResolver(billingSettingsSchema),
    defaultValues: {
      // Payment processor settings
      paymentProcessorEnabled: false,
      paymentProcessor: "stripe",
      stripePublicKey: "",
      stripeSecretKey: "",
      paypalClientId: "",
      paypalClientSecret: "",
      
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
    values: settings || undefined,
  });
  
  // Update payment processor fields when payment processor changes
  const selectedPaymentProcessor = form.watch("paymentProcessor");
  const paymentProcessorEnabled = form.watch("paymentProcessorEnabled");
  
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
  
  // Check for Stripe keys in environment
  const hasStripePublicKey = Boolean(import.meta.env.VITE_STRIPE_PUBLIC_KEY);
  const hasStripeSecretKey = false; // This would be checked on the server
  
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
                                  Stripe {hasStripePublicKey && <Badge className="ml-2">Configured</Badge>}
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
                              To use Stripe, you need to add your API keys to the environment variables.
                              The public key will be used by the client to create payment forms, while the
                              secret key will be used by the server to process payments.
                            </AlertDescription>
                          </Alert>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                              control={form.control}
                              name="stripePublicKey"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Stripe Public Key</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        placeholder="pk_test_..."
                                        {...field}
                                        type="password"
                                        disabled={hasStripePublicKey}
                                        value={hasStripePublicKey ? "••••••••••••••••••••••••••••••" : field.value}
                                      />
                                      <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </FormControl>
                                  <FormDescription>
                                    {hasStripePublicKey 
                                      ? "Stripe public key is configured in the environment variables." 
                                      : "Your Stripe public key (starts with pk_)."}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            
                            <FormField
                              control={form.control}
                              name="stripeSecretKey"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Stripe Secret Key</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        placeholder="sk_test_..."
                                        {...field}
                                        type="password"
                                        disabled={hasStripeSecretKey}
                                        value={hasStripeSecretKey ? "••••••••••••••••••••••••••••••" : field.value}
                                      />
                                      <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </FormControl>
                                  <FormDescription>
                                    {hasStripeSecretKey 
                                      ? "Stripe secret key is configured on the server." 
                                      : "Your Stripe secret key (starts with sk_)."}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          
                          <Alert className="bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-900">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Important Security Note</AlertTitle>
                            <AlertDescription>
                              The Stripe secret key should ideally be added to your server environment
                              variables and not stored in these settings. This field is provided for
                              development and testing purposes only.
                            </AlertDescription>
                          </Alert>
                          
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
                        </div>
                      )}
                      
                      {selectedPaymentProcessor === "paypal" && (
                        <div className="space-y-4">
                          <Alert>
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>PayPal Integration</AlertTitle>
                            <AlertDescription>
                              To use PayPal, you need to add your API credentials to the environment variables.
                            </AlertDescription>
                          </Alert>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormField
                              control={form.control}
                              name="paypalClientId"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>PayPal Client ID</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        placeholder="Client ID"
                                        {...field}
                                        type="password"
                                      />
                                      <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </FormControl>
                                  <FormDescription>
                                    Your PayPal client ID from the PayPal Developer Dashboard.
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            
                            <FormField
                              control={form.control}
                              name="paypalClientSecret"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>PayPal Client Secret</FormLabel>
                                  <FormControl>
                                    <div className="relative">
                                      <Input
                                        placeholder="Client Secret"
                                        {...field}
                                        type="password"
                                      />
                                      <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    </div>
                                  </FormControl>
                                  <FormDescription>
                                    Your PayPal client secret from the PayPal Developer Dashboard.
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                          
                          <Alert className="bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-900">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertTitle>Important Security Note</AlertTitle>
                            <AlertDescription>
                              The PayPal client secret should ideally be added to your server environment
                              variables and not stored in these settings. This field is provided for
                              development and testing purposes only.
                            </AlertDescription>
                          </Alert>
                          
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