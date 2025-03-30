import { useEffect } from "react";
import { Download, RotateCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useElectron } from "./electron-provider";
import { appControls, isElectron } from "@/lib/electron-bridge";

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch (error) {
    return dateString;
  }
}

export const UpdateNotification = () => {
  const { updateAvailable, updateDownloaded, installUpdate } = useElectron();
  const { toast } = useToast();

  // Check for updates periodically
  useEffect(() => {
    if (!isElectron) return;

    // Check for updates on mount
    appControls.checkForUpdates();

    // Set up interval to check for updates (every 4 hours)
    const interval = setInterval(() => {
      appControls.checkForUpdates();
    }, 4 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // If not running in Electron, don't display anything
  if (!isElectron) {
    return null;
  }

  // No updates available or downloaded
  if (!updateAvailable && !updateDownloaded) {
    return null;
  }

  // Update is available and downloading
  if (updateAvailable && !updateDownloaded) {
    return (
      <Alert className="my-4 border-primary/50 bg-primary/10">
        <RotateCw className="h-4 w-4 animate-spin text-primary" />
        <AlertTitle className="text-primary">Update Available</AlertTitle>
        <AlertDescription>
          Version {updateAvailable.version} is downloading...
        </AlertDescription>
      </Alert>
    );
  }

  // Update is downloaded and ready to install
  if (updateDownloaded) {
    return (
      <Alert className="my-4 border-primary/50 bg-primary/10">
        <Download className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary">Update Ready</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <div>
            Version {updateDownloaded.version} ({formatDate(updateDownloaded.releaseDate)}) has been downloaded and is
            ready to install.
          </div>
          {updateDownloaded.releaseNotes && (
            <div className="mt-1 text-sm opacity-80">
              <strong>Release Notes:</strong> {updateDownloaded.releaseNotes}
            </div>
          )}
          <div className="mt-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => {
                toast({
                  title: "Installing Update",
                  description: "The application will restart to apply the update.",
                });
                // Allow the toast to show before restarting
                setTimeout(() => {
                  installUpdate();
                }, 1500);
              }}
            >
              Install & Restart
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
};