import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, KeyRound, Mail, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { userLoginSchema, userRegistrationSchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { z } from "zod";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

// Schema for password reset request
const passwordResetSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address" })
});

// Schema for password reset confirmation
const resetConfirmSchema = z.object({
  newPassword: z.string().min(8, { message: "Password must be at least 8 characters long" }),
  confirmNewPassword: z.string().min(8)
}).refine(data => data.newPassword === data.confirmNewPassword, {
  message: "Passwords do not match",
  path: ["confirmNewPassword"]
});

// Schema for two-factor authentication
const twoFactorAuthSchema = z.object({
  totpCode: z.string().min(6, { message: "Code must be at least 6 digits" })
});

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState<string>("login");
  const [isPasswordResetMode, setIsPasswordResetMode] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [twoFactorData, setTwoFactorData] = useState<any>(null);
  const { user, loginMutation, registerMutation } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();

  // Check for URL params on component load
  useEffect(() => {
    // Check for password reset token in URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const verified = urlParams.get('verified');
    
    if (token) {
      setResetToken(token);
      setIsPasswordResetMode(true);
    }
    
    if (verified === 'true') {
      setEmailVerified(true);
      setActiveTab("login");
      toast({
        title: "Email Verified",
        description: "Your email has been successfully verified. You can now log in.",
        variant: "success"
      });
    }
  }, [toast]);

  // Redirect if user is already logged in
  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="flex min-h-screen">
      {/* Left column - Form */}
      <div className="w-full md:w-1/2 flex flex-col justify-center items-center p-8">
        <div className="max-w-md w-full">
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">Inventory Manager</h1>
          <p className="text-muted-foreground mb-8">Sign in to access your inventory dashboard</p>
          
          {/* Email verification success message */}
          {emailVerified && (
            <Alert className="mb-6 bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-600">Email Verified</AlertTitle>
              <AlertDescription className="text-green-600">
                Your email has been successfully verified. You can now log in.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Two-factor authentication dialog */}
          {twoFactorRequired && (
            <TwoFactorAuthForm 
              isOpen={twoFactorRequired} 
              onClose={() => setTwoFactorRequired(false)}
              userData={twoFactorData}
            />
          )}
          
          {isPasswordResetMode && resetToken ? (
            <PasswordResetConfirmForm token={resetToken} onComplete={() => {
              setIsPasswordResetMode(false);
              setResetToken(null);
              setActiveTab("login");
            }} />
          ) : (
            <>
              {!isPasswordResetMode ? (
                <Tabs defaultValue="login" value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-8">
                    <TabsTrigger value="login">Login</TabsTrigger>
                    <TabsTrigger value="register">Register</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="login">
                    <LoginForm 
                      onForgotPassword={() => setIsPasswordResetMode(true)}
                      onTwoFactorRequired={(data) => {
                        setTwoFactorRequired(true);
                        setTwoFactorData(data);
                      }}
                    />
                  </TabsContent>
                  
                  <TabsContent value="register">
                    <RegisterForm onSuccess={(data) => {
                      setActiveTab("login");
                      if (data.requiresEmailVerification) {
                        toast({
                          title: "Registration Successful",
                          description: "Please check your email to verify your account.",
                          variant: "success"
                        });
                      }
                    }} />
                  </TabsContent>
                </Tabs>
              ) : (
                <PasswordResetRequestForm onCancel={() => setIsPasswordResetMode(false)} />
              )}
            </>
          )}
        </div>
      </div>
      
      {/* Right column - Hero */}
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-primary/90 to-purple-600/90 flex-col justify-center items-center p-8 text-white">
        <div className="max-w-md text-center">
          <h2 className="text-4xl font-bold mb-4">Manage Your Inventory with Ease</h2>
          <p className="mb-6 text-lg">
            Track inventory across multiple warehouses, generate purchase orders, and get real-time insights into your stock levels.
          </p>
          <div className="grid grid-cols-2 gap-4 text-left">
            <FeatureItem title="Real-time Tracking">
              Monitor inventory changes instantly across your organization
            </FeatureItem>
            <FeatureItem title="Smart Reordering">
              Automated suggestions when stock levels run low
            </FeatureItem>
            <FeatureItem title="Multi-warehouse">
              Manage inventory across different physical locations
            </FeatureItem>
            <FeatureItem title="Detailed Reports">
              Generate comprehensive reports in multiple formats
            </FeatureItem>
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginForm({ 
  onForgotPassword, 
  onTwoFactorRequired 
}: { 
  onForgotPassword: () => void,
  onTwoFactorRequired: (data: any) => void
}) {
  const { loginMutation } = useAuth();
  const { toast } = useToast();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [requiresEmailVerification, setRequiresEmailVerification] = useState(false);
  
  const form = useForm({
    resolver: zodResolver(userLoginSchema),
    defaultValues: {
      username: "",
      password: "",
      rememberMe: false
    }
  });
  
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      setLoginError(null);
      setRequiresEmailVerification(false);
      
      loginMutation.mutate(data, {
        onSuccess: (userData) => {
          if (userData.requiresTwoFactor) {
            onTwoFactorRequired(userData);
          }
        },
        onError: (error: any) => {
          if (error.response?.data) {
            setLoginError(error.response.data.message);
            if (error.response.data.requiresEmailVerification) {
              setRequiresEmailVerification(true);
            }
          } else {
            setLoginError("An error occurred during login. Please try again.");
          }
        }
      });
    } catch (error) {
      setLoginError("An error occurred during login. Please try again.");
    }
  });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Enter your credentials to sign in to your account</CardDescription>
      </CardHeader>
      <CardContent>
        {loginError && (
          <Alert className="mb-4 bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-600">Login Failed</AlertTitle>
            <AlertDescription className="text-red-600">
              {loginError}
            </AlertDescription>
          </Alert>
        )}
        
        {requiresEmailVerification && (
          <Alert className="mb-4 bg-amber-50 border-amber-200">
            <Mail className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-600">Email Verification Required</AlertTitle>
            <AlertDescription className="text-amber-600">
              Please check your email for the verification link. If you didn't receive an email, you can <Button variant="link" className="p-0 h-auto text-amber-600 font-semibold" onClick={async () => {
                try {
                  // Get the email from the form or prompt if not available
                  let email = "";
                  
                  // For login, username might be email or actual username
                  // Let's add a small form to collect email if needed
                  const usernameValue = form.getValues("username");
                  
                  // Check if username looks like an email
                  if (usernameValue && usernameValue.includes('@')) {
                    email = usernameValue;
                  } else {
                    // Create a dialog to ask for email
                    const promptEmail = window.prompt("Please enter your email address to receive a verification link:", "");
                    if (!promptEmail) return; // User cancelled
                    email = promptEmail;
                  }
                  
                  if (!email || !email.includes('@')) {
                    toast({
                      title: "Invalid Email",
                      description: "Please provide a valid email address.",
                      variant: "destructive"
                    });
                    return;
                  }
                  
                  // Call the resend verification email API
                  const response = await apiRequest("POST", "/api/resend-verification-email", { email });
                  const result = await response.json();
                  
                  // Show success message
                  toast({
                    title: "Verification Email Sent",
                    description: result.message || "If your email is registered, you will receive a new verification email.",
                    variant: "success"
                  });
                } catch (error) {
                  console.error("Error resending verification email:", error);
                  toast({
                    title: "Error",
                    description: "Failed to resend verification email. Please try again later.",
                    variant: "destructive"
                  });
                }
              }}>click here</Button> to request a new one.
            </AlertDescription>
          </Alert>
        )}
        
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your username" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Enter your password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="flex justify-between items-center">
              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox 
                        checked={field.value} 
                        onCheckedChange={field.onChange} 
                        id="rememberMe"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel htmlFor="rememberMe" className="text-sm font-medium text-muted-foreground">
                        Remember me
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />
              
              <Button variant="link" className="p-0" onClick={onForgotPassword}>
                Forgot password?
              </Button>
            </div>
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function RegisterForm({ onSuccess }: { onSuccess: (data: any) => void }) {
  const { registerMutation } = useAuth();
  const [registerError, setRegisterError] = useState<string | null>(null);
  
  const form = useForm({
    resolver: zodResolver(userRegistrationSchema),
    defaultValues: {
      username: "",
      password: "",
      confirmPassword: "",
      email: "",
      fullName: "",
      role: "viewer" as const
    }
  });
  
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      setRegisterError(null);
      
      registerMutation.mutate(data, {
        onSuccess: (response) => onSuccess(response),
        onError: (error: any) => {
          if (error.response?.data) {
            setRegisterError(error.response.data.message);
          } else {
            setRegisterError("An error occurred during registration. Please try again.");
          }
        }
      });
    } catch (error) {
      setRegisterError("An error occurred during registration. Please try again.");
    }
  });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Enter your details to create a new account</CardDescription>
      </CardHeader>
      <CardContent>
        {registerError && (
          <Alert className="mb-4 bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-600">Registration Failed</AlertTitle>
            <AlertDescription className="text-red-600">
              {registerError}
            </AlertDescription>
          </Alert>
        )}
        
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input placeholder="Choose a username" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="Enter your email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your full name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Create a password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="Confirm your password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Account...
                </>
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="flex justify-center text-sm text-muted-foreground">
        By creating an account, you agree to our Terms of Service and Privacy Policy
      </CardFooter>
    </Card>
  );
}

function PasswordResetRequestForm({ onCancel }: { onCancel: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { toast } = useToast();
  
  const form = useForm({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: {
      email: ""
    }
  });
  
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      setIsSubmitting(true);
      
      const response = await apiRequest("POST", "/api/password-reset-request", data);
      
      if (response.ok) {
        setIsSuccess(true);
        toast({
          title: "Reset Email Sent",
          description: "If your email is registered, you will receive a password reset link.",
          variant: "success"
        });
      } else {
        const errorData = await response.json();
        toast({
          title: "Error",
          description: errorData.message || "An error occurred. Please try again.",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset Password</CardTitle>
        <CardDescription>
          Enter your email address and we'll send you a link to reset your password
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isSuccess ? (
          <div className="space-y-4">
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertTitle className="text-green-600">Email Sent</AlertTitle>
              <AlertDescription className="text-green-600">
                If your email is registered, you will receive a password reset link shortly.
              </AlertDescription>
            </Alert>
            <Button className="w-full" onClick={onCancel}>
              Return to Login
            </Button>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-1/2"
                  onClick={onCancel}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="w-1/2"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordResetConfirmForm({ token, onComplete }: { token: string, onComplete: () => void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  
  const form = useForm({
    resolver: zodResolver(resetConfirmSchema),
    defaultValues: {
      newPassword: "",
      confirmNewPassword: ""
    }
  });
  
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      setIsSubmitting(true);
      setError(null);
      
      const response = await apiRequest("POST", "/api/password-reset", {
        token,
        newPassword: data.newPassword
      });
      
      if (response.ok) {
        setIsSuccess(true);
        toast({
          title: "Password Reset Successful",
          description: "Your password has been reset. You can now log in with your new password.",
          variant: "success"
        });
        
        // Delay to show success message
        setTimeout(onComplete, 2000);
      } else {
        const errorData = await response.json();
        setError(errorData.message || "Password reset failed. The token may be invalid or expired.");
      }
    } catch (error) {
      setError("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset Password</CardTitle>
        <CardDescription>
          Create a new password for your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert className="mb-4 bg-red-50 border-red-200">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-600">Reset Failed</AlertTitle>
            <AlertDescription className="text-red-600">
              {error}
            </AlertDescription>
          </Alert>
        )}
        
        {isSuccess ? (
          <Alert className="mb-4 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertTitle className="text-green-600">Password Reset</AlertTitle>
            <AlertDescription className="text-green-600">
              Your password has been reset successfully. You will be redirected to the login page.
            </AlertDescription>
          </Alert>
        ) : (
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Enter new password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="confirmNewPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Confirm new password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button 
                type="submit" 
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  "Reset Password"
                )}
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

function TwoFactorAuthForm({ 
  isOpen, 
  onClose, 
  userData 
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  userData: any 
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { loginMutation } = useAuth();
  
  const form = useForm({
    resolver: zodResolver(twoFactorAuthSchema),
    defaultValues: {
      totpCode: ""
    }
  });
  
  const onSubmit = form.handleSubmit(async (data) => {
    try {
      setIsSubmitting(true);
      setError(null);
      
      const response = await apiRequest("POST", "/api/2fa/verify", {
        totpCode: data.totpCode
      });
      
      if (response.ok) {
        const responseData = await response.json();
        
        toast({
          title: "Verification Successful",
          description: "Two-factor authentication successful",
          variant: "success"
        });
        
        // Update the auth state with the fully authenticated user
        if (responseData.user) {
          loginMutation.mutate({ 
            username: userData.username,
            password: "VERIFIED_BY_2FA", // Dummy value, won't be used
            twoFactorVerified: true
          }, {
            onSuccess: () => {
              onClose();
            }
          });
        }
      } else {
        const errorData = await response.json();
        setError(errorData.message || "Invalid verification code. Please try again.");
        form.reset();
      }
    } catch (error) {
      setError("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  });
  
  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
          <DialogDescription>
            Enter the verification code from your authenticator app
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {error && (
            <Alert className="mb-4 bg-red-50 border-red-200">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <AlertTitle className="text-red-600">Verification Failed</AlertTitle>
              <AlertDescription className="text-red-600">
                {error}
              </AlertDescription>
            </Alert>
          )}
          
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-4">
              <FormField
                control={form.control}
                name="totpCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Verification Code</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter 6-digit code" 
                        {...field} 
                        maxLength={6}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <Button 
                type="submit" 
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify"
                )}
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FeatureItem({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-white/80">{children}</p>
    </div>
  );
}