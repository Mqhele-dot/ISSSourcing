import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableRecordOption = {
  value: string;
  label: string;
  keywords?: string;
  disabled?: boolean;
};

export function filterSearchableOptions(
  options: SearchableRecordOption[],
  query: string,
  maxSuggestions = 20,
): SearchableRecordOption[] {
  const term = query.trim().toLowerCase();
  return options
    .filter((option) => !term || `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(term))
    .slice(0, maxSuggestions);
}

type SearchableRecordComboboxProps = {
  value: string;
  options: SearchableRecordOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  testId?: string;
  maxSuggestions?: number;
  onSearchChange?: (query: string) => void;
  serverFiltered?: boolean;
};

export function SearchableRecordCombobox({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder = "Search records...",
  emptyMessage = "No matching records.",
  disabled = false,
  id,
  ariaLabel,
  testId,
  maxSuggestions = 20,
  onSearchChange,
  serverFiltered = false,
}: SearchableRecordComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const visibleOptions = useMemo(
    () => serverFiltered ? options.slice(0, maxSuggestions) : filterSearchableOptions(options, query, maxSuggestions),
    [maxSuggestions, options, query, serverFiltered],
  );

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) setQuery("");
    }}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          data-testid={testId}
          className="h-10 w-full min-w-0 justify-between px-3 font-normal"
        >
          <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={(next) => {
            setQuery(next);
            onSearchChange?.(next);
          }} placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {visibleOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  onSelect={() => {
                    onValueChange(option.value);
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {options.length > visibleOptions.length ? (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing {visibleOptions.length} of {options.length}. Refine the search to find another record.
            </p>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
