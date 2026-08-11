import type { HistoryAccessState } from "../../shared/history";

/**
 * Tracks which trusted renderer contents have completed the history unlock
 * flow. The credential itself never enters this session object; it only holds
 * ephemeral renderer ids and is cleared when a window closes or explicitly
 * locks its history view.
 */
export class HistoryAccessSession {
  private readonly unlockedContents = new Set<number>();

  state(contentId: number, configured: boolean): HistoryAccessState {
    return {
      configured,
      unlocked: configured && this.unlockedContents.has(contentId),
    };
  }

  unlock(contentId: number): void {
    this.unlockedContents.add(contentId);
  }

  lock(contentId: number): void {
    this.unlockedContents.delete(contentId);
  }

  remove(contentId: number): void {
    this.lock(contentId);
  }

  assertUnlocked(contentId: number): void {
    if (!this.unlockedContents.has(contentId)) throw new Error("Local history is locked");
  }
}
