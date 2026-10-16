import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function KpiCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex min-w-0 flex-row items-start justify-between gap-3 pb-2">
        <CardTitle className="min-w-0 text-base font-medium leading-snug text-balance">{title}</CardTitle>
        <span className="shrink-0">{icon}</span>
      </CardHeader>
      <CardContent className="min-w-0">
        <p className="break-words text-xl font-bold tabular-nums sm:text-2xl" title={String(value)}>{value}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function QueueList({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {rows.slice(0, 8).map((row) => (
            <li key={row} className="rounded-md bg-muted px-3 py-2">
              {row}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExceptionCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: ReactNode;
  items: Array<{ id: number; title: string; subtitle: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active exceptions.</p>
        ) : (
          items.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-md border p-3">
              <div className="font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.subtitle}</div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
