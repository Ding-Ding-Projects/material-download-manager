import type { DownloadQueue } from "../../shared/types";

const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
export const QUEUE_SCHEDULE_POLL_MS = 15_000;

export function parseScheduleMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Returns whether a queue may start or continue work at the supplied local
 * time. An equal start/end pair is treated as an all-day window; a later end
 * than start is the ordinary same-day interval, and an earlier end is an
 * overnight interval.
 */
export function isQueueScheduleActive(queue: DownloadQueue, now = new Date()): boolean {
  if (!queue.scheduleEnabled) return true;
  const start = parseScheduleMinutes(queue.startAt);
  const end = parseScheduleMinutes(queue.endAt);
  if (queue.startAt && start === null) return false;
  if (queue.endAt && end === null) return false;
  if (start === null && end === null) return true;

  const current = now.getHours() * 60 + now.getMinutes();
  if (start === null) return current < end!;
  if (end === null) return current >= start;
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Small lifecycle-owned clock so queue timers can be started and stopped safely. */
export class QueueScheduleClock {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onTick: () => void,
    private readonly intervalMs = QUEUE_SCHEDULE_POLL_MS
  ) {}

  get isRunning() {
    return this.timer !== null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.onTick(), this.intervalMs);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Run one clock tick immediately, useful for lifecycle-safe callers/tests. */
  tickNow() {
    if (this.timer) this.onTick();
  }
}
