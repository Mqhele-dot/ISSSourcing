import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { z } from "zod";

// Define form schema
const realtimeSettingsSchema = z.object({
  realTimeUpdatesEnabled: z.boolean(),
  lowStockAlertFrequency: z.number().int().min(1, "Alert frequency must be at least 1 minute"),
  autoReorderEnabled: z.boolean(),
});

type RealtimeSettingsFormType = z.infer<typeof realtimeSettingsSchema>;

export function RealtimeSettingsForm() {
  const { settings, updateSettings } = useSettings();

  // Create form
  const form = useForm<RealtimeSettingsFormType>({
    resolver: zodResolver(realtimeSettingsSchema),
    defaultValues: {
      realTimeUpdatesEnabled: settings.realTimeUpdatesEnabled ?? true,
      lowStockAlertFrequency: settings.lowStockAlertFrequency ?? 30,
      autoReorderEnabled: settings.autoReorderEnabled ?? false,
    },
  });

  // Submit handler
  function onSubmit(data: RealtimeSettingsFormType) {
    updateSettings.mutate(data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Real-Time Updates</CardTitle>
        <CardDescription>
          Configure real-time synchronization settings for inventory changes
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="realTimeUpdatesEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Enable Real-Time Updates</FormLabel>
                    <FormDescription>
                      Receive instant notifications for inventory changes
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="lowStockAlertFrequency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Low Stock Alert Frequency (minutes)</FormLabel>
                  <FormControl>
                    <Input 
                      type="number" 
                      {...field} 
                      onChange={(e) => field.onChange(Number(e.target.value))}
                      min={1}
                      max={1440} // 24 hours in minutes
                      disabled={!form.watch("realTimeUpdatesEnabled")}
                    />
                  </FormControl>
                  <FormDescription>
                    How often to check and send low stock alerts (in minutes)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="autoReorderEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!form.watch("realTimeUpdatesEnabled")}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Automatic Reorder Requests</FormLabel>
                    <FormDescription>
                      Automatically generate reorder requests when stock falls below threshold
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <p className="font-medium">About WebSocket Connection</p>
              <p className="mt-1">
                Real-time updates use WebSocket technology to deliver instant notifications. 
                You can monitor connection status on the Real-Time Updates page.
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