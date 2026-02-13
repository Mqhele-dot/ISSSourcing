import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Table } from "@tanstack/react-table";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
}

export function DataTablePagination<TData>({
  table,
}: DataTablePaginationProps<TData>) {
  return (
    <div className="bg-white dark:bg-neutral-800 px-5 py-3 flex items-center justify-between border-t border-neutral-200 dark:border-neutral-700">
      <div className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">
        {table.getFilteredRowModel().rows.length > 0 && (
          <p>
            Showing{" "}
            <span className="font-medium">
              {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
            </span>{" "}
            to{" "}
            <span className="font-medium">
              {Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                table.getFilteredRowModel().rows.length
              )}
            </span>{" "}
            of <span className="font-medium">{table.getFilteredRowModel().rows.length}</span> results
          </p>
        )}
      </div>

      <div className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
        <Button
          variant="outline"
          className="relative inline-flex items-center px-2 py-2 rounded-l-md text-sm font-medium"
          onClick={() => table.setPageIndex(0)}
          disabled={!table.getCanPreviousPage()}
        >
          <span className="sr-only">First</span>
          <ChevronsLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          className="relative inline-flex items-center px-2 py-2 text-sm font-medium"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          <span className="sr-only">Previous</span>
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {Array.from({ length: table.getPageCount() })
          .slice(
            Math.max(0, table.getState().pagination.pageIndex - 2),
            Math.min(
              table.getPageCount(),
              table.getState().pagination.pageIndex + 3
            )
          )
          .map((_, i) => {
            const pageIndex =
              Math.max(0, table.getState().pagination.pageIndex - 2) + i;
            return (
              <Button
                key={pageIndex}
                variant={
                  pageIndex === table.getState().pagination.pageIndex
                    ? "default"
                    : "outline"
                }
                className={`relative inline-flex items-center px-4 py-2 text-sm font-medium ${
                  pageIndex === table.getState().pagination.pageIndex
                    ? "z-10 bg-primary text-white"
                    : ""
                }`}
                onClick={() => table.setPageIndex(pageIndex)}
              >
                {pageIndex + 1}
              </Button>
            );
          })}

        {table.getPageCount() > 5 &&
          table.getState().pagination.pageIndex < table.getPageCount() - 3 && (
            <Button
              variant="outline"
              className="relative inline-flex items-center px-4 py-2 text-sm font-medium"
              disabled
            >
              ...
            </Button>
          )}

        {table.getPageCount() > 5 &&
          table.getState().pagination.pageIndex < table.getPageCount() - 3 && (
            <Button
              variant="outline"
              className="relative inline-flex items-center px-4 py-2 text-sm font-medium"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            >
              {table.getPageCount()}
            </Button>
          )}

        <Button
          variant="outline"
          className="relative inline-flex items-center px-2 py-2 text-sm font-medium"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          <span className="sr-only">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          className="relative inline-flex items-center px-2 py-2 rounded-r-md text-sm font-medium"
          onClick={() => table.setPageIndex(table.getPageCount() - 1)}
          disabled={!table.getCanNextPage()}
        >
          <span className="sr-only">Last</span>
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
