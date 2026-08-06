import { useMemo } from "react";
import type { DownloadItem } from "@shared/types";
import { normalizeRegexFlags, validateRegexPattern } from "@shared/regex";
import { useAppStore, type SidebarFilter } from "../store/useAppStore";

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

/** Applies the active sidebar filter, search text/regex, and sort to `items`. */
export function useFilteredItems(): DownloadItem[] {
  const items = useAppStore((s) => s.items);
  const filter = useAppStore((s) => s.filter);
  const searchText = useAppStore((s) => s.searchText);
  const searchMode = useAppStore((s) => s.searchMode);
  const searchFlags = useAppStore((s) => s.searchFlags);
  const sort = useAppStore((s) => s.sort);

  return useMemo(() => {
    const query = searchText.trim();
    let result = items.filter((item) => matchesFilter(item, filter));
    if (query) {
      if (searchMode === "text") {
        const normalizedQuery = query.toLocaleLowerCase();
        result = result.filter((item) =>
          `${item.fileName}\n${item.url}`.toLocaleLowerCase().includes(normalizedQuery)
        );
      } else {
        const validationError = validateRegexPattern(query, searchFlags);
        if (validationError) {
          result = [];
        } else {
          // Search uses the same JavaScript RegExp dialect and flags as the
          // builder, while removing only `g` so each item starts fresh.
          const matcher = new RegExp(query, normalizeRegexFlags(searchFlags).replace("g", ""));
          result = result.filter((item) => {
            matcher.lastIndex = 0;
            return matcher.test(`${item.fileName}\n${item.url}`);
          });
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
  }, [items, filter, searchText, searchMode, searchFlags, sort]);
}
