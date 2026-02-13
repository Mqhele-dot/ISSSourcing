import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <EmptyState
            icon={<AlertCircle className="h-8 w-8 text-destructive" />}
            title="404 Page Not Found"
            description="Did you forget to add the page to the router?"
          />
        </CardContent>
      </Card>
    </div>
  );
}
