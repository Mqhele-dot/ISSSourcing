import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Shield, User, Mail, Key, Image as ImageIcon, Save, Eye, EyeOff, Upload, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { userPasswordChangeSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";

// Profile update schema
const profileUpdateSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters").max(100, "Full name cannot exceed 100 characters"),
  email: z.string().email("Please enter a valid email address"),
  warehouseId: z.number().nullable().optional(),
  profilePicture: z.string().nullable().optional(),
});

// Security preferences schema
const securityPreferencesSchema = z.object({
  twoFactorEnabled: z.boolean().default(false),
  emailNotifications: z.boolean().default(true),
  sessionTimeout: z.number().min(15).max(1440).default(60),
});

export default function ProfilePage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch user security preferences
  const { data: securityPreferences, isLoading: loadingPreferences } = useQuery({
    queryKey: ["/api/user/security-preferences"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/user/security-preferences");
        return await res.json();
      } catch (error) {
        // Return default preferences if not set yet
        return {
          twoFactorEnabled: false,
          emailNotifications: true,
          sessionTimeout: 60
        };
      }
    },
    enabled: !!user, // Only run if user is logged in
  });

  // Set up profile update form
  const profileForm = useForm({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: {
      fullName: user?.fullName || "",
      email: user?.email || "",
      warehouseId: user?.warehouseId || null,
      profilePicture: user?.profilePicture || null,
    },
  });

  // Set up security preferences form
  const securityForm = useForm({
    resolver: zodResolver(securityPreferencesSchema),
    defaultValues: {
      twoFactorEnabled: securityPreferences?.twoFactorEnabled || false,
      emailNotifications: securityPreferences?.emailNotifications || true,
      sessionTimeout: securityPreferences?.sessionTimeout || 60,
    },
  });

  // Set up password change form
  const passwordForm = useForm({
    resolver: zodResolver(userPasswordChangeSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  });

  // Update form values when security preferences data is loaded
  if (securityPreferences && !loadingPreferences) {
    securityForm.reset({
      twoFactorEnabled: securityPreferences.twoFactorEnabled,
      emailNotifications: securityPreferences.emailNotifications,
      sessionTimeout: securityPreferences.sessionTimeout,
    });
  }

  // Profile update mutation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: z.infer<typeof profileUpdateSchema>) => {
      const res = await apiRequest("PATCH", "/api/user/profile", data);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/user"], (oldData: any) => ({
        ...oldData,
        ...data,
      }));
      toast({
        title: "Profile Updated",
        description: "Your profile information has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message || "Could not update profile information",
        variant: "destructive",
      });
    },
  });

  // Security preferences update mutation
  const updateSecurityPreferencesMutation = useMutation({
    mutationFn: async (data: z.infer<typeof securityPreferencesSchema>) => {
      const res = await apiRequest("PATCH", "/api/user/security-preferences", data);
      return await res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/user/security-preferences"], data);
      toast({
        title: "Security Preferences Updated",
        description: "Your security preferences have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update Failed",
        description: error.message || "Could not update security preferences",
        variant: "destructive",
      });
    },
  });

  // Password change mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: z.infer<typeof userPasswordChangeSchema>) => {
      const res = await apiRequest("POST", "/api/user/change-password", data);
      return await res.json();
    },
    onSuccess: () => {
      passwordForm.reset();
      toast({
        title: "Password Changed",
        description: "Your password has been changed successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Password Change Failed",
        description: error.message || "Could not change password",
        variant: "destructive",
      });
    },
  });

  const handleProfileUpdate = profileForm.handleSubmit((data) => {
    updateProfileMutation.mutate(data);
  });

  const handleSecurityPreferencesUpdate = securityForm.handleSubmit((data) => {
    updateSecurityPreferencesMutation.mutate(data);
  });

  const handlePasswordChange = passwordForm.handleSubmit((data) => {
    changePasswordMutation.mutate(data);
  });

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row md:space-x-8">
        <div className="md:w-1/4 mb-6 md:mb-0">
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-24 w-24 mb-4">
                  <AvatarImage src={user.profilePicture || ""} alt={user.username} />
                  <AvatarFallback className="text-xl">{getInitials(user.fullName || user.username)}</AvatarFallback>
                </Avatar>
                <h2 className="text-2xl font-bold">{user.fullName || user.username}</h2>
                <p className="text-muted-foreground">{user.email}</p>
                <p className="mt-1 text-sm bg-primary/10 text-primary px-2 py-1 rounded-full">{user.role}</p>
                
                <Separator className="my-4" />
                
                <div className="w-full space-y-2 text-left">
                  <Button 
                    variant={activeTab === "profile" ? "default" : "ghost"} 
                    className="w-full justify-start"
                    onClick={() => setActiveTab("profile")}
                  >
                    <User className="mr-2 h-4 w-4" />
                    Profile
                  </Button>
                  <Button 
                    variant={activeTab === "security" ? "default" : "ghost"} 
                    className="w-full justify-start"
                    onClick={() => setActiveTab("security")}
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    Security
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          
          {/* Account Activity Card */}
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Account Activity</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div>
                <div className="text-muted-foreground">Last login</div>
                <div>Today, 8:26 AM</div>
              </div>
              <div>
                <div className="text-muted-foreground">Login location</div>
                <div>San Francisco, USA</div>
              </div>
              <div>
                <div className="text-muted-foreground">Account created</div>
                <div>January 5, 2024</div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        <div className="md:w-3/4">
          {activeTab === "profile" && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Profile Information</CardTitle>
                  <CardDescription>
                    Update your personal information and profile picture
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...profileForm}>
                    <form onSubmit={handleProfileUpdate} className="space-y-6">
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          control={profileForm.control}
                          name="fullName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Full Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Your full name" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        
                        <FormField
                          control={profileForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email Address</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="Your email address" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <FormField
                        control={profileForm.control}
                        name="profilePicture"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Profile Picture</FormLabel>
                            <FormControl>
                              <div className="space-y-4">
                                {field.value && (
                                  <div className="flex items-center gap-4">
                                    <Avatar className="h-16 w-16">
                                      <AvatarImage src={field.value} alt="Current profile picture" />
                                      <AvatarFallback>{getInitials(user.fullName || user.username)}</AvatarFallback>
                                    </Avatar>
                                    <Button 
                                      type="button" 
                                      variant="destructive"
                                      size="sm"
                                      onClick={async () => {
                                        if (confirm("Are you sure you want to remove your profile picture?")) {
                                          try {
                                            await apiRequest("DELETE", "/api/profile/picture");
                                            profileForm.setValue("profilePicture", null);
                                            queryClient.setQueryData(["/api/user"], (oldData: any) => ({
                                              ...oldData,
                                              profilePicture: null,
                                            }));
                                            toast({
                                              title: "Profile Picture Removed",
                                              description: "Your profile picture has been removed successfully."
                                            });
                                          } catch (error) {
                                            toast({
                                              title: "Error",
                                              description: "Failed to remove profile picture",
                                              variant: "destructive"
                                            });
                                          }
                                        }
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove
                                    </Button>
                                  </div>
                                )}
                                
                                <div className="flex items-center space-x-2">
                                  <Input
                                    id="picture-upload"
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      
                                      const formData = new FormData();
                                      formData.append('profilePicture', file);
                                      
                                      try {
                                        const res = await fetch('/api/profile/picture', {
                                          method: 'POST',
                                          body: formData,
                                          credentials: 'include'
                                        });
                                        
                                        if (!res.ok) {
                                          throw new Error('Failed to upload profile picture');
                                        }
                                        
                                        const data = await res.json();
                                        profileForm.setValue("profilePicture", data.profilePicture);
                                        
                                        // Update user data in the cache
                                        queryClient.setQueryData(["/api/user"], (oldData: any) => ({
                                          ...oldData,
                                          profilePicture: data.profilePicture,
                                        }));
                                        
                                        toast({
                                          title: "Profile Picture Updated",
                                          description: "Your profile picture has been updated successfully."
                                        });
                                      } catch (error) {
                                        toast({
                                          title: "Upload Failed",
                                          description: error instanceof Error ? error.message : "Failed to upload profile picture",
                                          variant: "destructive"
                                        });
                                      }
                                      
                                      // Reset the input
                                      e.target.value = '';
                                    }}
                                    ref={(input) => {
                                      // This prevents react-hook-form from controlling this input
                                      if (input) {
                                        input.name = 'profilePictureUpload';
                                      }
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                      document.getElementById('picture-upload')?.click();
                                    }}
                                  >
                                    <Upload className="h-4 w-4 mr-2" />
                                    Upload Picture
                                  </Button>
                                  <Button 
                                    type="button" 
                                    variant="ghost"
                                    onClick={() => {
                                      const url = prompt("Enter the URL to your profile picture");
                                      if (url) {
                                        profileForm.setValue("profilePicture", url);
                                      }
                                    }}
                                  >
                                    <ImageIcon className="h-4 w-4 mr-2" />
                                    Use URL
                                  </Button>
                                </div>
                              </div>
                            </FormControl>
                            <FormDescription>
                              Upload a profile picture or provide a URL to an image.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <div className="flex justify-end">
                        <Button 
                          type="submit" 
                          disabled={updateProfileMutation.isPending}
                        >
                          {updateProfileMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Saving...
                            </>
                          ) : (
                            <>
                              <Save className="mr-2 h-4 w-4" />
                              Save Changes
                            </>
                          )}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </CardContent>
              </Card>
              
              {/* Additional Contact Information */}
              <Card>
                <CardHeader>
                  <CardTitle>Contact Information</CardTitle>
                  <CardDescription>
                    Add additional contact details to your profile
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <FormLabel>Phone Number</FormLabel>
                      <Input placeholder="Your phone number" />
                    </div>
                    <div>
                      <FormLabel>Work Phone</FormLabel>
                      <Input placeholder="Your work phone" />
                    </div>
                    <div>
                      <FormLabel>Address</FormLabel>
                      <Input placeholder="Your address" />
                    </div>
                    <div>
                      <FormLabel>City</FormLabel>
                      <Input placeholder="Your city" />
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <Button variant="outline" className="mr-2">Cancel</Button>
                    <Button>Save Details</Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          
          {activeTab === "security" && (
            <div className="space-y-6">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Password</CardTitle>
                <CardDescription>
                  Change your password to keep your account secure
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...passwordForm}>
                  <form onSubmit={handlePasswordChange} className="space-y-6">
                    <FormField
                      control={passwordForm.control}
                      name="currentPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input 
                                type={showCurrentPassword ? "text" : "password"} 
                                placeholder="Your current password" 
                                {...field} 
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                className="absolute right-0 top-0 h-full px-3"
                                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                              >
                                {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                <span className="sr-only">
                                  {showCurrentPassword ? "Hide password" : "Show password"}
                                </span>
                              </Button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={passwordForm.control}
                        name="newPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>New Password</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input 
                                  type={showNewPassword ? "text" : "password"} 
                                  placeholder="Your new password" 
                                  {...field} 
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  className="absolute right-0 top-0 h-full px-3"
                                  onClick={() => setShowNewPassword(!showNewPassword)}
                                >
                                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                  <span className="sr-only">
                                    {showNewPassword ? "Hide password" : "Show password"}
                                  </span>
                                </Button>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      
                      <FormField
                        control={passwordForm.control}
                        name="confirmNewPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm New Password</FormLabel>
                            <FormControl>
                              <Input 
                                type="password" 
                                placeholder="Confirm your new password" 
                                {...field} 
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    
                    <div className="flex justify-end">
                      <Button 
                        type="submit" 
                        disabled={changePasswordMutation.isPending}
                      >
                        {changePasswordMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Changing Password...
                          </>
                        ) : (
                          <>
                            <Key className="mr-2 h-4 w-4" />
                            Change Password
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Security Preferences</CardTitle>
                <CardDescription>
                  Configure your account security settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...securityForm}>
                  <form onSubmit={handleSecurityPreferencesUpdate} className="space-y-6">
                    <FormField
                      control={securityForm.control}
                      name="twoFactorEnabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Two-Factor Authentication</FormLabel>
                            <FormDescription>
                              Enhance your account security with two-factor authentication
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
                      control={securityForm.control}
                      name="emailNotifications"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Security Email Notifications</FormLabel>
                            <FormDescription>
                              Receive email notifications about login attempts and security updates
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
                      control={securityForm.control}
                      name="sessionTimeout"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Session Timeout (minutes)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={15}
                              max={1440}
                              {...field}
                              onChange={e => field.onChange(parseInt(e.target.value) || 60)}
                            />
                          </FormControl>
                          <FormDescription>
                            Auto-logout after inactivity (15-1440 minutes)
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <div className="flex justify-end">
                      <Button 
                        type="submit" 
                        disabled={updateSecurityPreferencesMutation.isPending}
                      >
                        {updateSecurityPreferencesMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="mr-2 h-4 w-4" />
                            Save Preferences
                          </>
                        )}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Custom form description removed to fix duplicate declaration