import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MapPin, Filter, Search, SlidersHorizontal } from "lucide-react";

const clusters = [
  { label: "Design", count: 14 },
  { label: "Development", count: 22 },
  { label: "Home Services", count: 11 },
  { label: "Creative", count: 9 },
];

export default function Discover() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Discover</Badge>
        <h1 className="text-3xl font-semibold">Browse local freelancers</h1>
        <p className="text-muted-foreground">Use filters to find the right skill, budget, and language match.</p>
      </header>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by skill, service, or name" />
        </div>
        <Button variant="outline" className="gap-2">
          <Filter className="h-4 w-4" />
          Filters
        </Button>
        <Button variant="secondary" className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Sort by distance
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Map view
          </CardTitle>
          <CardDescription>Hover over pins to see top-rated freelancers nearby.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative h-[360px] w-full overflow-hidden rounded-lg bg-gradient-to-br from-primary/10 via-muted to-background">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.15),transparent_55%)]" />
            <div className="absolute bottom-6 left-6 space-y-2 text-sm">
              {clusters.map((cluster) => (
                <div key={cluster.label} className="flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 shadow">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <span className="font-medium">{cluster.label}</span>
                  <span className="text-muted-foreground">{cluster.count}</span>
                </div>
              ))}
            </div>
            <div className="absolute right-8 top-8 rounded-lg bg-background/90 p-3 text-xs shadow">
              <p className="font-semibold">18 freelancers active now</p>
              <p className="text-muted-foreground">Avg. ETA: 15 mins</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
