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
import { Loader2 } from "lucide-react";
import { SettingsAuthorityState } from "./settings-authority-state";

// Define form schema
const generalSettingsSchema = z.object({
  companyLogo: z.string().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, "Must be a valid hex color"),
  dateFormat: z.string().min(1, "Date format is required"),
  timeFormat: z.string().min(1, "Time format is required"),
});

export function GeneralSettingsForm() {
  const { settings, isLoading, error, refetch, updateSettings } = useSettings();

  // Create form
  const form = useForm<z.infer<typeof generalSettingsSchema>>({
    resolver: zodResolver(generalSettingsSchema),
    defaultValues: {
      companyLogo: settings?.companyLogo ?? null,
      primaryColor: settings?.primaryColor || '#0f766e',
      dateFormat: settings?.dateFormat || 'YYYY-MM-DD',
      timeFormat: settings?.timeFormat || 'HH:mm',
    },
  });

  React.useEffect(() => {
    if (!settings) return;
    form.reset({
      companyLogo: settings.companyLogo,
      primaryColor: settings.primaryColor || "#0f766e",
      dateFormat: settings.dateFormat || "YYYY-MM-DD",
      timeFormat: settings.timeFormat || "HH:mm",
    });
  }, [form, settings]);

  // Submit handler
  function onSubmit(data: z.infer<typeof generalSettingsSchema>) {
    if (settings) {
      updateSettings.mutate({
        ...settings,
        companyLogo: data.companyLogo,
        primaryColor: data.primaryColor,
        dateFormat: data.dateFormat,
        timeFormat: data.timeFormat,
      });
    }
  }

  if (!settings) return <SettingsAuthorityState loading={isLoading} error={error} onRetry={() => void refetch()} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance and display</CardTitle>
        <CardDescription>
          Branding and local display preferences. Organization identity and reporting currency are controlled above.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
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
                        aria-label="Primary color hex value"
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

            </div>

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
