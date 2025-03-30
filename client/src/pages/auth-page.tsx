import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Redirect } from "wouter";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { userLoginSchema, userRegistrationSchema } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState<string>("login");
  const { user, loginMutation, registerMutation } = useAuth();

  // Redirect if user is already logged in
  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div className="flex h-screen">
      {/* Left column - Form */}
      <div className="w-full md:w-1/2 flex flex-col justify-center items-center p-8">
        <div className="max-w-md w-full">
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary to-purple-500 bg-clip-text text-transparent">Inventory Manager</h1>
          <p className="text-muted-foreground mb-8">Sign in to access your inventory dashboard</p>
          
          <Tabs defaultValue="login" value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="register">Register</TabsTrigger>
            </TabsList>
            
            <TabsContent value="login">
              <LoginForm />
            </TabsContent>
            
            <TabsContent value="register">
              <RegisterForm onSuccess={() => setActiveTab("login")} />
            </TabsContent>
          </Tabs>
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

function LoginForm() {
  const { loginMutation } = useAuth();
  
  const form = useForm({
    resolver: zodResolver(userLoginSchema),
    defaultValues: {
      username: "",
      password: "",
      rememberMe: false
    }
  });
  
  const onSubmit = form.handleSubmit((data) => {
    loginMutation.mutate(data);
  });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Enter your credentials to sign in to your account</CardDescription>
      </CardHeader>
      <CardContent>
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
            
            <FormField
              control={form.control}
              name="rememberMe"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md p-4">
                  <FormControl>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={field.value}
                        onChange={field.onChange}
                      />
                      <label htmlFor="rememberMe" className="text-sm font-medium text-muted-foreground">
                        Remember me
                      </label>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
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

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { registerMutation } = useAuth();
  
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
  
  const onSubmit = form.handleSubmit((data) => {
    registerMutation.mutate(data, {
      onSuccess
    });
  });
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create an account</CardTitle>
        <CardDescription>Enter your details to create a new account</CardDescription>
      </CardHeader>
      <CardContent>
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

function FeatureItem({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-white/80">{children}</p>
    </div>
  );
}