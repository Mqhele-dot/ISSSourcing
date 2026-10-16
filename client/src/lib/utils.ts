import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';

/**
 * A utility function that combines Tailwind CSS classes with conditional logic
 * Using clsx for conditionals and twMerge to properly merge Tailwind classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date as a relative string (e.g. "today", "yesterday", "2 days ago", etc.)
 * @param date The date to format
 * @param includeTime Whether to include the time in the formatted string
 * @returns A formatted string
 */
export function formatRelativeDate(date: Date | string | number | null | undefined, includeTime: boolean = false): string {
  if (!date) return 'Never';
  
  // Convert to Date object if it's not already
  const dateObj = date instanceof Date ? date : new Date(date);
  
  // Check for invalid date
  if (isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }

  // Format based on how recent the date is
  if (isToday(dateObj)) {
    return includeTime 
      ? `Today at ${format(dateObj, 'h:mm a')}` 
      : 'Today';
  } else if (isYesterday(dateObj)) {
    return includeTime 
      ? `Yesterday at ${format(dateObj, 'h:mm a')}` 
      : 'Yesterday';
  } else if (dateObj > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
    // Within the last week
    return formatDistanceToNow(dateObj, { addSuffix: true });
  } else {
    // Older than a week
    return includeTime 
      ? format(dateObj, 'MMM d, yyyy h:mm a') 
      : format(dateObj, 'MMM d, yyyy');
  }
}

/**
 * Format a number as a currency string
 * @param value The number to format
 * @param currency The currency code (e.g. USD, EUR, GBP)
 * @param locale The locale to use (e.g. en-US, fr-FR)
 * @returns A formatted currency string
 */
export function formatCurrency(
  value: number | null | undefined,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  if (value === null || value === undefined) return '-';
  
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Download a file from a Blob or raw string content.
 * Do not pass `URL.createObjectURL(blob)` here — non-Blob strings are wrapped as file *bytes*, so a `blob:http://...` string produces a broken tiny file.
 */
export function downloadFile(
  data: Blob | string,
  filename: string,
  mimeType?: string
): void {
  if (typeof data === "string" && data.startsWith("blob:")) {
    const link = document.createElement("a");
    link.href = data;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(data);
    }, 100);
    return;
  }
  const blob = data instanceof Blob 
    ? data 
    : new Blob([data], { type: mimeType || 'application/octet-stream' });
  
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  
  document.body.appendChild(link);
  link.click();
  
  // Clean up
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Download a Blob using `URL.createObjectURL` / `URL.revokeObjectURL` in one place (short delay before revoke for browser compatibility).
 */
export function downloadBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 100);
  }
}

export type StatusColorStyle = { bg: string; text: string; pulse?: boolean };

/**
 * Get the status of an inventory item based on its quantity and thresholds
 * @param itemOrQuantity Inventory item or current quantity
 * @param reorderPoint Quantity at which to reorder (when first arg is number)
 * @param lowStockThreshold Quantity considered "low stock" (when first arg is number)
 * @returns Status string: 'In Stock', 'Low Stock', 'Out of Stock', or 'Reorder'
 */
export function getItemStatus(
  itemOrQuantity: number | { quantity: number; reorderPoint?: number | null; lowStockThreshold?: number | null },
  reorderPoint?: number | null,
  lowStockThreshold?: number | null
): string {
  const q = typeof itemOrQuantity === 'number' ? itemOrQuantity : itemOrQuantity.quantity;
  const rp = typeof itemOrQuantity === 'number' ? reorderPoint : itemOrQuantity.reorderPoint;
  const lt = typeof itemOrQuantity === 'number' ? lowStockThreshold : itemOrQuantity.lowStockThreshold;
  if (q <= 0) {
    return 'Out of Stock';
  } else if (rp !== undefined && rp !== null && q <= rp) {
    return 'Reorder';
  } else if (lt !== undefined && lt !== null && q <= lt) {
    return 'Low Stock';
  } else {
    return 'In Stock';
  }
}

/**
 * Get the color for an inventory status
 * @param status The status: 'In Stock', 'Low Stock', 'Out of Stock', or 'Reorder'
 * @returns Object with bg, text, and optional pulse for Tailwind classes
 */
export function getStatusColor(status: string): StatusColorStyle {
  switch (status.toLowerCase()) {
    case 'in stock':
      return { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' };
    case 'low stock':
      return { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' };
    case 'out of stock':
      return { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', pulse: true };
    case 'reorder':
      return { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-300', pulse: true };
    default:
      return { bg: 'bg-muted', text: 'text-muted-foreground' };
  }
}

/**
 * Format a date with a specific format string
 * @param date The date to format
 * @param formatStr The format string (defaults to 'PPP')
 * @returns A formatted date string
 */
export function formatDate(
  date: Date | string | number | null | undefined,
  formatStr: string = 'PPP'
): string {
  if (!date) return 'N/A';
  
  // Convert to Date object if it's not already
  const dateObj = date instanceof Date ? date : new Date(date);
  
  // Check for invalid date
  if (isNaN(dateObj.getTime())) {
    return 'Invalid date';
  }
  
  // Format using date-fns
  return format(dateObj, formatStr);
}