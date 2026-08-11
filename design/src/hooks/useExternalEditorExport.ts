import { useState } from "react";

export interface ExternalEditorExport {
  content: string;
  fileName: string;
}

type LocalizedText = (english: string, cantonese: string) => string;

/**
 * Keeps the editor handoff state beside the export that produced it. The
 * normal browser download remains the caller's responsibility, so this hook
 * is only an additive action for a successful local export.
 */
export function useExternalEditorExport(text: LocalizedText) {
  const [editorExport, setEditorExport] = useState<ExternalEditorExport | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [editorMessage, setEditorMessage] = useState<string | null>(null);

  async function openLastExportInEditor() {
    if (!editorExport) return;
    setEditorBusy(true);
    setEditorMessage(null);
    try {
      const result = await window.api.openExportInEditor(editorExport.content, editorExport.fileName);
      setEditorMessage(result.opened
        ? text(
          "Opened the exported file in Visual Studio Code; its export folder is the workspace root.",
          "已用 Visual Studio Code 開啟匯出檔案；匯出資料夾係 workspace root。"
        )
        : text(
          "Visual Studio Code could not open this export. Keep the local download or choose another editor in Settings.",
          "Visual Studio Code 未能開啟呢份匯出。可以保留本機下載，或者喺設定揀另一個編輯器。"
        ));
    } catch {
      setEditorMessage(text(
        "Visual Studio Code could not open this export. Keep the local download or choose another editor in Settings.",
        "Visual Studio Code 未能開啟呢份匯出。可以保留本機下載，或者喺設定揀另一個編輯器。"
      ));
    } finally {
      setEditorBusy(false);
    }
  }

  return {
    editorExport,
    setEditorExport,
    editorBusy,
    editorMessage,
    setEditorMessage,
    openLastExportInEditor,
  };
}
