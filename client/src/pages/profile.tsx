import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Globe, MapPin, ShieldCheck, Star } from "lucide-react";

const skills = ["Plumbing", "Electrical", "Appliance Repair", "Home Maintenance"];

export default function ProfilePage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Profile</Badge>
        <h1 className="text-3xl font-semibold">Freelancer profile</h1>
        <p className="text-muted-foreground">Showcase skills, experience, and availability to stand out.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Public details</CardTitle>
          <CardDescription>Visible to clients when they browse your profile.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Display name</label>
            <Input defaultValue="Jordan Patel" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Hourly rate</label>
            <Input defaultValue="$45/hr" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Primary location</label>
            <Input defaultValue="2.5 mi radius, Downtown" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Languages</label>
            <Input defaultValue="English, Hindi" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Short bio</label>
            <Textarea defaultValue="Licensed handyman with 8+ years of residential repair experience." />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Verification status
            </CardTitle>
            <CardDescription>Upload certificates to boost client trust.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Identity verified</p>
            <p>Trade certificate pending review</p>
            <Button variant="outline" size="sm">Upload certificate</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-primary" />
              Rating snapshot
            </CardTitle>
            <CardDescription>Your reputation at a glance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">4.8 ★</p>
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> 64 completed jobs</span>
              <span className="flex items-center gap-1"><Globe className="h-4 w-4" /> 92% repeat clients</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skills & services</CardTitle>
          <CardDescription>Add the services you want to be hired for.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <Badge key={skill} variant="outline">{skill}</Badge>
          ))}
          <Button variant="ghost" size="sm">+ Add skill</Button>
        </CardContent>
      </Card>
    </div>
  );
}
