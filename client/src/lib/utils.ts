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
 * Download a file from a blob or data URL
 * @param data The data to download (Blob or base64 string)
 * @param filename The name to give the downloaded file
 * @param mimeType The MIME type of the file (if data is a base64 string)
 */
export function downloadFile(
  data: Blob | string,
  filename: string,
  mimeType?: string
): void {
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
 * Get the status of an inventory item based on its quantity and thresholds
 * @param currentQuantity Current quantity in stock
 * @param reorderPoint Quantity at which to reorder
 * @param lowStockThreshold Quantity considered "low stock"
 * @returns Status string: 'In Stock', 'Low Stock', 'Out of Stock', or 'Reorder'
 */
export function getItemStatus(
  currentQuantity: number,
  reorderPoint?: number | null,
  lowStockThreshold?: number | null
): string {
  if (currentQuantity <= 0) {
    return 'Out of Stock';
  } else if (reorderPoint !== undefined && reorderPoint !== null && currentQuantity <= reorderPoint) {
    return 'Reorder';
  } else if (lowStockThreshold !== undefined && lowStockThreshold !== null && currentQuantity <= lowStockThreshold) {
    return 'Low Stock';
  } else {
    return 'In Stock';
  }
}

/**
 * Get the color for an inventory status
 * @param status The status: 'In Stock', 'Low Stock', 'Out of Stock', or 'Reorder'
 * @returns CSS color class
 */
export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'in stock':
      return 'text-success';
    case 'low stock':
      return 'text-warning';
    case 'out of stock':
      return 'text-destructive';
    case 'reorder':
      return 'text-amber-500';
    default:
      return 'text-muted-foreground';
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