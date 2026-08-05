import { useMemo } from "react";
import type { DownloadItem } from "@shared/types";
import { useAppStore } from "../store/useAppStore";

function matchesFilter(item: DownloadItem, filter: ReturnType<typeof useAppStore.getState>["filter"]): boolean {
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

/** Applies the active sidebar filter, search text, and sort to `items`. */
export function useFilteredItems(): DownloadItem[] {
  const items = useAppStore((s) => s.items);
  const filter = useAppStore((s) => s.filter);
  const searchText = useAppStore((s) => s.searchText);
  const sort = useAppStore((s) => s.sort);

  return useMemo(() => {
    const query = searchText.trim().toLowerCase();
    let result = items.filter((item) => matchesFilter(item, filter));
    if (query) {
      result = result.filter((item) => item.fileName.toLowerCase().includes(query));
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
  }, [items, filter, searchText, sort]);
}
