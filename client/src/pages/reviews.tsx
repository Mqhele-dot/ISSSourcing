import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";

const reviews = [
  {
    client: "Samantha K.",
    rating: 5,
    service: "Furniture Assembly",
    note: "Arrived on time and finished faster than expected. Clean work.",
    date: "2 days ago",
  },
  {
    client: "David M.",
    rating: 5,
    service: "Drywall Repair",
    note: "Great communication and the repair looks perfect after paint.",
    date: "Last week",
  },
  {
    client: "Nadia R.",
    rating: 4,
    service: "Plumbing",
    note: "Solved the leak quickly. Would book again.",
    date: "2 weeks ago",
  },
];

function Stars({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={i < value ? "h-4 w-4 text-amber-500" : "h-4 w-4 text-muted-foreground"}
        />
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Reviews</Badge>
        <h1 className="text-3xl font-semibold">Reputation & feedback</h1>
        <p className="text-muted-foreground">Only completed jobs can be reviewed.</p>
      </header>

      <div className="grid gap-4">
        {reviews.map((review) => (
          <Card key={`${review.client}-${review.service}`}>
            <CardHeader className="space-y-2">
              <CardTitle className="text-base flex items-center justify-between">
                <span>{review.client}</span>
                <span className="text-xs text-muted-foreground">{review.date}</span>
              </CardTitle>
              <CardDescription>{review.service}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Stars value={review.rating} />
              <p className="text-sm text-muted-foreground">{review.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
