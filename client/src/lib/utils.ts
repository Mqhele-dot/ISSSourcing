import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { type InventoryItem, type ItemStatus } from "@shared/schema";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(new Date(date));
}

export function formatRelativeDate(date: Date | string): string {
  const now = new Date();
  const itemDate = new Date(date);
  
  const diffInMs = now.getTime() - itemDate.getTime();
  const diffInHours = diffInMs / (1000 * 60 * 60);
  const diffInDays = diffInHours / 24;
  
  if (diffInHours < 1) {
    const minutes = Math.floor(diffInMs / (1000 * 60));
    return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  } else if (diffInHours < 24) {
    const hours = Math.floor(diffInHours);
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  } else if (diffInDays < 7) {
    const days = Math.floor(diffInDays);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  } else {
    return formatDate(date);
  }
}

export function getItemStatus(item: InventoryItem): ItemStatus {
  if (item.quantity === 0) {
    return 'Out of Stock';
  } else if (item.quantity <= item.lowStockThreshold) {
    return 'Low Stock';
  } else {
    return 'In Stock';
  }
}

export function getStatusColor(status: ItemStatus): {
  bg: string;
  text: string;
  icon?: string;
  pulse?: boolean;
} {
  switch (status) {
    case 'In Stock':
      return {
        bg: 'bg-success/10 dark:bg-success/20',
        text: 'text-success',
      };
    case 'Low Stock':
      return {
        bg: 'bg-warning/10 dark:bg-warning/20',
        text: 'text-warning',
        icon: 'ri-alert-line',
        pulse: true,
      };
    case 'Out of Stock':
      return {
        bg: 'bg-error/10 dark:bg-error/20',
        text: 'text-error',
        icon: 'ri-error-warning-line',
      };
    default:
      return {
        bg: 'bg-neutral-100 dark:bg-neutral-700',
        text: 'text-neutral-500 dark:text-neutral-400',
      };
  }
}

export function getTotalValue(items: InventoryItem[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

export function downloadFile(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
