import { BarChart3 } from "lucide-react";

type DashboardEmptyChartProps = {
  message: string;
  detail?: string;
};

export function DashboardEmptyChart({ message, detail }: DashboardEmptyChartProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted-foreground">
      <BarChart3 className="h-8 w-8 opacity-40" aria-hidden />
      <p>{message}</p>
      {detail ? <p className="max-w-sm text-xs">{detail}</p> : null}
    </div>
  );
}
