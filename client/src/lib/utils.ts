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