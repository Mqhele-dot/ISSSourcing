import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, addDays, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { type ReportFilter, type Category, type Warehouse, type Supplier, type ReportType } from "@shared/schema";

interface ReportFiltersProps {
  filter: ReportFilter;
  setFilter: (filter: ReportFilter) => void;
  categories?: Category[];
  warehouses?: Warehouse[];
  suppliers?: Supplier[];
  reportType: ReportType;
}

export function ReportFilters({ 
  filter, 
  setFilter, 
  categories, 
  warehouses, 
  suppliers,
  reportType 
}: ReportFiltersProps) {
  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: filter.startDate,
    to: filter.endDate
  });

  // Update parent filter when date range changes
  useEffect(() => {
    if (dateRange.from && dateRange.to) {
      setFilter({
        ...filter,
        startDate: dateRange.from,
        endDate: dateRange.to,
      });
    }
  }, [dateRange]);

  // Update date range control when filter changes externally
  useEffect(() => {
    setDateRange({
      from: filter.startDate,
      to: filter.endDate
    });
  }, [filter.startDate, filter.endDate]);

  // Helper to update date range
  const updateDateRange = (range: { from: Date | undefined; to: Date | undefined }) => {
    setDateRange(range);
  };

  // Date range presets
  const dateRangePresets = [
    { 
      label: "Last 7 days", 
      onClick: () => updateDateRange({ 
        from: addDays(new Date(), -7), 
        to: new Date() 
      })
    },
    { 
      label: "Last 30 days", 
      onClick: () => updateDateRange({ 
        from: addDays(new Date(), -30), 
        to: new Date() 
      })
    },
    { 
      label: "This month", 
      onClick: () => updateDateRange({ 
        from: startOfMonth(new Date()), 
        to: endOfMonth(new Date()) 
      })
    },
    { 
      label: "This year", 
      onClick: () => updateDateRange({ 
        from: startOfYear(new Date()), 
        to: endOfYear(new Date()) 
      })
    },
  ];

  // Clear all filters
  const clearFilters = () => {
    setFilter({});
    setDateRange({ from: undefined, to: undefined });
  };

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Report Filters</h3>
        {(filter.startDate || filter.categoryId || filter.warehouseId || filter.supplierId || filter.status || (filter.tags && filter.tags.length > 0)) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear all
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Date range filter */}
        <div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">Date Range</div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start text-left font-normal",
                  !dateRange.from && !dateRange.to && "text-neutral-500 dark:text-neutral-400"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y")} - {format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  "Select date range"
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="p-3 border-b border-neutral-200 dark:border-neutral-700">
                <div className="grid grid-cols-2 gap-2">
                  {dateRangePresets.map((preset, index) => (
                    <Button 
                      key={index} 
                      variant="outline" 
                      size="sm" 
                      onClick={preset.onClick}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(range) => {
                  if (range) {
                    updateDateRange({
                      from: range.from,
                      to: range.to || range.from // Make sure "to" is always defined when "from" is present
                    });
                  } else {
                    updateDateRange({ from: undefined, to: undefined });
                  }
                }}
                numberOfMonths={2}
                defaultMonth={dateRange.from}
              />
            </PopoverContent>
          </Popover>
        </div>
        
        {/* Category filter - for inventory reports */}
        {(reportType === "inventory" || reportType === "low-stock" || reportType === "value") && categories && categories.length > 0 && (
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">Category</div>
            <Select
              value={filter.categoryId?.toString() || ""}
              onValueChange={(value) => {
                setFilter({
                  ...filter,
                  categoryId: value ? parseInt(value) : undefined
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All categories</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id.toString()}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        {/* Warehouse filter - for inventory and reorder reports */}
        {(reportType === "inventory" || reportType === "reorder-requests") && warehouses && warehouses.length > 0 && (
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">Warehouse</div>
            <Select
              value={filter.warehouseId?.toString() || ""}
              onValueChange={(value) => {
                setFilter({
                  ...filter,
                  warehouseId: value ? parseInt(value) : undefined
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All warehouses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All warehouses</SelectItem>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id.toString()}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        {/* Supplier filter - for orders, requisitions, and reorder requests */}
        {(reportType === "purchase-orders" || reportType === "purchase-requisitions" || reportType === "reorder-requests") && 
          suppliers && suppliers.length > 0 && (
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">Supplier</div>
            <Select
              value={filter.supplierId?.toString() || ""}
              onValueChange={(value) => {
                setFilter({
                  ...filter,
                  supplierId: value ? parseInt(value) : undefined
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All suppliers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All suppliers</SelectItem>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id.toString()}>
                    {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        
        {/* Status filter - for orders, requisitions, and reorder requests */}
        {(reportType === "purchase-orders" || reportType === "purchase-requisitions" || reportType === "reorder-requests") && (
          <div>
            <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">Status</div>
            <Select
              value={filter.status || ""}
              onValueChange={(value) => {
                setFilter({
                  ...filter,
                  status: value || undefined
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All statuses</SelectItem>
                {reportType === "purchase-orders" && (
                  <>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="SENT">Sent</SelectItem>
                    <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
                    <SelectItem value="PARTIALLY_RECEIVED">Partially Received</SelectItem>
                    <SelectItem value="RECEIVED">Received</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  </>
                )}
                {reportType === "purchase-requisitions" && (
                  <>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                    <SelectItem value="CONVERTED">Converted</SelectItem>
                  </>
                )}
                {reportType === "reorder-requests" && (
                  <>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="APPROVED">Approved</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                    <SelectItem value="CONVERTED">Converted</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      
      {/* Active filters display */}
      {(filter.startDate || filter.categoryId || filter.warehouseId || filter.supplierId || filter.status || (filter.tags && filter.tags.length > 0)) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {filter.startDate && filter.endDate && (
            <Badge variant="outline" className="flex items-center gap-1">
              <span>Date: {format(filter.startDate, "MMM d")} - {format(filter.endDate, "MMM d, yyyy")}</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 p-0 ml-1" 
                onClick={() => setFilter({ ...filter, startDate: undefined, endDate: undefined })}
              >
                ×
              </Button>
            </Badge>
          )}
          
          {filter.categoryId && categories && (
            <Badge variant="outline" className="flex items-center gap-1">
              <span>Category: {categories.find(c => c.id === filter.categoryId)?.name}</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 p-0 ml-1" 
                onClick={() => setFilter({ ...filter, categoryId: undefined })}
              >
                ×
              </Button>
            </Badge>
          )}
          
          {filter.warehouseId && warehouses && (
            <Badge variant="outline" className="flex items-center gap-1">
              <span>Warehouse: {warehouses.find(w => w.id === filter.warehouseId)?.name}</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 p-0 ml-1" 
                onClick={() => setFilter({ ...filter, warehouseId: undefined })}
              >
                ×
              </Button>
            </Badge>
          )}
          
          {filter.supplierId && suppliers && (
            <Badge variant="outline" className="flex items-center gap-1">
              <span>Supplier: {suppliers.find(s => s.id === filter.supplierId)?.name}</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 p-0 ml-1" 
                onClick={() => setFilter({ ...filter, supplierId: undefined })}
              >
                ×
              </Button>
            </Badge>
          )}
          
          {filter.status && (
            <Badge variant="outline" className="flex items-center gap-1">
              <span>Status: {filter.status}</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 p-0 ml-1" 
                onClick={() => setFilter({ ...filter, status: undefined })}
              >
                ×
              </Button>
            </Badge>
          )}
          
          {filter.tags && filter.tags.length > 0 && filter.tags.map(tag => (
            <Badge key={tag} variant="outline" className="flex items-center gap-1">
              <span>Tag: {tag}</span>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-4 w-4 p-0 ml-1" 
                onClick={() => setFilter({ 
                  ...filter, 
                  tags: filter.tags?.filter(t => t !== tag) 
                })}
              >
                ×
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}