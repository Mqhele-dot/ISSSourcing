import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Star } from "lucide-react";

const reviews = [
  {
    freelancer: "Mina Okafor",
    rating: 5,
    summary: "Delivered stunning event photos and was right on time.",
    job: "Corporate headshots",
  },
  {
    freelancer: "Amira Bello",
    rating: 4.5,
    summary: "Great collaboration and clear updates throughout the project.",
    job: "Product design sprint",
  },
];

export default function ReviewsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Reviews</Badge>
        <h1 className="text-3xl font-semibold">Verified feedback</h1>
        <p className="text-muted-foreground">Only completed jobs can be reviewed to keep ratings trustworthy.</p>
      </header>

      <div className="grid gap-4">
        {reviews.map((review) => (
          <Card key={review.freelancer}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{review.freelancer}</span>
                <span className="flex items-center gap-1 text-sm">
                  <Star className="h-4 w-4 text-amber-500" />
                  {review.rating}
                </span>
              </CardTitle>
              <CardDescription>{review.job}</CardDescription>
            </CardHeader>
            <CardContent>{review.summary}</CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
