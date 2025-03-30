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
import { Loader2, Shield, Lock, Key, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSettings } from "@/hooks/use-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Define schema for form validation
const securitySettingsSchema = z.object({
  enableTwoFactor: z.boolean().default(false),
  passwordExpiryDays: z.coerce.number().int().min(0, "Minimum is 0 (never expire)").max(365, "Maximum is 365 days"),
  maxLoginAttempts: z.coerce.number().int().min(1, "Minimum is 1 attempt").max(10, "Maximum is 10 attempts"),
  sessionTimeoutMinutes: z.coerce.number().int().min(5, "Minimum is 5 minutes").max(1440, "Maximum is 24 hours (1440 minutes)"),
  requireStrongPasswords: z.boolean().default(true),
  logActivityEnabled: z.boolean().default(true),
  accessTokenExpiryHours: z.coerce.number().int().min(1, "Minimum is 1 hour").max(720, "Maximum is 30 days (720 hours)"),
});

// Type for form data
type SecuritySettingsFormType = z.infer<typeof securitySettingsSchema>;

export function SecuritySettingsForm() {
  const { toast } = useToast();
  const { settings, updateSettings } = useSettings();

  // Create form with default values
  const form = useForm<SecuritySettingsFormType>({
    resolver: zodResolver(securitySettingsSchema),
    defaultValues: {
      enableTwoFactor: false,
      passwordExpiryDays: 90,
      maxLoginAttempts: 5,
      sessionTimeoutMinutes: 60,
      requireStrongPasswords: true,
      logActivityEnabled: true,
      accessTokenExpiryHours: 24,
    },
  });

  // Submit handler
  function onSubmit(data: SecuritySettingsFormType) {
    // In a real implementation, this would integrate with the settings API
    console.log("Security settings submitted:", data);
    
    toast({
      title: "Security settings updated",
      description: "Your security settings have been saved successfully.",
    });
  }

  return (
    <Card>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Security Settings
            </CardTitle>
            <CardDescription>
              Configure authentication and security preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="enableTwoFactor"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      <div className="flex items-center">
                        <Key className="h-4 w-4 mr-2" />
                        Enable Two-Factor Authentication
                      </div>
                    </FormLabel>
                    <FormDescription>
                      Require 2FA for all users
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
              name="requireStrongPasswords"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      <div className="flex items-center">
                        <Lock className="h-4 w-4 mr-2" />
                        Require Strong Passwords
                      </div>
                    </FormLabel>
                    <FormDescription>
                      Enforce password complexity requirements
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
              name="logActivityEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Activity Logging</FormLabel>
                    <FormDescription>
                      Log user actions for security auditing
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="passwordExpiryDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password Expiry (Days)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormDescription>
                      Days until passwords expire (0 = never)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="maxLoginAttempts"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Login Attempts</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormDescription>
                      Maximum failed login attempts before lockout
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sessionTimeoutMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      <div className="flex items-center">
                        <Clock className="h-4 w-4 mr-2" />
                        Session Timeout (Minutes)
                      </div>
                    </FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormDescription>
                      Inactive session timeout period
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="accessTokenExpiryHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Access Token Expiry (Hours)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormDescription>
                      JWT/API token expiration time
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-md bg-blue-50 p-4 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-400">
              <p className="font-medium">About Security Features</p>
              <p className="mt-1">
                Security settings help protect your data and ensure compliance with 
                industry standards. Two-factor authentication adds an extra layer of 
                security by requiring a verification code in addition to passwords.
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