import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MapPin, ShieldCheck, Star, Users } from "lucide-react";

export default function AuthPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (user) {
      navigate("/");
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-background">
      <div className="max-w-5xl mx-auto px-6 py-16 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Badge variant="secondary" className="w-fit">SkillRadius</Badge>
          <h1 className="text-4xl font-bold tracking-tight">Hire trusted local talent in minutes.</h1>
          <p className="text-muted-foreground text-lg">
            Discover verified freelancers by skill, rate, distance, and language. Chat instantly and book with confidence.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="space-y-2">
                <MapPin className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Local matches</CardTitle>
                <CardDescription>Find vetted pros near your exact location.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="space-y-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Verified profiles</CardTitle>
                <CardDescription>Badges for qualifications and identity checks.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="space-y-2">
                <Star className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Trusted reviews</CardTitle>
                <CardDescription>Only completed jobs can be reviewed.</CardDescription>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="space-y-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Fast hiring</CardTitle>
                <CardDescription>Message and book in a single flow.</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Sign in to manage jobs, requests, and bookings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" placeholder="••••••••" />
            </div>
            <Button className="w-full">Continue</Button>
            <div className="text-sm text-muted-foreground">
              New to SkillRadius? <span className="text-primary">Create an account</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
