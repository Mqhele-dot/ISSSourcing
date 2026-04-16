import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

/** Common ISO 4217 codes for reporting; users can extend via API if needed later. */
const REPORTING_CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "INR",
  "ZAR",
  "MXN",
  "BRL",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "SGD",
  "HKD",
  "NZD",
] as const;

// Define form schema
const generalSettingsSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  companyLogo: z.string().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, "Must be a valid hex color"),
  dateFormat: z.string().min(1, "Date format is required"),
  timeFormat: z.string().min(1, "Time format is required"),
  currencySymbol: z.string().min(1, "Currency symbol is required"),
  currencyCode: z
    .string()
    .length(3, "Use a 3-letter ISO 4217 code")
    .regex(/^[A-Za-z]{3}$/, "Invalid code")
    .transform((s) => s.toUpperCase()),
});

export function GeneralSettingsForm() {
  const { settings, updateSettings } = useSettings();

  // Create form
  const form = useForm<z.infer<typeof generalSettingsSchema>>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: {
      companyName: settings.companyName || '',
      companyLogo: settings.companyLogo,
      primaryColor: settings.primaryColor || '#0f766e',
      dateFormat: settings.dateFormat || 'YYYY-MM-DD',
      timeFormat: settings.timeFormat || 'HH:mm',
      currencySymbol: settings.currencySymbol || '$',
      currencyCode: (settings.currencyCode || "USD").toUpperCase(),
    },
  });

  // Submit handler
  function onSubmit(data: z.infer<typeof generalSettingsSchema>) {
    if (settings) {
      updateSettings.mutate({
        ...settings,
        companyName: data.companyName,
        companyLogo: data.companyLogo,
        primaryColor: data.primaryColor,
        dateFormat: data.dateFormat,
        timeFormat: data.timeFormat,
        currencySymbol: data.currencySymbol,
        currencyCode: data.currencyCode,
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>General Information</CardTitle>
        <CardDescription>
          Basic information about your company and display preferences
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="companyName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Your Company Name" {...field} />
                  </FormControl>
                  <FormDescription>
                    This will be displayed throughout the application
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="companyLogo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Logo URL</FormLabel>
                  <FormControl>
                    <Input placeholder="https://example.com/logo.png" {...field} value={field.value || ""} />
                  </FormControl>
                  <FormDescription>
                    URL to your company logo (Optional)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="primaryColor"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Color</FormLabel>
                    <div className="flex space-x-2">
                      <FormControl>
                        <Input type="color" {...field} className="w-12 h-10 p-1" />
                      </FormControl>
                      <Input
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                    <FormDescription>
                      Brand color for UI elements
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currencySymbol"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency Symbol</FormLabel>
                    <FormControl>
                      <Input placeholder="$" {...field} />
                    </FormControl>
                    <FormDescription>
                      Symbol used for monetary values and legacy PDFs
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="currencyCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reporting currency (ISO 4217)</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger aria-label="Reporting currency code">
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {REPORTING_CURRENCY_CODES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Used for analytics, AP workspace, and number formatting across the app
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="dateFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date Format</FormLabel>
                    <FormControl>
                      <Input placeholder="YYYY-MM-DD" {...field} />
                    </FormControl>
                    <FormDescription>
                      Format for displaying dates
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="timeFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time Format</FormLabel>
                    <FormControl>
                      <Input placeholder="HH:mm" {...field} />
                    </FormControl>
                    <FormDescription>
                      Format for displaying times
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}