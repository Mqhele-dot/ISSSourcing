import { Link } from "wouter";
import { Settings, User, Monitor } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function MobileHubMorePage() {
  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="More"
        description="Settings and full desktop app. Master Data needs a wide screen (about 1024px+). Use Open desktop home below."
      />
      <div className="flex flex-col gap-2">
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href="/profile">
            <User className="h-5 w-5" />
            Profile
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-start gap-3 py-4">
          <Link href="/settings">
            <Settings className="h-5 w-5" />
            Settings
          </Link>
        </Button>
        <Button asChild variant="secondary" className="h-auto justify-start gap-3 py-4">
          <Link href="/">
            <Monitor className="h-5 w-5" />
            Open desktop home
          </Link>
        </Button>
      </div>
    </div>
  );
}
