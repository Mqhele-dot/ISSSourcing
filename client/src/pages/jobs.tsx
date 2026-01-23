import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, MapPin, MessageSquare, PlusCircle } from "lucide-react";

const jobRequests = [
  {
    title: "Kitchen cabinet installation",
    status: "Awaiting responses",
    budget: "$320 fixed",
    location: "2.8 mi away",
    date: "Today, 10:30",
  },
  {
    title: "Landing page design",
    status: "In progress",
    budget: "$55/hr",
    location: "Remote-friendly",
    date: "Tomorrow, 9:00",
  },
  {
    title: "Math tutoring - Grade 11",
    status: "Scheduled",
    budget: "$30/hr",
    location: "1.2 mi away",
    date: "Friday, 16:00",
  },
];

export default function JobsPage() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge variant="secondary" className="w-fit">Jobs</Badge>
          <h1 className="text-3xl font-semibold">Your job requests</h1>
          <p className="text-muted-foreground">Track requests, bookings, and active projects.</p>
        </div>
        <Button className="gap-2">
          <PlusCircle className="h-4 w-4" />
          Post a job
        </Button>
      </header>

      <div className="grid gap-4">
        {jobRequests.map((job) => (
          <Card key={job.title}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{job.title}</span>
                <Badge variant="outline">{job.status}</Badge>
              </CardTitle>
              <CardDescription>{job.budget}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {job.location}</span>
              <span className="flex items-center gap-2"><Calendar className="h-4 w-4" /> {job.date}</span>
              <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> 3 messages</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
