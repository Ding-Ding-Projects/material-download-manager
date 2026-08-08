import { useMemo } from "react";
import type { DownloadItem } from "@shared/types";
import { validateRegexPattern } from "@shared/regex";
import { useAppStore, type SidebarFilter } from "../store/useAppStore";
import { useIsolatedRegexBatch } from "./useIsolatedRegex";

function matchesFilter(item: DownloadItem, filter: SidebarFilter): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "category":
      return item.category === filter.category;
    case "status":
      return filter.status === "finished" ? item.status === "completed" : item.status !== "completed";
    case "queue":
      return item.queueId === filter.queueId;
    default:
      return true;
  }
}

export function getSearchValidationError(searchText: string, searchMode: "text" | "regex", searchFlags: string): string | null {
  if (searchMode !== "regex" || searchText.length === 0) return null;
  return validateRegexPattern(searchText, searchFlags);
}

export interface FilteredItemsState {
  items: DownloadItem[];
  regexError: string | null;
  regexPending: boolean;
}

/** Applies the active sidebar filter, search text/regex, and sort to `items`. */
export function useFilteredItems(): FilteredItemsState {
  const items = useAppStore((s) => s.items);
  const filter = useAppStore((s) => s.filter);
  const searchText = useAppStore((s) => s.searchText);
  const searchMode = useAppStore((s) => s.searchMode);
  const searchFlags = useAppStore((s) => s.searchFlags);
  const sort = useAppStore((s) => s.sort);
  const filteredBySidebar = useMemo(
    () => items.filter((item) => matchesFilter(item, filter)),
    [filter, items]
  );
  const regexSamples = useMemo(
    () => filteredBySidebar.map((item) => `${item.fileName}\n${item.url}`),
    [filteredBySidebar]
  );
  const regexBatch = useIsolatedRegexBatch(
    searchText,
    searchFlags,
    regexSamples,
    searchMode === "regex" && searchText.length > 0,
  );

  const filteredItems = useMemo(() => {
    let result = filteredBySidebar;
    if (searchText.length > 0) {
      if (searchMode === "text") {
        const normalizedQuery = searchText.toLocaleLowerCase();
        result = result.filter((item) =>
          `${item.fileName}\n${item.url}`.toLocaleLowerCase().includes(normalizedQuery)
        );
      } else {
        const validationError = getSearchValidationError(searchText, searchMode, searchFlags);
        if (validationError) {
          result = [];
        } else if (!regexBatch.evaluations) {
          result = [];
        } else {
          result = result.filter((_, index) => (regexBatch.evaluations?.[index]?.matches.length ?? 0) > 0);
        }
      }
    }

    const dir = sort.direction === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.fileName.localeCompare(b.fileName) * dir;
        case "size":
          return ((a.totalSize ?? -1) - (b.totalSize ?? -1)) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "speed":
          return (a.speed - b.speed) * dir;
        case "eta":
          return ((a.eta ?? Number.POSITIVE_INFINITY) - (b.eta ?? Number.POSITIVE_INFINITY)) * dir;
        case "dateAdded":
          return (a.dateAdded - b.dateAdded) * dir;
        default:
          return 0;
      }
    });

    return result;
  }, [filteredBySidebar, regexBatch.evaluations, searchFlags, searchMode, searchText, sort]);

  const regexActive = searchMode === "regex" && searchText.length > 0;
  return {
    items: filteredItems,
    regexError: regexActive && !regexBatch.pending ? regexBatch.error : null,
    regexPending: regexActive && regexBatch.pending,
  };
}
