import type { AppSettings, FunnyLevel, LanguageMode } from "@shared/types";
import { effectivePresentationSettings } from "@shared/settings";

type SettingsLike = Pick<
  AppSettings,
  "languageMode" | "funnyLevelEnglish" | "funnyLevelCantonese" | "schoolModeEnabled" | "schoolModeName" | "showEmojis"
> | null | undefined;

function bilingual(mode: LanguageMode, english: string, cantonese: string): string {
  if (mode === "cantonese") return cantonese;
  if (mode === "bilingual") return `${english} · ${cantonese}`;
  return english;
}

function choose(level: FunnyLevel, variants: readonly string[]): string {
  return variants[Math.max(0, Math.min(variants.length - 1, level - 1))] ?? variants[0] ?? "";
}

export interface UiCopy {
  languageMode: LanguageMode;
  text: (english: string, cantonese: string) => string;
  funny: (english: readonly string[], cantonese: readonly string[]) => string;
  appSettings: string;
  downloads: string;
  queues: string;
  settings: string;
  searchDownloads: string;
  commandPalette: string;
  commandPaletteSearch: string;
  noMatchingCommands: string;
  fixPattern: string;
  notifications: string;
  notificationHistory: string;
  closeNotificationHistory: string;
  selectAll: string;
  invertSelection: string;
  dismissSelected: string;
  deleteSelected: string;
  exportSelected: string;
  noNotifications: string;
  tabSearch: string;
  moreTabs: string;
  newGroup: string;
  moveIntoGroup: string;
  groupName: string;
  close: string;
  cancel: string;
  displayName: string;
  displayNameHelper: string;
  displayNameInvalid: string;
  resetDisplayName: string;
  schoolModeTitle: string;
  schoolModeLabel: string;
  schoolModeNameLabel: string;
  schoolModeHelp: string;
  schoolModeCredentialStatus: string;
  schoolModeUnavailable: string;
  schoolModeCredentialConfigured: string;
  schoolModeCredentialUnconfigured: string;
  schoolModeCredentialSetup: string;
  schoolModeCredentialChange: string;
  schoolModeCredentialReset: string;
  schoolModeCredentialCurrentLabel: string;
  schoolModeCredentialNewLabel: string;
  schoolModeCredentialConfirmLabel: string;
  schoolModeCredentialSave: string;
  schoolModeCredentialCancel: string;
  schoolModeCredentialRecovery: string;
  schoolModeCredentialMismatch: string;
  schoolModeCredentialWrong: string;
  showEmojisLabel: string;
  showEmojisHelp: string;
  funnyPreview: string;
  metadataFallback: string;
  dimSumTitle: (dish: string) => string;
  downloadStatus: (name: string, status: string) => string;
  downloadError: (name: string, error: string) => string;
  removalComplete: (count: number, deleteFile: boolean) => string;
  removalIncomplete: (failed: number, total: number) => string;
  destructiveTitle: string;
  emergencyExit: string;
}

export function getUiCopy(settings: SettingsLike): UiCopy {
  const effective = settings ? effectivePresentationSettings(settings) : null;
  const languageMode = effective?.languageMode ?? "english";
  const englishLevel = effective?.funnyLevelEnglish ?? 1;
  const cantoneseLevel = effective?.funnyLevelCantonese ?? 3;
  const schoolModeName = settings?.schoolModeName ?? "School mode";
  const text = (english: string, cantonese: string) => bilingual(languageMode, english, cantonese);
  const funny = (english: readonly string[], cantonese: readonly string[]) =>
    bilingual(languageMode, choose(englishLevel, english), choose(cantoneseLevel, cantonese));

  return {
    languageMode,
    text,
    funny,
    appSettings: text("Application settings", "程式設定"),
    downloads: text("Downloads", "下載項目"),
    queues: text("Queues", "佇列"),
    settings: text("Settings", "設定"),
    searchDownloads: text("Search downloads", "搜尋下載項目"),
    commandPalette: text("Command palette", "指令面板"),
    commandPaletteSearch: text("Search commands, features, and settings", "搜尋指令、功能同設定"),
    noMatchingCommands: text("No matching commands.", "搵唔到相符指令。"),
    fixPattern: text("Fix the pattern to see commands.", "修正個模式先睇到指令。"),
    notifications: text("Notifications", "通知"),
    notificationHistory: text("Notification history", "通知紀錄"),
    closeNotificationHistory: text("Close notification history", "關閉通知紀錄"),
    selectAll: text("Select all", "全選"),
    invertSelection: text("Invert selection", "反選"),
    dismissSelected: text("Dismiss selected", "消除已選通知"),
    deleteSelected: text("Delete selected", "刪除已選通知"),
    exportSelected: text("Export selected", "匯出已選通知"),
    noNotifications: text("No notifications yet.", "暫時未有通知。"),
    tabSearch: text("Search tabs", "搜尋分頁"),
    moreTabs: text("More tabs", "更多分頁"),
    newGroup: text("New group", "新增群組"),
    moveIntoGroup: text("Move… into group…", "移去…群組…"),
    groupName: text("Group name", "群組名稱"),
    close: text("Close", "關閉"),
    cancel: text("Cancel", "取消"),
    displayName: text("App display name", "程式顯示名稱"),
    displayNameHelper: text(
      "Changes the name shown in the title bar and renderer notifications only. The app identity, data folder, installer, and update feed stay unchanged.",
      "只會改標題列同介面通知顯示嘅名稱；程式身份、資料夾、安裝程式同更新來源唔會郁。"
    ),
    displayNameInvalid: text("Enter a display name with at least one visible character.", "請輸入至少有一個可見字元嘅顯示名稱。"),
    resetDisplayName: text("Reset display name", "重設顯示名稱"),
    schoolModeTitle: schoolModeName,
    schoolModeLabel: text(`Use ${schoolModeName}`, `使用${schoolModeName}`),
    schoolModeNameLabel: text(`${schoolModeName} name`, `${schoolModeName}名稱`),
    schoolModeHelp: text(
      `When enabled, ${schoolModeName} uses serious English, hides Cantonese, bilingual, funny-level, and dim sum surfaces, and preserves your previous choices. This is a user-experience lock, not a security boundary.`,
      `開啟${schoolModeName}之後會用嚴肅英文，隱藏廣東話、雙語、玩味程度同點心表面，之前選擇會保留。呢個係使用體驗鎖，唔係安全邊界。`
    ),
    schoolModeCredentialStatus: text("Reset credential metadata", "重設 credential metadata"),
    schoolModeUnavailable: text(
      `${schoolModeName} cannot be turned off because its locally verified reset credential is unavailable. Delete the shared application-data folder only as the deliberate recovery route.`,
      `未能關閉${schoolModeName}，因為本機驗證嘅重設 credential 未有提供。只有刻意恢復先刪除共用應用程式資料夾。`
    ),
    schoolModeCredentialConfigured: text(
      "A reset credential is configured in the operating-system credential vault.",
      "重設 credential 已經存入作業系統憑證庫。"
    ),
    schoolModeCredentialUnconfigured: text(
      "No reset credential is configured yet. Set one before enabling this mode.",
      "仲未設定重設 credential，開啟呢個模式之前請先設定。"
    ),
    schoolModeCredentialSetup: text("Set reset credential", "設定重設 credential"),
    schoolModeCredentialChange: text("Change reset credential", "更改重設 credential"),
    schoolModeCredentialReset: text("Reset credential", "重設 credential"),
    schoolModeCredentialCurrentLabel: text("Current reset credential", "目前重設 credential"),
    schoolModeCredentialNewLabel: text("New reset credential", "新重設 credential"),
    schoolModeCredentialConfirmLabel: text("Confirm reset credential", "確認重設 credential"),
    schoolModeCredentialSave: text("Save credential", "儲存 credential"),
    schoolModeCredentialCancel: text("Cancel credential action", "取消 credential 操作"),
    schoolModeCredentialRecovery: text(
      "This is a user-experience lock, not security. Delete the app's local application-data folder to recover if the credential is forgotten.",
      "呢個係使用體驗鎖，唔係安全措施。如果唔記得 credential，刪除程式本機應用程式資料夾就可以恢復。"
    ),
    schoolModeCredentialMismatch: text("The two new credentials did not match.", "兩次新 credential 唔一致。"),
    schoolModeCredentialWrong: text("The reset credential did not match.", "重設 credential 唔正確。"),
    showEmojisLabel: text("Show emojis in dialogs and message boxes", "喺對話框同訊息框顯示 emoji"),
    showEmojisHelp: text(
      "When enabled, dialogs and message boxes may include a relevant decorative emoji. Buttons, field labels, accessible names, and exports stay factual.",
      "開啟後，對話框同訊息框可以加入相關裝飾 emoji；按鈕、欄位標籤、讀屏名稱同匯出內容仍然保持事實清楚。"
    ),
    funnyPreview: funny(
      ["Preview: Settings are ready.", "Preview: Settings are ready; the knobs are behaving.", "Preview: Settings are ready — the knobs have stopped plotting.", "Preview: Settings are ready — even the fussy knobs signed off.", "Preview: Settings are ready — the settings cupboard has achieved inner peace."],
      ["預覽：設定準備好喇。", "預覽：設定準備好喇，啲掣都幾乖。", "預覽：設定準備好喇，啲掣終於唔再搞事。", "預覽：設定準備好喇，連最麻煩嗰粒掣都話得。", "預覽：設定準備好喇，成個設定櫃終於悟道。"]
    ),
    metadataFallback: text("Metadata-only local fallback", "本機只用資料標籤嘅後備顯示"),
    dimSumTitle: (dish) => text(`Dim sum surprise · ${dish}`, `點心驚喜 · ${dish}`),
    downloadStatus: (name, status) => funny(
      [`${name}: ${status}.`, `${name}: ${status}. All gears remain accounted for.`, `${name}: ${status}. The download cogs are reporting in.`, `${name}: ${status}. Even the tiny progress gremlins filed the paperwork.`, `${name}: ${status}. The download orchestra has found its cue.`],
      [`${name}：${status}。`, `${name}：${status}，啲齒輪全部報到。`, `${name}：${status}，下載齒輪有交功課喇。`, `${name}：${status}，連細細隻進度鬼都交齊表格。`, `${name}：${status}，下載樂隊終於搵到拍子。`]
    ),
    downloadError: (name, error) => funny(
      [`${name}: ${error}`, `${name}: ${error} The reported error is unchanged.`, `${name}: ${error} The error is wearing a very official hat.`, `${name}: ${error} The facts remain exact; the gremlin does not get a rewrite.`, `${name}: ${error} The error has brought paperwork, but the next step is still the same.`],
      [`${name}：${error}`, `${name}：${error}，錯誤原文保持不變。`, `${name}：${error}，個錯誤戴住一頂好官腔嘅帽。`, `${name}：${error}，事實照舊準確，唔畀小鬼改稿。`, `${name}：${error}，個錯誤帶埋文件嚟，但下一步仍然一樣。`]
    ),
    removalComplete: (count, deleteFile) => funny(
      [`Removed ${count} item${count === 1 ? "" : "s"}${deleteFile ? " and deleted their files" : " from the list"}.`, `Removed ${count} item${count === 1 ? "" : "s"}${deleteFile ? " and deleted their files" : " from the list"}. The list is tidier.`, `Removed ${count} item${count === 1 ? "" : "s"}${deleteFile ? " and deleted their files" : " from the list"}. The clutter has been escorted out.`, `Removed ${count} item${count === 1 ? "" : "s"}${deleteFile ? " and deleted their files" : " from the list"}. The queue has filed its tiny goodbye.`, `Removed ${count} item${count === 1 ? "" : "s"}${deleteFile ? " and deleted their files" : " from the list"}. A ceremonial broom has been deployed.`],
      [`已移除${count}個項目${deleteFile ? "同刪除檔案" : "，亦由清單移走"}。`, `已移除${count}個項目${deleteFile ? "同刪除檔案" : "，亦由清單移走"}，清單清爽啲喇。`, `已移除${count}個項目${deleteFile ? "同刪除檔案" : "，亦由清單移走"}，雜物已被護送離場。`, `已移除${count}個項目${deleteFile ? "同刪除檔案" : "，亦由清單移走"}，佇列交咗份細細張告別信。`, `已移除${count}個項目${deleteFile ? "同刪除檔案" : "，亦由清單移走"}，清潔阿姨已經出動。`]
    ),
    removalIncomplete: (failed, total) => funny(
      [`${failed} of ${total} item${total === 1 ? "" : "s"} could not be removed.`, `${failed} of ${total} item${total === 1 ? "" : "s"} could not be removed; the rest completed.`, `${failed} of ${total} item${total === 1 ? "" : "s"} stayed put. The list has opinions.`, `${failed} of ${total} item${total === 1 ? "" : "s"} refused removal; exact failures remain available.`, `${failed} of ${total} item${total === 1 ? "" : "s"} dodged the broom. Review the reported failures.`],
      [`${failed}個（共${total}個）項目未能移除。`, `共${total}個入面有${failed}個未能移除，其餘已完成。`, `${failed}個（共${total}個）項目留低唔走，清單有自己嘅主意。`, `${failed}個（共${total}個）項目拒絕移除，詳細錯誤仍然保留。`, `${failed}個（共${total}個）項目避開掃把，請睇返錯誤詳情。`]
    ),
    destructiveTitle: text("Confirm destructive action", "確認破壞性操作"),
    emergencyExit: text("Emergency exit", "緊急退出"),
  };
}
