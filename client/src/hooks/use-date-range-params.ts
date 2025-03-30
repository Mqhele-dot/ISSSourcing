import { useCallback, useState, useEffect } from 'react';
import { DateRange } from 'react-day-picker';
import { addDays, subDays } from 'date-fns';

export type DateRangeValue = '7d' | '30d' | '90d' | 'custom';

export function useDateRangeParams(defaultDays: number = 30) {
  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    const today = new Date();
    return {
      from: subDays(today, defaultDays),
      to: today,
    };
  });
  
  const [range, setRange] = useState<DateRangeValue>(
    defaultDays === 7 ? '7d' : 
    defaultDays === 30 ? '30d' : 
    defaultDays === 90 ? '90d' : 
    'custom'
  );

  const updateDateRange = useCallback((newRange: DateRange | undefined) => {
    setDateRange(newRange);
    
    // Determine if this is one of our preset ranges
    if (newRange) {
      const today = new Date();
      const { from } = newRange;
      
      if (from) {
        const daysDiff = Math.round(
          (today.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        if (Math.abs(daysDiff - 7) <= 1) {
          setRange('7d');
        } else if (Math.abs(daysDiff - 30) <= 1) {
          setRange('30d');
        } else if (Math.abs(daysDiff - 90) <= 1) {
          setRange('90d');
        } else {
          setRange('custom');
        }
      }
    }
  }, []);

  const updateRange = useCallback((newRangeValue: DateRangeValue) => {
    setRange(newRangeValue);
    
    const today = new Date();
    
    switch (newRangeValue) {
      case '7d':
        setDateRange({
          from: subDays(today, 7),
          to: today,
        });
        break;
      case '30d':
        setDateRange({
          from: subDays(today, 30),
          to: today,
        });
        break;
      case '90d':
        setDateRange({
          from: subDays(today, 90),
          to: today,
        });
        break;
      // For 'custom', we keep the existing date range
    }
  }, []);

  return {
    dateRange,
    updateDateRange,
    range,
    updateRange,
  };
}