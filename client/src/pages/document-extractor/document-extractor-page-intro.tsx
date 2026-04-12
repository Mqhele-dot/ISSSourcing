import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Page title + subtitle for the document extractor (split from main page for clarity). */
export function DocumentExtractorPageIntro() {
  return (
    <div className="flex flex-col space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">Document Extractor</h1>
      <p className="text-muted-foreground">
        Extract and process data from various document formats (PDF, Excel, CSV) into structured data.
      </p>
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/accounts-payable">Open AP workspace</Link>
        </Button>
      </div>
    </div>
  );
}
