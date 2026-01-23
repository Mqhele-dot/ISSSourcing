import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export default function SettingsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Settings</Badge>
        <h1 className="text-3xl font-semibold">Account preferences</h1>
        <p className="text-muted-foreground">Manage notifications, availability, and safety settings.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Choose how you want to receive updates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">New job requests</p>
              <p className="text-sm text-muted-foreground">Alerts when a client wants to book you.</p>
            </div>
            <Switch defaultChecked />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Message notifications</p>
              <p className="text-sm text-muted-foreground">Stay in sync with ongoing chats.</p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>Set working hours and travel radius.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Weekly availability</label>
            <Input defaultValue="Mon - Fri, 08:00 - 18:00" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Service radius</label>
            <Input defaultValue="10 km" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Emergency availability</label>
            <Input defaultValue="Weekends by request" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Safety</CardTitle>
          <CardDescription>Keep your account protected and trusted.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button variant="outline">Update password</Button>
          <Button variant="outline">Enable 2-factor authentication</Button>
        </CardContent>
      </Card>
    </div>
  );
}
