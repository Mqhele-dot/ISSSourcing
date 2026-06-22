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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, BarChart3 } from "lucide-react";
import { useSettings } from "@/hooks/use-settings";

// Define schema for form validation
const forecastingSettingsSchema = z.object({
  forecastingEnabled: z.boolean().default(true),
  forecastDays: z.coerce.number().int().min(1, "Forecast period must be at least 1 day").max(365, "Forecast period cannot exceed 365 days"),
  seasonalAdjustmentEnabled: z.boolean().default(true),
});

// Type for form data
type ForecastingSettingsFormType = z.infer<typeof forecastingSettingsSchema>;

export function ForecastingSettingsForm() {
  const { settings, updateSettings } = useSettings();

  // Create form
  const form = useForm<ForecastingSettingsFormType>({
    resolver: zodResolver(forecastingSettingsSchema),
    defaultValues: {
      forecastingEnabled: settings.forecastingEnabled ?? true,
      forecastDays: settings.forecastDays ?? 30,
      seasonalAdjustmentEnabled: settings.seasonalAdjustmentEnabled ?? true,
    },
  });

  // Submit handler
  function onSubmit(data: ForecastingSettingsFormType) {
    updateSettings.mutate(data);
  }

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Forecasting Settings
            </CardTitle>
            <CardDescription>
              Configure how the system predicts future inventory needs
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="forecastingEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enable Demand Forecasting</FormLabel>
                    <FormDescription>
                      Use historical data to predict future inventory needs
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
              name="seasonalAdjustmentEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Seasonal Adjustment</FormLabel>
                    <FormDescription>
                      Account for seasonal variations in demand forecasting
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch("forecastingEnabled")}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="forecastDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Forecast Period (Days)</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      placeholder="30" 
                      {...field} 
                      disabled={!form.watch("forecastingEnabled")}
                    />
                  </FormControl>
                  <FormDescription>
                    How many days in advance to forecast inventory needs
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <p className="font-medium">About AI-Powered Forecasting</p>
              <p className="mt-1">
                The forecasting engine uses machine learning to analyze historical sales data, 
                seasonal trends, and market conditions to predict future inventory needs. 
                This helps prevent stockouts and optimize inventory levels.
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