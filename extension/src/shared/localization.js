const UI_TEXT = {
  popupTitle: { en: "Send to Material Download Manager", yue: "傳送到 Material Download Manager" },
  popupSubtitle: { en: "A local handoff, with the door firmly closed to the wider internet.", yue: "本機交接，門口鎖實，唔會周街搵人。" },
  currentUrl: { en: "URL", yue: "網址" },
  urlHint: { en: "Use an http:// or https:// URL without embedded credentials.", yue: "請用唔帶帳戶密碼嘅 http:// 或 https:// 網址。" },
  sendUrl: { en: "Send URL", yue: "傳送網址" },
  openOptions: { en: "Open options", yue: "開啟選項" },
  disabledTitle: { en: "Handoff disabled because the endpoint was cleared", yue: "交接功能因端點被清除而暫停" },
  disabledBody: { en: "Restore the default local endpoint in Options, or paste the URL into the desktop app manually. A failed or unavailable adapter is reported as a failure; it is never guessed as success.", yue: "去選項恢復預設本機端點，或者手動將網址貼入桌面程式。adapter 失敗或者未啟動會如實報錯，唔會估佢成功。" },
  optionsRecovery: { en: "The default local adapter endpoint is configured. If the desktop app is not running or rejects a request, this extension reports the failure and keeps manual paste recovery available.", yue: "預設本機 adapter 端點已設定。如果桌面程式未啟動或者拒絕請求，extension 會如實報錯，仲保留手動貼上嘅恢復方法。" },
  readyTitle: { en: "Local handoff ready", yue: "本機交接準備好" },
  readyBody: { en: "Default endpoint: http://127.0.0.1:43771/v1/downloads. A 202 response means the adapter accepted the request for queueing, not that the download has finished.", yue: "預設端點：http://127.0.0.1:43771/v1/downloads。收到 202 代表 adapter 接受請求排隊，唔代表下載已經完成。" },
  lastStatus: { en: "Latest handoff status", yue: "最近交接狀態" },
  settingsDisclosure: { en: "Funny levels style every message, including warnings and errors; they never change the facts. You can reset them at any time.", yue: "玩味程度會調整所有訊息，包括警告同錯誤；事實內容唔會變。任何時候都可以重設。" },
  serviceWorkerUnavailable: { en: "The extension service worker did not answer. Reload the unpacked extension and try again.", yue: "Extension service worker 冇回應。請重新載入未封裝 extension，再試一次。" },
  invalidUrl: { en: "Enter a credential-free http or https URL.", yue: "請輸入唔帶帳戶密碼嘅 http 或 https 網址。" },
  handoffSuccess: { en: ["The URL was accepted by the local manager.", "The local manager accepted the URL.", "The local manager accepted the URL; tiny clipboard parade complete.", "The local manager caught the URL before it wandered off.", "The local manager accepted the URL; the little link has checked in safely."] , yue: ["本機程式已接收網址。", "本機程式收咗條網址。", "本機程式收咗條網址，飲茶前趕得切。", "本機程式捉住條網址，冇畀佢周圍走。", "本機程式已經接待條小網址，安全入住喇。"] },
  handoffDisabled: { en: ["Handoff is disabled until a loopback endpoint is configured.", "Handoff is waiting for a loopback endpoint.", "Handoff is waiting patiently by the local door for an endpoint.", "Handoff is paused because the local door has not been built yet.", "Handoff is holding this URL like a tiny suitcase until a local door appears."], yue: ["未設定本機端點，交接功能暫停。", "交接功能等緊本機端點。", "交接功能乖乖企喺本機門口等端點。", "本機門口未起好，所以交接功能暫停。", "交接功能拎住條網址小行李，等本機門口開門。"] },
  handoffFailed: { en: ["The local manager did not accept the URL.", "The local handoff could not accept the URL.", "The local handoff knocked, but nobody answered.", "The local handoff met a closed local door.", "The URL reached the local doorway, but the doorman declined it."], yue: ["本機程式未能接收網址。", "本機交接未能接收網址。", "本機交接敲咗門，但冇人應門。", "本機門口關咗，今次交接未成功。", "網址去到本機門口，但門神拒絕接待。"] },
  connectionSuccess: { en: ["The endpoint answered the protocol check.", "The endpoint is reachable and speaks protocol 1.", "The endpoint answered; the local handshake has had its tea.", "The endpoint answered with the right protocol, no interpretive dance required.", "The endpoint answered in protocol 1; the local handshake is wearing a tiny victory hat."], yue: ["端點回應協議檢查。", "端點可連線，識講 protocol 1。", "端點有回應，本機握手飲完茶喇。", "端點用正確協議回應，唔使跳舞估意思。", "端點用 protocol 1 回應，本機握手戴住勝利小帽。"] },
  connectionDisabled: { en: ["Connection testing is disabled because the endpoint was cleared.", "Restore the loopback endpoint before testing the connection.", "The connection test is waiting by the local door; the endpoint was cleared.", "No endpoint means no handshake; restore the local address before testing.", "The handshake brought flowers, but the endpoint address has gone on holiday."], yue: ["端點被清除，連線測試暫停。", "恢復本機端點先可以測試連線。", "連線測試喺本機門口等緊，但端點被清除咗。", "冇端點就冇握手，測試前請恢復本機地址。", "握手帶咗花，但端點地址去咗旅行。"] },
  connectionFailed: { en: ["The endpoint did not pass the protocol check.", "The endpoint did not answer the protocol check.", "The endpoint left the protocol check on read.", "The endpoint answered, but not in the language this extension understands.", "The endpoint sent the handshake back wearing the wrong protocol hat."], yue: ["端點未能通過協議檢查。", "端點冇回應協議檢查。", "端點睇咗協議檢查，但冇覆。", "端點有回應，但唔係 extension 識嘅語言。", "端點戴錯協議頂帽，握手要再嚟過。"] },
  invalidEndpoint: { en: "Use http://127.0.0.1:<port>/v1/downloads or http://localhost:<port>/v1/downloads.", yue: "請用 http://127.0.0.1:<port>/v1/downloads 或 http://localhost:<port>/v1/downloads。" },
  settingsSaved: { en: ["Settings saved.", "Settings are saved.", "Settings saved; the little preference drawer is tidy again.", "Settings saved; the controls have stopped wobbling.", "Settings saved; every preference is tucked into its tiny local drawer."], yue: ["設定已儲存。", "設定收好喇。", "設定已儲存，偏好抽屜又整齊喇。", "設定已儲存，控制掣唔再搖搖欲墜。", "設定已儲存，全部偏好乖乖住入本機小抽屜。"] },
  settingsReset: { en: ["Settings reset to their shipped values.", "Settings are back to the shipped values.", "Settings have returned to their factory little seats.", "Settings reset; the preference furniture is back where it started.", "Settings have marched home to the shipped defaults in a tiny parade."], yue: ["設定已重設為隨程式提供嘅值。", "設定返晒原本提供嘅值。", "設定返咗廠方小座位。", "設定已重設，偏好家具返晒起點。", "設定排住小隊返屋企，回到原本提供嘅值。"] },
  settingsImported: { en: ["Settings imported.", "Settings file imported.", "Settings imported; the preference suitcase unpacked neatly.", "Settings imported; no preference socks were lost.", "Settings imported; the local preference suitcase is fully unpacked."], yue: ["設定已匯入。", "設定檔匯入完成。", "設定已匯入，偏好行李開得好整齊。", "設定已匯入，冇一隻偏好襪仔失蹤。", "設定已匯入，本機偏好行李全部安頓好。"] },
  settingsExported: { en: ["Settings export is ready.", "Settings export is ready to download.", "Settings export is ready; the preference parcel is labelled.", "Settings export is ready, with every setting accounted for.", "Settings export is ready; the preference parcel has a very serious tiny label."], yue: ["設定匯出檔準備好。", "設定匯出檔可以下載喇。", "設定匯出檔準備好，偏好包裹貼好標籤。", "設定匯出檔準備好，逐項設定都有數。", "設定匯出檔準備好，偏好包裹貼咗一張超認真小標籤。"] },
  copyFailed: { en: ["The pattern could not be copied.", "Copying the pattern did not work.", "The clipboard declined the pattern politely.", "The pattern tried to leave, but the clipboard was out.", "The clipboard gave the pattern a tiny rain check."], yue: ["模式未能複製。", "複製模式失敗。", "剪貼簿好有禮貌咁拒絕咗模式。", "模式想出門口，但剪貼簿唔喺度。", "剪貼簿畀模式一張小小改期通知。"] },
  regexInvalid: { en: "The pattern is invalid or exceeds the local safety limit.", yue: "模式無效，或者超出本機安全限制。" },
  regexNoMatches: { en: "No matches in the sample.", yue: "樣本文字冇符合項目。" },
  regexMatches: { en: "{{count}} match(es) in the sample.", yue: "樣本文字有 {{count}} 個符合項目。" },
  regexPatternCopied: { en: ["Pattern copied.", "Pattern copied to the clipboard.", "Pattern copied; the clipboard has a new tiny resident.", "Pattern copied; the clipboard accepted its regex paperwork.", "Pattern copied; the clipboard is now guarding a small pattern dragon."], yue: ["模式已複製。", "模式已複製到剪貼簿。", "模式已複製，剪貼簿多咗位小住客。", "模式已複製，剪貼簿收妥 regex 文件。", "模式已複製，剪貼簿而家守住一條小模式龍。"] },
  optionsTitle: { en: "Extension options", yue: "Extension 選項" },
  optionsSubtitle: { en: "Configure a bounded local handoff and the way this extension speaks to you.", yue: "設定受限制嘅本機交接，同埋 extension 點樣同你講嘢。" },
  optionsSections: { en: "Extension options sections", yue: "Extension 選項分頁" },
  settingsSearch: { en: "Search settings", yue: "搜尋設定" },
  regexBuilder: { en: "Regex builder", yue: "Regex 建構器" },
  regexBuilderDescription: { en: "Build a JavaScript regular expression locally. Plain-text search stays the default.", yue: "喺本機建立 JavaScript 正則表達式。純文字搜尋仍然係預設。" },
  pattern: { en: "Pattern", yue: "模式" },
  flags: { en: "Flags", yue: "Flags" },
  sampleText: { en: "Sample text", yue: "樣本文字" },
  guidedFragments: { en: "Guided fragments", yue: "引導片段" },
  literal: { en: "Literal", yue: "字面文字" },
  characterClass: { en: "Character class", yue: "字元類別" },
  startAnchor: { en: "Start anchor", yue: "開頭錨點" },
  group: { en: "Group", yue: "群組" },
  alternation: { en: "Alternation", yue: "替代" },
  quantifier: { en: "Quantifier", yue: "量詞" },
  applyPattern: { en: "Use pattern for search", yue: "用模式搜尋" },
  copyPattern: { en: "Copy pattern", yue: "複製模式" },
  exportPattern: { en: "Export pattern", yue: "匯出模式" },
  connectionTab: { en: "Connection", yue: "連線" },
  preferencesTab: { en: "Preferences", yue: "偏好" },
  helpTab: { en: "Help", yue: "說明" },
  endpointLabel: { en: "Local handoff endpoint", yue: "本機交接端點" },
  endpointHelp: { en: "Default: http://127.0.0.1:43771/v1/downloads. Only loopback HTTP with an explicit port and the exact /v1/downloads path is accepted.", yue: "預設：http://127.0.0.1:43771/v1/downloads。只接受本機 HTTP、明確 port，同埋準確嘅 /v1/downloads 路徑。" },
  useDefaultEndpoint: { en: "Use default endpoint", yue: "使用預設端點" },
  testConnection: { en: "Test connection", yue: "測試連線" },
  connectionDisabledTitle: { en: "Recovery state: the endpoint was cleared", yue: "恢復狀態：端點被清除" },
  connectionDisabledBody: { en: "The Electron loopback adapter is implemented at the default endpoint. This state appears only when the endpoint setting is empty. Restore the default endpoint or use the manual paste path; an unavailable adapter remains a visible failure.", yue: "Electron 本機 adapter 已經喺預設端點實作好。呢個狀態只會喺端點設定留空時出現。請恢復預設端點，或者用手動貼上網址；adapter 未能使用會清楚顯示失敗。" },
  managerNameLabel: { en: "Manager display name", yue: "管理器顯示名稱" },
  managerNameHelp: { en: "This changes the extension’s labels only; it does not change the desktop app identity or data folder.", yue: "只會改 extension 標籤；唔會改桌面程式身份或者資料夾。" },
  resetManagerName: { en: "Reset name", yue: "重設名稱" },
  languageLabel: { en: "Language mode", yue: "語言模式" },
  languageHelp: { en: "Choose English, playful Hong Kong-style Cantonese, or bilingual copy.", yue: "選擇英文、玩味香港式廣東話，或者雙語文字。" },
  languageEnglish: { en: "English", yue: "英文" },
  languageCantonese: { en: "Playful Hong Kong Cantonese", yue: "玩味香港廣東話" },
  languageBilingual: { en: "Bilingual", yue: "雙語" },
  funnyEnglishLabel: { en: "English funny level", yue: "英文玩味程度" },
  funnyCantoneseLabel: { en: "Cantonese funny level", yue: "廣東話玩味程度" },
  funnyHelp: { en: "1 is fully serious; 5 is maximum playfulness. Facts, affected data, and choices stay explicit.", yue: "1 係完全嚴肅；5 係最大玩味。事實、受影響資料同選擇仍然清楚。" },
  saveSettings: { en: "Save settings", yue: "儲存設定" },
  exportHeading: { en: "Exportable settings", yue: "可匯出設定" },
  exportHelp: { en: "Exports a versioned JSON file. It includes the configured endpoint, so treat the file as local configuration.", yue: "會匯出有版本嘅 JSON 檔，包含已設定端點，請當本機設定檔咁保管。" },
  exportSettings: { en: "Export settings", yue: "匯出設定" },
  importSettings: { en: "Import settings", yue: "匯入設定" },
  resetSettings: { en: "Reset all settings", yue: "重設所有設定" },
  helpHeading: { en: "Handoff help", yue: "交接說明" },
  bridgeAuditTitle: { en: "Why recovery can still appear", yue: "點解仍然可能見到恢復狀態" },
  bridgeAuditBody: { en: "The integration Electron app now starts a loopback HandoffServer at http://127.0.0.1:43771. Chrome uses that HTTP seam, never the context-isolated renderer IPC. If the app is closed, the port is occupied, or the adapter rejects a request, the extension shows failure and keeps manual recovery available.", yue: "整合後嘅 Electron 程式而家會喺 http://127.0.0.1:43771 啟動本機 HandoffServer。Chrome 用呢條 HTTP seam，永遠唔會直入 context-isolated renderer IPC。如果程式關閉、port 被佔用，或者 adapter 拒絕請求，extension 會顯示失敗，同時保留手動恢復方法。" },
  contractHeading: { en: "Contract summary", yue: "Contract 摘要" },
  contractBody: { en: "The Electron adapter listens at http://127.0.0.1:43771, answers GET /v1/status, and accepts POST /v1/downloads. Redirects, credentials, non-loopback hosts, unknown paths, and oversized values are rejected. A 202 confirms validation and queue dispatch; it is not a completed-download signal.", yue: "Electron adapter 喺 http://127.0.0.1:43771 監聽，回應 GET /v1/status，同埋接收 POST /v1/downloads。重新導向、帳戶密碼、非本機主機、未知路徑同過大資料都會拒絕。202 只確認驗證同排隊呼叫，唔代表下載完成。" },
  manualRecovery: { en: "Recovery: if the desktop app is closed or the adapter fails, open the app and paste the URL into its real Add download flow.", yue: "恢復方法：如果桌面程式關閉或者 adapter 失敗，開返程式，將網址貼入真正嘅新增下載流程。" },
  statusReady: { en: "Ready", yue: "準備好" },
  searchNoMatches: { en: "No settings match this search.", yue: "冇設定符合呢次搜尋。" },
  searchMatchCount: { en: "{{count}} setting(s) match.", yue: "有 {{count}} 項設定符合。" },
  searchOtherTabs: { en: "Matches also exist in: {{tabs}}.", yue: "其他分頁亦有符合項目：{{tabs}}。" },
  settingsUnsaved: { en: "Unsaved setting changes", yue: "有未儲存設定更改" },
  protocolDetail: { en: "{{detail}}", yue: "{{detail}}" },
};

function replaceTokens(value, variables) {
  return value.replace(/\{\{(\w+)\}\}/g, (_match, key) => String(variables[key] ?? ""));
}

function languageText(value, settings) {
  const english = Array.isArray(value.en) ? value.en[Math.max(0, Math.min(4, settings.funnyLevelEn - 1))] : value.en;
  const cantonese = Array.isArray(value.yue) ? value.yue[Math.max(0, Math.min(4, settings.funnyLevelYue - 1))] : value.yue;
  if (settings.languageMode === "yue") return cantonese;
  if (settings.languageMode === "bilingual") return `${english} · ${cantonese}`;
  return english;
}

export function localize(key, settings, variables = {}) {
  const value = UI_TEXT[key] ?? UI_TEXT.protocolDetail;
  return replaceTokens(languageText(value, settings), variables);
}

export function hasLocalizationKey(key) {
  return Object.prototype.hasOwnProperty.call(UI_TEXT, key);
}
