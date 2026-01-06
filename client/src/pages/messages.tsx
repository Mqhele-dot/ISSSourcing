import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const conversations = [
  {
    name: "Amira Bello",
    preview: "Sure! I can send a revised estimate this afternoon.",
    time: "2m",
    unread: true,
  },
  {
    name: "Jordan Patel",
    preview: "I can stop by tomorrow morning for a quick inspection.",
    time: "1h",
    unread: false,
  },
  {
    name: "Carlos Nguyen",
    preview: "Let me know your launch date and I'll align the sprint.",
    time: "Yesterday",
    unread: false,
  },
];

export default function MessagesPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <header className="space-y-3">
        <Badge variant="secondary" className="w-fit">Messages</Badge>
        <h1 className="text-3xl font-semibold">Stay in touch</h1>
        <p className="text-muted-foreground">Chat with freelancers and keep job details aligned.</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search conversations" />
      </div>

      <div className="grid gap-4">
        {conversations.map((conversation) => (
          <Card key={conversation.name}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="text-base">{conversation.name}</CardTitle>
                <CardDescription>{conversation.preview}</CardDescription>
              </div>
              <div className="text-xs text-muted-foreground">{conversation.time}</div>
            </CardHeader>
            <CardContent>
              {conversation.unread && <Badge>New</Badge>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
