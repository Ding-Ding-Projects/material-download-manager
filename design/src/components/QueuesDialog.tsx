import { useState } from "react";
import { DEFAULT_QUEUE_ID } from "@shared/types";
import type { DownloadQueue } from "@shared/types";
import { useAppStore } from "../store/useAppStore";
import Dialog from "./Dialog";
import { GridIcon, PlayIcon, StopIcon, TrashIcon } from "./icons";

export default function QueuesDialog() {
  const queues = useAppStore((s) => s.queues);
  const closeQueues = useAppStore((s) => s.closeQueues);
  const updateQueue = useAppStore((s) => s.updateQueue);
  const deleteQueue = useAppStore((s) => s.deleteQueue);
  const startQueue = useAppStore((s) => s.startQueue);
  const stopQueue = useAppStore((s) => s.stopQueue);
  const createQueue = useAppStore((s) => s.createQueue);

  const [newQueueName, setNewQueueName] = useState("");

  async function handleAdd() {
    const name = newQueueName.trim() || `Queue ${queues.length + 1}`;
    await createQueue({ name, maxConcurrent: 2 });
    setNewQueueName("");
  }

  function patch(queue: DownloadQueue, changes: Partial<DownloadQueue>) {
    void updateQueue({ ...queue, ...changes });
  }

  return (
    <Dialog
      title="Queues"
      icon={<GridIcon size={16} />}
      onClose={closeQueues}
      width={520}
      className="queues-dialog"
      footer={
        <>
          <input
            className="input"
            type="text"
            placeholder="New queue name"
            value={newQueueName}
            onChange={(e) => setNewQueueName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleAdd()}
          />
          <button type="button" className="btn btn-primary" onClick={() => void handleAdd()}>
            Add Queue
          </button>
          <div className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={closeQueues}>
            Close
          </button>
        </>
      }
    >
      <div className="queue-list">
        <div className="queue-row queue-row-head">
          <span>Name</span>
          <span>Max Concurrent</span>
          <span>Items</span>
          <span />
        </div>
        {queues.map((queue) => (
          <div className="queue-row" key={queue.id}>
            <input
              className="input"
              type="text"
              value={queue.name}
              onChange={(e) => patch(queue, { name: e.target.value })}
            />
            <input
              className="input"
              type="number"
              min={1}
              max={32}
              value={queue.maxConcurrent}
              onChange={(e) => patch(queue, { maxConcurrent: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="queue-item-count">{queue.itemIds.length}</span>
            <div className="queue-row-actions">
              {queue.isRunning ? (
                <button type="button" className="icon-btn" title="Stop queue" onClick={() => void stopQueue(queue.id)}>
                  <StopIcon size={14} />
                </button>
              ) : (
                <button type="button" className="icon-btn" title="Start queue" onClick={() => void startQueue(queue.id)}>
                  <PlayIcon size={14} />
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                title="Delete queue"
                disabled={queue.id === DEFAULT_QUEUE_ID}
                onClick={() => void deleteQueue(queue.id)}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>
        ))}
        {queues.length === 0 && <div className="queue-empty">No queues yet.</div>}
      </div>
    </Dialog>
  );
}
