import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Check, PaintBucket, AlertCircle } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type AppSettings, type AppSettingsForm } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import TutorialStep from "@/components/ui/tutorial-button";

const settingsFormSchema = z.object({
  companyName: z.string().min(2, "Company name must be at least 2 characters"),
  companyLogo: z.string().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9A-F]{6}$/i, "Must be a valid hex color"),
  dateFormat: z.string(),
  timeFormat: z.string(),
  currencySymbol: z.string().max(3, "Currency symbol must be 3 characters or less"),
  lowStockDefaultThreshold: z.number().int().min(1, "Must be at least 1"),
  allowNegativeInventory: z.boolean(),
});

export default function SettingsPage() {
  const { toast } = useToast();
  
  // Get app settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['/api/settings'],
    retry: 1,
  });

  // Update settings
  const updateSettings = useMutation({
    mutationFn: (data: Partial<AppSettingsForm>) => 
      apiRequest('/api/settings', { method: 'PUT', data }),
    onSuccess: () => {
      toast({
        title: "Settings updated",
        description: "Your application settings have been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
    },
    onError: (error) => {
      toast({
        title: "Error updating settings",
        description: error.message || "An unexpected error occurred",
        variant: "destructive",
      });
    },
  });

  // Settings form
  const form = useForm<AppSettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      companyName: "",
      companyLogo: "",
      primaryColor: "#0F172A",
      dateFormat: "YYYY-MM-DD",
      timeFormat: "HH:mm",
      currencySymbol: "$",
      lowStockDefaultThreshold: 10,
      allowNegativeInventory: false,
    },
  });

  // Update form when settings are loaded
  useEffect(() => {
    if (settings) {
      form.reset({
        companyName: settings.companyName,
        companyLogo: settings.companyLogo || "",
        primaryColor: settings.primaryColor,
        dateFormat: settings.dateFormat || "YYYY-MM-DD",
        timeFormat: settings.timeFormat || "HH:mm",
        currencySymbol: settings.currencySymbol || "$",
        lowStockDefaultThreshold: settings.lowStockDefaultThreshold || 10,
        allowNegativeInventory: settings.allowNegativeInventory || false,
      });
    }
  }, [settings, form]);

  // Handle settings update
  const handleUpdateSettings = (data: AppSettingsForm) => {
    updateSettings.mutate(data);
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Application Settings</h1>
          <p className="text-muted-foreground">
            Customize your inventory management system
          </p>
        </div>
        <TutorialStep page="settings" />
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-72" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-72" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleUpdateSettings)} className="space-y-6">
            <Tabs defaultValue="general" className="space-y-6">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="general">General</TabsTrigger>
                <TabsTrigger value="appearance">Appearance</TabsTrigger>
                <TabsTrigger value="inventory">Inventory</TabsTrigger>
              </TabsList>
              
              {/* General Settings */}
              <TabsContent value="general" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Company Information</CardTitle>
                    <CardDescription>
                      Set your company details for documents and branding
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="companyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company Name</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormDescription>
                            This will appear in the application header and on generated documents
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
                            <Input 
                              {...field} 
                              value={field.value || ""} 
                              placeholder="https://example.com/logo.png"
                            />
                          </FormControl>
                          <FormDescription>
                            Enter a URL for your company logo to display in the application
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    {form.watch("companyLogo") && (
                      <div className="p-4 border rounded-md mt-2">
                        <p className="text-sm font-medium mb-2">Logo Preview:</p>
                        <div className="h-16 flex items-center">
                          <img 
                            src={form.watch("companyLogo") as string} 
                            alt="Company logo preview" 
                            className="max-h-full" 
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLWFsZXJ0LWNpcmNsZSI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48bGluZSB4MT0iMTIiIHkxPSI4IiB4Mj0iMTIiIHkyPSIxMiIvPjxsaW5lIHgxPSIxMiIgeTE9IjE2IiB4Mj0iMTIiIHkyPSIxNiIvPjwvc3ZnPg==";
                              target.classList.add("text-red-500");
                              target.nextElementSibling?.classList.remove("hidden");
                            }}
                          />
                          <div className="ml-2 text-red-500 text-sm hidden">
                            <AlertCircle className="h-4 w-4 inline-block mr-1" />
                            Unable to load image. Please check the URL.
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader>
                    <CardTitle>Format Settings</CardTitle>
                    <CardDescription>
                      Configure date, time and currency formats
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                      <FormField
                        control={form.control}
                        name="dateFormat"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date Format</FormLabel>
                            <FormControl>
                              <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                {...field}
                              >
                                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                                <option value="MMM DD, YYYY">MMM DD, YYYY</option>
                              </select>
                            </FormControl>
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
                              <select
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                {...field}
                              >
                                <option value="HH:mm">24-hour (HH:mm)</option>
                                <option value="hh:mm A">12-hour (hh:mm AM/PM)</option>
                              </select>
                            </FormControl>
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
                              <Input {...field} maxLength={3} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Appearance Settings */}
              <TabsContent value="appearance" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Theme Customization</CardTitle>
                    <CardDescription>
                      Customize the look and feel of your application
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="primaryColor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Primary Color</FormLabel>
                          <FormControl>
                            <div className="flex space-x-2">
                              <Input 
                                {...field} 
                                pattern="^#[0-9A-F]{6}$" 
                                maxLength={7}
                              />
                              <div 
                                className="h-10 w-10 rounded-md border"
                                style={{ backgroundColor: field.value }}
                              />
                            </div>
                          </FormControl>
                          <FormDescription>
                            Enter a hex color code (e.g., #3B82F6)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="mt-6 space-y-2">
                      <p className="text-sm font-medium">Color Presets</p>
                      <div className="flex flex-wrap gap-2">
                        {['#0F172A', '#1E40AF', '#047857', '#B91C1C', '#7E22CE', '#0369A1'].map(color => (
                          <button
                            key={color}
                            type="button"
                            className="h-8 w-8 rounded-full border border-neutral-200 dark:border-neutral-700 flex items-center justify-center"
                            style={{ backgroundColor: color }}
                            onClick={() => form.setValue('primaryColor', color, { shouldDirty: true })}
                          >
                            {form.watch('primaryColor') === color && (
                              <Check className="h-4 w-4 text-white" />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="mt-6 pt-6 border-t">
                      <p className="text-sm font-medium mb-2">Theme Preview</p>
                      <div className="flex flex-wrap gap-3">
                        <Button variant="default" className="transition-colors duration-200" style={{ backgroundColor: form.watch('primaryColor') }}>
                          Primary Button
                        </Button>
                        <Button variant="outline">Secondary Button</Button>
                        <Button variant="ghost">Ghost Button</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
              
              {/* Inventory Settings */}
              <TabsContent value="inventory" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Inventory Behavior</CardTitle>
                    <CardDescription>
                      Configure how inventory items are managed
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField
                      control={form.control}
                      name="lowStockDefaultThreshold"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Default Low Stock Threshold</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min={1} 
                              {...field} 
                              onChange={e => field.onChange(parseInt(e.target.value))}
                            />
                          </FormControl>
                          <FormDescription>
                            Items with stock levels below this value will be marked as "Low Stock"
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="allowNegativeInventory"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">
                              Allow Negative Inventory
                            </FormLabel>
                            <FormDescription>
                              When enabled, inventory quantities can go below zero
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
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            
            <div className="flex justify-end">
              <Button 
                type="submit" 
                disabled={updateSettings.isPending || !form.formState.isDirty}
              >
                {updateSettings.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </form>
        </Form>
      )}
    </div>
  );
}