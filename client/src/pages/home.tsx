import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MapPin, Star, Globe, Filter, Search, CheckCircle2, Briefcase, Zap } from "lucide-react";

const quickStats = [
  { label: "Skilled pros nearby", value: "128" },
  { label: "Avg. hourly rate", value: "$42/hr" },
  { label: "Median response time", value: "12 min" },
  { label: "Verified freelancers", value: "94%" },
];

const skillHighlights = ["UI/UX Design", "Mobile Development", "Home Repair", "Video Editing", "Tutoring", "Translation"];

const freelancers = [
  {
    name: "Amira Bello",
    title: "Product Designer",
    rate: "$65/hr",
    distance: "2.1 mi",
    rating: 4.9,
    reviews: 118,
    languages: ["English", "French"],
    skills: ["UX Research", "Figma", "Design Systems"],
    availability: "Available today",
  },
  {
    name: "Carlos Nguyen",
    title: "Full-stack Developer",
    rate: "$58/hr",
    distance: "3.4 mi",
    rating: 4.8,
    reviews: 96,
    languages: ["English", "Spanish"],
    skills: ["React", "Node.js", "PostgreSQL"],
    availability: "Next-day start",
  },
  {
    name: "Mina Okafor",
    title: "Event Photographer",
    rate: "$120/session",
    distance: "1.6 mi",
    rating: 5.0,
    reviews: 54,
    languages: ["English", "Yoruba"],
    skills: ["Portraits", "Corporate", "Retouching"],
    availability: "Weekend slots",
  },
  {
    name: "Jordan Patel",
    title: "Handyman & Home Repair",
    rate: "$45/hr",
    distance: "4.8 mi",
    rating: 4.7,
    reviews: 203,
    languages: ["English", "Hindi"],
    skills: ["Plumbing", "Drywall", "Furniture Assembly"],
    availability: "Same-day calls",
  },
];

const mapPins = [
  { label: "Designers", count: 24 },
  { label: "Developers", count: 32 },
  { label: "Skilled Trades", count: 18 },
  { label: "Creative", count: 21 },
];

export default function Home() {
  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <section className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="w-fit">Local Freelancer Network</Badge>
            <h1 className="text-4xl font-bold tracking-tight">Hire trusted talent right around the corner.</h1>
            <p className="text-muted-foreground max-w-2xl">
              Discover verified freelancers by skill, rate, distance, and language. Compare reviews, view availability,
              and book the right pro in minutes.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg">Post a job</Button>
            <Button size="lg" variant="outline">Invite freelancers</Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search skills, services, or freelancer names" />
          </div>
          <Button variant="secondary" className="gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </Button>
          <Button variant="outline" className="gap-2">
            <MapPin className="h-4 w-4" />
            Use my location
          </Button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {quickStats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-semibold">{stat.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Live talent map
            </CardTitle>
            <CardDescription>View freelancers clustered by skill and distance from you.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative h-[360px] w-full overflow-hidden rounded-lg bg-gradient-to-br from-primary/10 via-muted to-background">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.15),transparent_55%)]" />
              <div className="absolute bottom-6 left-6 space-y-2 text-sm">
                {mapPins.map((pin) => (
                  <div key={pin.label} className="flex items-center gap-2 rounded-full bg-background/90 px-3 py-1 shadow">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    <span className="font-medium">{pin.label}</span>
                    <span className="text-muted-foreground">{pin.count}</span>
                  </div>
                ))}
              </div>
              <div className="absolute right-8 top-10 flex flex-col items-end gap-3 text-xs">
                <div className="rounded-lg bg-background/90 p-3 shadow">
                  <p className="font-semibold">3.2 mi radius</p>
                  <p className="text-muted-foreground">92 freelancers active now</p>
                </div>
                <div className="rounded-lg bg-background/90 p-3 shadow">
                  <p className="font-semibold">Avg. rating 4.8</p>
                  <p className="text-muted-foreground">12 new reviews today</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recommended filters</CardTitle>
            <CardDescription>Refine by project type, budget, and language.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Popular skills</p>
              <div className="flex flex-wrap gap-2">
                {skillHighlights.map((skill) => (
                  <Badge key={skill} variant="outline">{skill}</Badge>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Budget range</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">Under $50/hr</Badge>
                <Badge variant="secondary">$50 - $100/hr</Badge>
                <Badge variant="secondary">Fixed price</Badge>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Language preference</p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">English</Badge>
                <Badge variant="outline">Spanish</Badge>
                <Badge variant="outline">French</Badge>
                <Badge variant="outline">Mandarin</Badge>
              </div>
            </div>
            <Button className="w-full" variant="outline">Save filter set</Button>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Freelancers near you</h2>
            <p className="text-muted-foreground">Compare rates, availability, reviews, and languages at a glance.</p>
          </div>
          <Button variant="secondary" className="gap-2">
            <Zap className="h-4 w-4" />
            See who can start now
          </Button>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {freelancers.map((freelancer) => (
            <Card key={freelancer.name} className="h-full">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{freelancer.name}</CardTitle>
                    <CardDescription>{freelancer.title}</CardDescription>
                  </div>
                  <Badge variant="secondary" className="gap-1">
                    <Star className="h-3 w-3" />
                    {freelancer.rating}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1"><Briefcase className="h-4 w-4" /> {freelancer.rate}</span>
                  <span className="flex items-center gap-1"><MapPin className="h-4 w-4" /> {freelancer.distance} away</span>
                  <span className="flex items-center gap-1"><Globe className="h-4 w-4" /> {freelancer.languages.join(", ")}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {freelancer.skills.map((skill) => (
                    <Badge key={skill} variant="outline">{skill}</Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Star className="h-4 w-4 text-amber-500" />
                    {freelancer.reviews} reviews
                  </div>
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    <CheckCircle2 className="h-4 w-4" />
                    {freelancer.availability}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button size="sm">View profile</Button>
                  <Button size="sm" variant="outline">Request quote</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Verified credentials</CardTitle>
            <CardDescription>We verify licenses, portfolios, and local references.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Transparent pricing</CardTitle>
            <CardDescription>Compare rates and fixed bids with no hidden fees.</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Multilingual support</CardTitle>
            <CardDescription>Filter by language to match your communication needs.</CardDescription>
          </CardHeader>
        </Card>
      </section>
    </div>
  );
}
