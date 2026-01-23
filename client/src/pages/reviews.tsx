import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";

const reviews = [
  { name: "K. Morris", rating: 5, text: "Fast response and high-quality work. Would hire again.", date: "2 days ago" },
  { name: "S. Dlamini", rating: 5, text: "Very professional and on time. Great communication.", date: "1 week ago" },
  { name: "J. Patel", rating: 4, text: "Good work overall. Slight delay but handled well.", date: "3 weeks ago" },
];

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className="h-4 w-4" style={{ opacity: i < rating ? 1 : 0.25 }} />
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Reviews</Badge>
        <h1 className="text-3xl font-semibold">Client feedback</h1>
        <p className="text-muted-foreground">Only completed jobs can be reviewed.</p>
      </header>

      <div className="grid gap-4">
        {reviews.map((review) => (
          <Card key={review.name + review.date}>
            <CardHeader className="space-y-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{review.name}</span>
                <span className="text-xs text-muted-foreground">{review.date}</span>
              </CardTitle>
              <CardDescription>
                <Stars rating={review.rating} />
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{review.text}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
