"use client";

import * as React from "react";
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  FilterFn,
  Row,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableToolbar } from "./DataTableToolbar";
import type { DataTableFilterableColumn, DataTableSearchableColumn } from "./types";
import { cn } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

const globalFilterFn: FilterFn<unknown> = (row, columnId, filterValue) => {
  const search = String(filterValue).toLowerCase();

  // Search through all column values
  const rowValues = row.getAllCells().map(cell => {
    const value = cell.getValue();
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });

  return rowValues.some(value => value.toLowerCase().includes(search));
};

interface FloatingScrollbarState {
  /** Shown while the table scrolls sideways and its own bottom edge is below the window. */
  visible: boolean;
  contentWidth: number;
  viewportWidth: number;
}

/**
 * A horizontal scrollbar pinned to the bottom of the window, kept in sync with the table's own,
 * so a wide table can be scrolled sideways without first scrolling down to its last row.
 */
function useFloatingHorizontalScrollbar(containerRef: React.RefObject<HTMLDivElement>) {
  const barRef = React.useRef<HTMLDivElement>(null);
  const [state, setState] = React.useState<FloatingScrollbarState>({ visible: false, contentWidth: 0, viewportWidth: 0 });

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") return;

    const measure = () => {
      const scrollsSideways = container.scrollWidth > container.clientWidth;
      const ownScrollbarBelowWindow = container.getBoundingClientRect().bottom > window.innerHeight;
      const next = {
        visible: scrollsSideways && ownScrollbarBelowWindow,
        contentWidth: container.scrollWidth,
        viewportWidth: container.clientWidth,
      };
      setState((previous) =>
        previous.visible === next.visible &&
        previous.contentWidth === next.contentWidth &&
        previous.viewportWidth === next.viewportWidth
          ? previous
          : next);
    };

    const followTable = () => {
      if (barRef.current && barRef.current.scrollLeft !== container.scrollLeft) {
        barRef.current.scrollLeft = container.scrollLeft;
      }
    };

    measure();
    container.addEventListener("scroll", followTable);
    window.addEventListener("resize", measure);
    // Captured, so the page scrolling inside any layout container is seen too.
    window.addEventListener("scroll", measure, true);
    const layoutObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    layoutObserver?.observe(container);
    layoutObserver?.observe(document.body);

    return () => {
      container.removeEventListener("scroll", followTable);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      layoutObserver?.disconnect();
    };
  }, [containerRef]);

  // Mounted or re-shown: start where the table currently is.
  React.useLayoutEffect(() => {
    if (state.visible && barRef.current && containerRef.current) {
      barRef.current.scrollLeft = containerRef.current.scrollLeft;
    }
  }, [state.visible, containerRef]);

  const onBarScroll = React.useCallback(() => {
    const container = containerRef.current;
    if (container && barRef.current && container.scrollLeft !== barRef.current.scrollLeft) {
      container.scrollLeft = barRef.current.scrollLeft;
    }
  }, [containerRef]);

  return { barRef, state, onBarScroll };
}

interface DataRowProps<TData> {
  row: Row<TData>;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string;
  compact: boolean;
  striped: boolean;
  index: number;
}

const DataRow = <TData,>({
    row,
    onRowClick,
    rowClassName,
    compact,
    striped,
    index,
  }: DataRowProps<TData>) => (
    <TableRow
      data-state={row.getIsSelected() && "selected"}
      className={cn(
        onRowClick && "cursor-pointer hover:bg-muted/50",
        striped && index % 2 === 0 && "bg-muted/20",
        rowClassName && rowClassName(row.original)
      )}
      onClick={() => onRowClick && onRowClick(row.original)}
    >
      {row.getVisibleCells().map((cell) => (
        <TableCell
          key={cell.id}
          className={cn(compact ? "px-2 py-1.5 text-xs" : "px-3 py-2")}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  );

export type { DataTableFilterOption, DataTableFilterableColumn, DataTableSearchableColumn } from "./types";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  filterableColumns?: DataTableFilterableColumn[];
  searchableColumns?: DataTableSearchableColumn[];
  searchPlaceholder?: string;
  showPagination?: boolean;
  showToolbar?: boolean;
  showColumnVisibility?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  emptyMessage?: string;
  loading?: boolean;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string;
  stickyHeader?: boolean;
  compact?: boolean;
  striped?: boolean;
  maxHeight?: string;
  /** Minimum table width (e.g. "1280px"); narrower containers scroll horizontally */
  minWidth?: string;
  /** Debounce delay for search in ms (default: 200ms) */
  searchDebounce?: number;
  /** Initial column visibility state (can be controlled externally for responsive columns) */
  columnVisibility?: VisibilityState;
  /** Callback when column visibility changes */
  onColumnVisibilityChange?: (visibility: VisibilityState) => void;
  /** Row selection state */
  rowSelection?: Record<string, boolean>;
  /** Callback when row selection changes */
  onRowSelectionChange?: (selection: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterableColumns = [],
  searchableColumns = [],
  searchPlaceholder = "Search...",
  showPagination = true,
  showToolbar = true,
  showColumnVisibility = true,
  pageSize = 10,
  pageSizeOptions = [10, 20, 30, 50, 100],
  emptyMessage = "No results found.",
  loading = false,
  onRowClick,
  rowClassName,
  stickyHeader = true, // Default to true for better UX
  compact = true, // Default to compact for data density
  striped = false,
  maxHeight = "calc(100vh - 280px)", // Default max height for viewport fitting
  minWidth,
  searchDebounce = 200, // Debounce search for performance
  columnVisibility: controlledColumnVisibility,
  onColumnVisibilityChange,
  rowSelection: controlledRowSelection,
  onRowSelectionChange,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [internalColumnVisibility, setInternalColumnVisibility] = React.useState<VisibilityState>({});
  const [internalRowSelection, setInternalRowSelection] = React.useState({});
  const [globalFilter, setGlobalFilter] = React.useState("");

  const columnVisibility = controlledColumnVisibility ?? internalColumnVisibility;
  const setColumnVisibility = onColumnVisibilityChange ?? setInternalColumnVisibility;

  const rowSelection = controlledRowSelection ?? internalRowSelection;
  const setRowSelection = onRowSelectionChange ?? setInternalRowSelection;

  const debouncedGlobalFilter = useDebounce(globalFilter, searchDebounce);

  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const floatingScrollbar = useFloatingHorizontalScrollbar(scrollContainerRef);

  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter: debouncedGlobalFilter,
    },
    enableRowSelection: true,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn,
    initialState: {
      pagination: {
        pageSize,
      },
    },
  });

  return (
    <div className="space-y-2">
      {showToolbar && (
        <DataTableToolbar
          table={table}
          filterableColumns={filterableColumns}
          searchableColumns={searchableColumns}
          searchPlaceholder={searchPlaceholder}
          showColumnVisibility={showColumnVisibility}
        />
      )}
      <div
        ref={scrollContainerRef}
        className={cn(
          "table-container rounded-md border bg-card overflow-auto",
          stickyHeader && "relative"
        )}
        style={{ maxHeight: stickyHeader ? maxHeight : undefined }}
      >
        {/* This container scrolls both ways (an inner scroller also held the sticky header), and
            the floating scrollbar below follows its horizontal position. */}
        <Table containerClassName="overflow-visible" style={minWidth ? { minWidth } : undefined}>
          <TableHeader className={cn(
            stickyHeader && "sticky top-0 bg-card z-10 shadow-sm"
          )}>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        compact ? "px-2 py-1.5 h-8 text-xs" : "px-3 py-2",
                        "font-semibold"
                      )}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-16 text-center"
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-muted-foreground text-sm">Loading...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row, index) => (
                <DataRow
                  key={row.id}
                  row={row}
                  onRowClick={onRowClick}
                  rowClassName={rowClassName}
                  compact={compact}
                  striped={striped}
                  index={index}
                />
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-16 text-center"
                >
                  <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                      />
                    </svg>
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {/* Pinned to the bottom of the window while the table's own horizontal scrollbar is below it. */}
      <div
        ref={floatingScrollbar.barRef}
        hidden={!floatingScrollbar.state.visible}
        aria-hidden
        data-testid="floating-horizontal-scrollbar"
        onScroll={floatingScrollbar.onBarScroll}
        className="sticky bottom-0 z-20 overflow-x-auto overflow-y-hidden rounded-md border bg-card"
        style={{ width: floatingScrollbar.state.viewportWidth + 2 }}
      >
        <div style={{ width: floatingScrollbar.state.contentWidth, height: 1 }} />
      </div>
      {showPagination && (
        <DataTablePagination table={table} pageSizeOptions={pageSizeOptions} />
      )}
    </div>
  );
}
