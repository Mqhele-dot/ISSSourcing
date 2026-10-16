import { toast } from "@/hooks/use-toast";

export type ToastKind = "success" | "warning" | "error" | "info";

export type ToastMessage = {
  type: ToastKind;
  title: string;
  message: string;
};

export const toastStore = {
  push(input: ToastMessage) {
    toast({
      title: input.title,
      description: input.message,
      variant: input.type === "error" ? "destructive" : "default",
    });
  },
};
