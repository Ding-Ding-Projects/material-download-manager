import { DEFAULT_QUEUE_ID } from "@shared/types";
import { useAppStore } from "../store/useAppStore";
import {
  LinkAddIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  GridIcon,
} from "./icons";

const MENU_ITEMS = ["File", "Tasks", "Tools", "Help"];

export default function Toolbar() {
  const filter = useAppStore((s) => s.filter);
  const queues = useAppStore((s) => s.queues);
  const searchText = useAppStore((s) => s.searchText);
  const setSearchText = useAppStore((s) => s.setSearchText);
  const openAddDownload = useAppStore((s) => s.openAddDownload);
  const openQueues = useAppStore((s) => s.openQueues);
  const openSettings = useAppStore((s) => s.openSettings);
  const startQueue = useAppStore((s) => s.startQueue);
  const stopQueue = useAppStore((s) => s.stopQueue);
  const stopAllActive = useAppStore((s) => s.stopAllActive);

  const activeQueueId = filter.kind === "queue" ? filter.queueId : DEFAULT_QUEUE_ID;
  const activeQueue = queues.find((q) => q.id === activeQueueId);
  const activeQueueName = activeQueue?.name ?? "Default Queue";

  return (
    <div className="toolbar-wrap">
      <div className="menu-row">
        <div className="menu-items">
          {MENU_ITEMS.map((label) => (
            <span key={label} className="menu-item">
              <u>{label[0]}</u>
              {label.slice(1)}
            </span>
          ))}
        </div>
        <div className="search-box">
          <SearchIcon size={15} className="search-icon" />
          <input
            className="search-input"
            type="text"
            placeholder="Search in the List"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
      </div>

      <div className="toolbar">
        <button
          type="button"
          className="add-url-btn"
          onClick={() => openAddDownload()}
          title="Add a new download URL"
        >
          <LinkAddIcon size={16} />
          <span>Add URL</span>
          <span className="add-url-btn-accent">
            <LinkAddIcon size={14} />
          </span>
        </button>

        <div className="toolbar-divider" />

        <button
          type="button"
          className="toolbar-btn"
          onClick={() => void startQueue(activeQueueId)}
          title={`Start ${activeQueueName}`}
        >
          <PlayIcon size={18} />
          <span>Start Queue</span>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => void stopQueue(activeQueueId)}
          title={`Stop ${activeQueueName}`}
        >
          <StopIcon size={18} />
          <span>Stop Queue</span>
        </button>
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => stopAllActive()}
          title="Pause every active download"
        >
          <StopIcon size={18} />
          <span>Stop All</span>
        </button>

        <div className="toolbar-divider" />

        <button type="button" className="toolbar-btn" onClick={() => openQueues()}>
          <GridIcon size={18} />
          <span>Open Queues</span>
        </button>
        <button type="button" className="toolbar-btn" onClick={() => openSettings()}>
          <SettingsIcon size={18} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
