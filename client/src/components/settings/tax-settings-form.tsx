import React from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Loader2, Receipt } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";
import { SettingsAuthorityState } from "./settings-authority-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Define schema for form validation
const taxSettingsSchema = z.object({
  enableVat: z.boolean().default(false),
  defaultVatCountry: z.string().min(2, "Country code must be valid").optional(),
  showPricesWithVat: z.boolean().default(true),
});

// Type for form data
type TaxSettingsFormType = z.infer<typeof taxSettingsSchema>;

// Country options
const countryCodes = [
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "AU", label: "Australia" },
  { value: "DE", label: "Germany" },
  { value: "FR", label: "France" },
  { value: "IT", label: "Italy" },
  { value: "ES", label: "Spain" },
  { value: "JP", label: "Japan" },
  { value: "CN", label: "China" },
  { value: "IN", label: "India" },
  { value: "BR", label: "Brazil" },
  { value: "MX", label: "Mexico" },
  { value: "ZA", label: "South Africa" },
  { value: "SG", label: "Singapore" },
  { value: "AE", label: "United Arab Emirates" },
];

export function TaxSettingsForm() {
  const { settings, isLoading, error, refetch, updateSettings } = useSettings();

  // Create form
  const form = useForm<TaxSettingsFormType>({
    resolver: zodResolver(taxSettingsSchema),
    defaultValues: {
      enableVat: settings?.enableVat ?? false,
      defaultVatCountry: settings?.defaultVatCountry || "",
      showPricesWithVat: settings?.showPricesWithVat ?? false,
    },
  });

  React.useEffect(() => {
    if (!settings) return;
    form.reset({
      enableVat: settings?.enableVat ?? false,
      defaultVatCountry: settings?.defaultVatCountry || "",
      showPricesWithVat: settings?.showPricesWithVat ?? false,
    });
  }, [form, settings]);

  // Submit handler
  function onSubmit(data: TaxSettingsFormType) {
    if (!settings) return;
    updateSettings.mutate(data);
  }

  if (!settings) return <SettingsAuthorityState loading={isLoading} error={error} onRetry={() => void refetch()} />;

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              Tax Settings
            </CardTitle>
            <CardDescription>
              Configure VAT and tax calculation preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="enableVat"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable VAT/Sales Tax</FormLabel>
                    <FormDescription>
                      Calculate and track VAT or sales tax for inventory items
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      data-testid="tax-settings-enable-vat"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="showPricesWithVat"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Show Prices with VAT</FormLabel>
                    <FormDescription>
                      Display prices including VAT/tax by default
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      data-testid="tax-settings-show-prices-with-vat"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch("enableVat")}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultVatCountry"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Tax Region</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={!form.watch("enableVat")}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue data-testid="tax-settings-default-region-value" placeholder="Select country" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {countryCodes.map((country) => (
                        <SelectItem key={country.value} value={country.value}>
                          {country.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Default country or region for tax calculations
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <p className="font-medium">About Tax Configuration</p>
              <p className="mt-1">
                The tax system supports multiple tax zones and rates. For detailed tax rate 
                configuration, use the VAT Rates section in the System Administration 
                area. Tax rates are automatically updated for supported regions.
              </p>
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
