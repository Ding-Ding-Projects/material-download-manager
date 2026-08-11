import { presentationSettings } from "./settings.js";

const UI_TEXT = {
  popupTitle: { en: "Send to {{name}}", yue: "傳送到 {{name}}" },
  popupSubtitle: { en: "A local handoff, with the door firmly closed to the wider internet.", yue: "本機交接，門口鎖實，唔會周街搵人。" },
  currentUrl: { en: "URL", yue: "網址" },
  urlHint: { en: "Use an http:// or https:// URL without embedded credentials.", yue: "請用唔帶帳戶密碼嘅 http:// 或 https:// 網址。" },
  sendUrl: { en: "Send URL", yue: "傳送網址" },
  openOptions: { en: "Open options", yue: "開啟選項" },
  disabledTitle: { en: "Handoff disabled because the endpoint was cleared", yue: "交接功能因端點被清除而暫停" },
  disabledBody: { en: "Restore the default local endpoint in Options, or paste the URL into the desktop app manually. A failed or unavailable adapter is reported as a failure; it is never guessed as success.", yue: "去選項恢復預設本機端點，或者手動將網址貼入桌面程式。adapter 失敗或者未啟動會如實報錯，唔會估佢成功。" },
  optionsRecovery: { en: "The default local adapter endpoint is configured. If the desktop app is not running or rejects a request, this extension reports the failure and keeps manual paste recovery available.", yue: "預設本機 adapter 端點已設定。如果桌面程式未啟動或者拒絕請求，extension 會如實報錯，仲保留手動貼上嘅恢復方法。" },
  readyTitle: { en: "Local handoff ready", yue: "本機交接準備好" },
  readyBody: { en: "Default endpoint: http://127.0.0.1:43771/v1/downloads. The app-installed capability authenticates protocol 2 in both directions. A verified 202 confirms durable queue acceptance, not download completion.", yue: "預設端點：http://127.0.0.1:43771/v1/downloads。由程式安裝嘅 capability 會雙向驗證 protocol 2。驗證過嘅 202 代表已持久接收排隊，唔代表下載完成。" },
  lastStatus: { en: "Latest handoff status", yue: "最近交接狀態" },
  settingsDisclosure: { en: "Funny levels style every message, including warnings and errors; they never change the facts. You can reset them at any time.", yue: "玩味程度會調整所有訊息，包括警告同錯誤；事實內容唔會變。任何時候都可以重設。" },
  serviceWorkerUnavailable: { en: "The extension service worker did not answer. Reload the unpacked extension and try again.", yue: "Extension service worker 冇回應。請重新載入未封裝 extension，再試一次。" },
  invalidUrl: { en: "Enter a credential-free http or https URL.", yue: "請輸入唔帶帳戶密碼嘅 http 或 https 網址。" },
  handoffSuccess: { en: ["The URL was accepted by the local manager.", "The local manager accepted the URL.", "The local manager accepted the URL; tiny clipboard parade complete.", "The local manager caught the URL before it wandered off.", "The local manager accepted the URL; the little link has checked in safely."] , yue: ["本機程式已接收網址。", "本機程式收咗條網址。", "本機程式收咗條網址，飲茶前趕得切。", "本機程式捉住條網址，冇畀佢周圍走。", "本機程式已經接待條小網址，安全入住喇。"] },
  handoffCleanupWarning: { en: ["The local manager accepted the URL and the browser download was cancelled, but its cancelled history row could not be erased.", "The local manager accepted the URL; only the browser's cancelled history row still needs manual removal.", "The handoff landed, but one cancelled browser-history crumb refused to leave the table.", "The manager caught the URL; the browser kept one cancelled souvenir in its history.", "The URL arrived safely, while one cancelled browser-history row staged a tiny sit-in."], yue: ["本機程式已接收網址，瀏覽器下載亦已取消，但取消咗嘅歷史記錄未能移除。", "本機程式收咗條網址；只係瀏覽器嗰條已取消記錄要手動移除。", "交接成功，不過有粒已取消嘅瀏覽器歷史碎屑唔肯離枱。", "本機程式捉到條網址；瀏覽器歷史留低一件已取消小紀念品。", "網址安全到埗，但有條已取消嘅瀏覽器歷史記錄搞緊迷你靜坐。"] },
  automaticPauseFailed: { en: ["The browser download could not be paused, so it was left untouched.", "Automatic handoff could not pause the browser download; the browser keeps handling it.", "The pause request did not land, so the browser download stayed in its own lane.", "The handoff missed the pause button; the browser download keeps going normally.", "The tiny pause marshal arrived late, so the browser remains fully in charge of this download."], yue: ["瀏覽器下載未能暫停，所以原封不動繼續由瀏覽器處理。", "自動交接未能暫停瀏覽器下載；瀏覽器會繼續處理。", "暫停要求未成功，瀏覽器下載留返喺自己條線。", "交接未㩒到暫停掣；瀏覽器下載照常繼續。", "迷你暫停指揮員遲到，呢個下載繼續由瀏覽器全權處理。"] },
  automaticCapacityFull: { en: ["Automatic handoff is already tracking 64 downloads, so this browser download was left untouched.", "The 64-download handoff limit is full; this download stays with the browser.", "All 64 safe handoff seats are occupied, so this browser download keeps its original seat.", "The handoff queue has 64 plates spinning already; the browser keeps this one.", "The 64-seat handoff bus is full, so this download travels safely with the browser instead."], yue: ["自動交接已追蹤緊 64 個下載，所以呢個下載原封不動留畀瀏覽器。", "64 個下載嘅交接上限已滿；呢個下載留返畀瀏覽器。", "64 個安全交接座位全部有人，呢個瀏覽器下載保留原位。", "交接已經轉緊 64 隻碟；呢個由瀏覽器繼續接手。", "64 座交接小巴滿座，呢個下載安全咁改搭瀏覽器。"] },
  automaticResumedFailed: { en: ["The local manager did not confirm takeover, so the original browser download was resumed.", "Automatic handoff failed safely; the browser resumed the original download.", "The local handoff did not land, and the browser picked the download back up.", "The manager declined the baton, so the browser resumed without dropping the download.", "The handoff door stayed shut; the browser rescued its little download and carried on."], yue: ["本機程式未確認接手，所以原本瀏覽器下載已恢復。", "自動交接安全失敗；瀏覽器已恢復原本下載。", "本機交接未成功，瀏覽器重新接返個下載。", "管理器冇接支棒，所以瀏覽器冇甩單咁繼續。", "交接門冇開；瀏覽器救返個小下載繼續行。"] },
  automaticResumeFailed: { en: ["The local manager did not complete takeover and the paused browser download could not be resumed. Inspect the browser Downloads page.", "Automatic handoff failed and browser recovery also failed; inspect the paused item in browser Downloads.", "Neither handoff nor resume completed; the browser Downloads page needs attention.", "The baton fell between manager and browser; inspect the paused browser download before retrying.", "Both the handoff and rescue crew stumbled; open browser Downloads and inspect the paused item."], yue: ["本機程式未完成接手，而已暫停嘅瀏覽器下載亦未能恢復。請檢查瀏覽器下載頁。", "自動交接同瀏覽器恢復都失敗；請喺瀏覽器下載頁檢查已暫停項目。", "交接同恢復都未完成；瀏覽器下載頁需要處理。", "接力棒跌咗喺管理器同瀏覽器中間；重試前請檢查已暫停下載。", "交接隊同拯救隊一齊跣腳；請打開瀏覽器下載頁檢查已暫停項目。"] },
  automaticCancelFailedResumed: { en: ["The local manager accepted the URL, but browser cancellation failed; the browser download was resumed and may duplicate it.", "The manager accepted the URL, while the browser copy could not be cancelled and was resumed; a duplicate is possible.", "The manager has one copy and the browser resumed another after cancellation failed; watch for twins.", "The manager caught the URL, but the browser copy dodged cancellation and resumed, so two files may arrive.", "The manager welcomed the download while its browser twin escaped cancellation; both may knock on the door."], yue: ["本機程式已接收網址，但瀏覽器取消失敗；瀏覽器下載已恢復，可能會重複。", "管理器已接收網址，但瀏覽器嗰份未能取消並已恢復；可能有重複下載。", "管理器有一份，瀏覽器取消失敗後又恢復一份；留意孖生下載。", "管理器捉到網址，但瀏覽器嗰份避過取消並恢復，所以可能有兩個檔案到埗。", "管理器歡迎咗個下載，而瀏覽器孖生兄弟逃過取消；兩份都可能嚟敲門。"] },
  automaticCancelRecoveryFailed: { en: ["The local manager accepted the URL, but browser cancellation and resume both failed. Inspect the browser Downloads page.", "The manager accepted the URL, while both browser cancellation and recovery failed; inspect the browser item now.", "The manager has the request, but the browser copy is in an unknown paused state; open browser Downloads.", "The manager caught the baton, but the browser controls both slipped; inspect the original download before acting.", "The manager has the URL, while the browser cancellation and rescue crews both tripped; check browser Downloads."], yue: ["本機程式已接收網址，但瀏覽器取消同恢復都失敗。請檢查瀏覽器下載頁。", "管理器已接收網址，但瀏覽器取消同恢復都失敗；請立即檢查瀏覽器項目。", "管理器已有要求，但瀏覽器嗰份處於不明暫停狀態；請打開瀏覽器下載頁。", "管理器接到棒，但瀏覽器兩個控制都跣腳；行動前請檢查原本下載。", "管理器有條網址，但瀏覽器取消隊同拯救隊一齊跌低；請檢查瀏覽器下載頁。"] },
  automaticCancelFailedOriginalGone: { en: ["The local manager accepted the URL, browser cancellation failed, and the original browser item was no longer active when recovery checked it.", "The manager accepted the URL; cancellation failed, then the browser item had already finished or disappeared.", "The manager has the request, while the browser item left before the recovery roll call.", "The manager caught the URL; cancellation stumbled, but the browser item had already left the stage.", "The manager welcomed the URL while its browser twin vanished before the rescue crew arrived."], yue: ["本機程式已接收網址；瀏覽器取消失敗，而恢復檢查時原本項目已經唔再運行。", "管理器已接收網址；取消失敗，之後瀏覽器項目已完成或者消失。", "管理器已有要求，但瀏覽器項目喺恢復點名前已經離開。", "管理器捉到網址；取消跣腳，但瀏覽器項目已經落台。", "管理器歡迎咗網址，而瀏覽器孖生兄弟喺拯救隊到之前消失咗。"] },
  automaticCancelFailedAlreadyRunning: { en: ["The local manager accepted the URL, browser cancellation failed, and the original browser download was already running. A duplicate is possible.", "The manager accepted the URL; cancellation failed and the browser copy was already running, so two downloads may continue.", "The manager has one request and the browser copy is already moving; watch for twins.", "The manager caught the URL, but the browser copy ran past cancellation and may arrive too.", "The manager welcomed one download while its browser twin was already sprinting toward the same door."], yue: ["本機程式已接收網址；瀏覽器取消失敗，而原本下載已經運行緊，可能會重複。", "管理器已接收網址；取消失敗，瀏覽器嗰份已經繼續，所以可能有兩份。", "管理器有一個要求，瀏覽器嗰份亦已經開跑；留意孖生下載。", "管理器捉到網址，但瀏覽器嗰份跑過取消線，可能都會到埗。", "管理器歡迎一個下載，而瀏覽器孖生兄弟已經衝緊去同一扇門。"] },
  automaticOriginalGone: { en: ["The browser item finished or disappeared before recovery, so the extension made no further browser change.", "Recovery found no active browser item; nothing was resumed or cancelled.", "The browser item had already left before recovery took attendance.", "Recovery arrived, but the browser download had already finished its scene.", "The tiny recovery crew found an empty chair; the browser item had already gone."], yue: ["恢復前瀏覽器項目已完成或者消失，所以 extension 冇再改動瀏覽器。", "恢復時冇搵到運行中嘅瀏覽器項目；冇恢復亦冇取消。", "恢復點名前瀏覽器項目已經離開。", "恢復隊到場時，瀏覽器下載已經演完呢幕。", "小小恢復隊只見到空凳；瀏覽器項目已經走咗。"] },
  automaticOriginalAlreadyRunning: { en: ["The local manager did not confirm takeover, and the original browser download was already running; no resume call was needed.", "Takeover was not confirmed, but the browser copy was already running normally.", "The handoff did not land, while the browser download had already picked itself back up.", "The manager declined the baton, but the browser was already running with it.", "The handoff door stayed shut; fortunately the browser download had already trotted away safely."], yue: ["本機程式未確認接手，而原本瀏覽器下載已經運行緊；唔需要再恢復。", "接手未確認，但瀏覽器嗰份已經正常運行。", "交接未成功，而瀏覽器下載已經自己重新開工。", "管理器冇接支棒，但瀏覽器已經拎住支棒跑緊。", "交接門冇開；好彩瀏覽器下載已經安全咁行返。"] },
  automaticOwnershipMismatch: { en: ["The current browser item no longer matched the extension's ownership record, so it was left untouched. Check browser Downloads before retrying.", "The browser item's identity changed; the extension cleared its stale claim and made no browser change.", "The ownership badge no longer matched, so the extension kept its hands off the browser item.", "The browser item changed badges; the stale claim was cleared and the item stayed untouched.", "The browser download changed costumes, so the extension politely backed away and cleared its old ticket."], yue: ["目前瀏覽器項目已唔再符合 extension 嘅擁有記錄，所以保持不動。重試前請檢查瀏覽器下載頁。", "瀏覽器項目身份有變；extension 清除過期記錄，冇改動瀏覽器。", "擁有證件唔再相符，所以 extension 冇再郁瀏覽器項目。", "瀏覽器項目換咗證件；舊記錄已清除，項目保持不動。", "瀏覽器下載換咗戲服，所以 extension 有禮貌咁退後並清走舊飛。"] },
  automaticRestartResumeFailed: { en: ["A browser download owned and paused by the extension could not be resumed after the worker restarted. Inspect browser Downloads.", "Worker recovery found an owned paused download but could not resume it; inspect the browser item.", "The worker came back, found its paused download, and could not restart it; browser Downloads needs attention.", "The service worker returned from its nap, but its paused download would not wake; inspect it in browser Downloads.", "The little worker rebooted and found its download still asleep; open browser Downloads to wake it manually."], yue: ["擴充功能擁有並暫停嘅瀏覽器下載喺 worker 重啟後未能恢復。請檢查瀏覽器下載頁。", "Worker 恢復時搵到自己暫停嘅下載，但未能繼續；請檢查瀏覽器項目。", "Worker 返嚟搵到個暫停下載，但開唔返；瀏覽器下載頁需要處理。", "Service worker 瞓醒返嚟，但個暫停下載唔肯醒；請喺瀏覽器下載頁檢查。", "小 worker 重啟後發現個下載仲瞓緊；請打開瀏覽器下載頁手動叫醒佢。"] },
  handoffDisabled: { en: ["Handoff is disabled until a loopback endpoint is configured.", "Handoff is waiting for a loopback endpoint.", "Handoff is waiting patiently by the local door for an endpoint.", "Handoff is paused because the local door has not been built yet.", "Handoff is holding this URL like a tiny suitcase until a local door appears."], yue: ["未設定本機端點，交接功能暫停。", "交接功能等緊本機端點。", "交接功能乖乖企喺本機門口等端點。", "本機門口未起好，所以交接功能暫停。", "交接功能拎住條網址小行李，等本機門口開門。"] },
  handoffUnpaired: { en: ["This unpacked extension is not paired with the local manager. Use Prepare browser extension in the app, then reload that staged folder.", "Pairing is missing. Prepare the extension from the app Settings screen and reload it in Chrome.", "The local handshake has no ticket yet; prepare the extension in the app and reload its staged folder.", "This extension reached the local door without its app-installed badge; prepare and reload it.", "The little extension forgot its backstage pass; let the app prepare a fresh folder, then reload it in Chrome."], yue: ["呢個未封裝 extension 未同本機管理器配對。請喺程式揀準備瀏覽器 extension，再重新載入嗰個 staged folder。", "未完成配對。請喺程式設定準備 extension，再喺 Chrome 重新載入。", "本機握手仲未有入場飛；請由程式準備 extension 並重新載入資料夾。", "Extension 去到本機門口但冇程式安裝嘅證件；請準備並重新載入。", "小 extension 唔記得後台通行證；畀程式準備新資料夾，再喺 Chrome 重新載入。"] },
  handoffFailed: { en: ["The local manager did not accept the URL.", "The local handoff could not accept the URL.", "The local handoff knocked, but nobody answered.", "The local handoff met a closed local door.", "The URL reached the local doorway, but the doorman declined it."], yue: ["本機程式未能接收網址。", "本機交接未能接收網址。", "本機交接敲咗門，但冇人應門。", "本機門口關咗，今次交接未成功。", "網址去到本機門口，但門神拒絕接待。"] },
  connectionSuccess: { en: ["The endpoint passed the authenticated protocol 2 check.", "The endpoint is reachable and proved the app-installed protocol 2 capability.", "The authenticated local handshake answered and has had its tea.", "The endpoint proved protocol 2 in both directions, with no interpretive dance required.", "The protocol 2 handshake proved its tiny backstage pass and is wearing a victory hat."], yue: ["端點通過已驗證嘅 protocol 2 檢查。", "端點可連線，亦證明咗由程式安裝嘅 protocol 2 capability。", "已驗證嘅本機握手有回應，飲完茶喇。", "端點雙向證明 protocol 2，唔使跳舞估意思。", "Protocol 2 握手證明咗小小後台證，仲戴住勝利帽。"] },
  connectionUnpaired: { en: ["The endpoint is present, but this unpacked extension has no app-installed capability. Prepare and reload it from the app Settings screen.", "The app answered, but pairing is missing; prepare the extension in the app and reload it.", "The local door exists, but this extension has no handshake ticket yet.", "The endpoint answered while the extension searched every pocket for its missing app-installed badge.", "The local manager is home, but the little extension needs a fresh backstage pass from app Settings."], yue: ["端點存在，但呢個未封裝 extension 冇由程式安裝嘅 capability。請喺程式設定準備並重新載入。", "程式有回應，但未配對；請喺程式準備 extension 再重新載入。", "本機門口存在，但 extension 仲未有握手入場飛。", "端點有回應，而 extension 摷晒所有袋都搵唔到程式安裝嘅證件。", "本機管理器喺屋企，但小 extension 要去程式設定攞張新後台證。"] },
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
  optionsTitle: { en: "{{name}} extension options", yue: "{{name}} extension 選項" },
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
  autoCaptureLabel: { en: "Automatically send browser downloads to the local manager", yue: "自動將瀏覽器下載交畀本機管理器" },
  autoCaptureHelp: { en: "Enabled by default. Eligible downloads pause before handoff; the browser resumes them if the local manager does not accept them.", yue: "預設開啟。合資格下載會先暫停再交接；如果本機管理器唔收貨，瀏覽器會繼續原本下載。" },
  connectionDisabledTitle: { en: "Recovery state: the endpoint was cleared", yue: "恢復狀態：端點被清除" },
  connectionDisabledBody: { en: "The desktop app's loopback adapter is implemented at the default endpoint. This state appears only when the endpoint setting is empty. Restore the default endpoint or use the manual paste path; an unavailable adapter remains a visible failure.", yue: "桌面程式嘅本機 adapter 已經喺預設端點實作好。呢個狀態只會喺端點設定留空時出現。請恢復預設端點，或者用手動貼上網址；adapter 未能使用會清楚顯示失敗。" },
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
  bridgeAuditBody: { en: "The desktop app starts a loopback HandoffServer at http://127.0.0.1:43771. Chrome uses that authenticated HTTP seam, never renderer IPC. If the app is closed, the port is occupied, pairing is stale, or the adapter rejects a request, the extension shows failure and keeps manual recovery available.", yue: "桌面程式會喺 http://127.0.0.1:43771 啟動本機 HandoffServer。Chrome 用呢條已驗證嘅 HTTP seam，永遠唔會直入 renderer IPC。如果程式關閉、port 被佔用、配對已過期，或者 adapter 拒絕請求，extension 會顯示失敗，同時保留手動恢復方法。" },
  contractHeading: { en: "Contract summary", yue: "Contract 摘要" },
  contractBody: { en: "The desktop adapter listens at http://127.0.0.1:43771, answers GET /v1/status, proves an app-installed capability through GET /v2/challenge, and accepts authenticated POST /v1/downloads. Redirects, credentials, non-loopback hosts, unknown paths, replayed challenges, invalid proofs, and oversized values are rejected. A verified 202 confirms durable queue acceptance; it is not a completed-download signal.", yue: "桌面 adapter 喺 http://127.0.0.1:43771 監聽，回應 GET /v1/status，透過 GET /v2/challenge 證明由程式安裝嘅 capability，再接收已驗證嘅 POST /v1/downloads。重新導向、帳戶密碼、非本機主機、未知路徑、重播 challenge、錯誤 proof 同過大資料都會拒絕。驗證過嘅 202 代表已持久接收排隊，唔代表下載完成。" },
  manualRecovery: { en: "Recovery: if the desktop app is closed or the adapter fails, open the app and paste the URL into its real Add download flow.", yue: "恢復方法：如果桌面程式關閉或者 adapter 失敗，開返程式，將網址貼入真正嘅新增下載流程。" },
  statusReady: { en: "Ready", yue: "準備好" },
  searchNoMatches: { en: "No settings match this search.", yue: "冇設定符合呢次搜尋。" },
  searchMatchCount: { en: "{{count}} setting(s) match.", yue: "有 {{count}} 項設定符合。" },
  searchOtherTabs: { en: "Matches also exist in: {{tabs}}.", yue: "其他分頁亦有符合項目：{{tabs}}。" },
  settingsUnsaved: { en: "Unsaved setting changes", yue: "有未儲存設定更改" },
  schoolModeHeading: { en: "{{name}}", yue: "{{name}}" },
  schoolModeLabel: { en: "Use {{name}}", yue: "使用{{name}}" },
  schoolModeNameLabel: { en: "{{name}} name", yue: "{{name}}名稱" },
  schoolModeHelp: { en: "When enabled, this extension uses English-only serious copy and hides alternate-language and playful controls. Previous choices stay stored. Turning it off needs a locally verified reset credential; this extension slice does not store one.", yue: "開啟之後，extension 只用嚴肅英文文字，並隱藏其他語言同玩味控制。之前選擇會保留。關閉需要本機驗證嘅重設 credential；呢個 extension slice 唔會儲存 credential。" },
  schoolModeCredentialStatus: { en: "Reset credential state: unavailable in this extension slice. No credential material is stored.", yue: "重設 credential 狀態：呢個 extension slice 未能使用。冇有儲存任何 credential 資料。" },
  schoolModeCredentialUnavailable: { en: ["{{name}} could not be turned off because its locally verified reset credential is unavailable. The setting was kept on; remove this extension's local storage only if you intend to reset it.", "{{name}} stays on because its reset credential is not available locally. The setting was kept safe; remove this extension's local storage only as a deliberate reset.", "{{name}} keeps the door closed: its reset credential is unavailable, so the mode stayed on. Delete this extension's local storage only for a deliberate reset.", "{{name}} refuses the off switch while its reset credential is missing. The mode stayed on; local storage deletion is the explicit recovery route.", "{{name}} is guarding the off switch until a reset credential exists. It stayed on; delete this extension's local storage only when you mean to reset it."], yue: ["{{name}}未能關閉，因為本機驗證嘅重設 credential 未能使用。設定保持開啟；只有你真係想重設時先刪除呢個 extension 嘅本機儲存。", "{{name}}繼續開啟，因為重設 credential 未能使用。設定已安全保留；只有刻意重設先刪除 extension 本機儲存。", "{{name}}閂住道門：重設 credential 未能使用，所以模式保持開啟。刻意重設先刪除 extension 本機儲存。", "{{name}}唔肯畀你關掣，因為重設 credential 唔見咗。模式保持開啟；刪除本機儲存係明確恢復方法。", "{{name}}守住關閉掣，等到有重設 credential 先放行。模式保持開啟；真係要重設先刪除 extension 本機儲存。"] },
  emojiToggleLabel: { en: "Show emojis in dialogs and message boxes", yue: "喺對話框同訊息框顯示 emoji" },
  emojiToggleHelp: { en: "When enabled, dialog and message-box copy may include a relevant emoji. Buttons, field labels, and accessible names stay factual.", yue: "開啟後，對話框同訊息框文字可以加入相關 emoji。按鈕、欄位標籤同讀屏名稱仍然保持事實清楚。" },
  displayNameHistoryRecorded: { en: ["Display-name change recorded as redacted local history.", "The display-name change is recorded in redacted local history.", "Display-name change recorded; the journal kept the names behind a privacy curtain.", "The redacted local journal caught the display-name change before the setting finished.", "The display-name journal filed a tiny redacted receipt for the new name."], yue: ["顯示名稱更改已記錄為刪敏感資料嘅本機歷史。", "顯示名稱更改已記錄喺刪敏感資料嘅本機歷史。", "顯示名稱更改已記錄；歷史紀錄幫名稱拉咗私隱布簾。", "刪敏感資料嘅本機歷史喺設定完成前已經接住今次改名。", "顯示名稱歷史幫新名開咗張細細張刪敏感資料收據。"] },
  displayNameHistoryUnavailable: { en: ["The display-name change was not saved because redacted local history is unavailable.", "The display name stayed unchanged because its local history could not be recorded.", "The name stayed put: the redacted journal was unavailable, so the setting did not move.", "The journal could not take its privacy-safe receipt, so the display name stayed unchanged.", "The name declined to travel without its redacted journal receipt; nothing was saved."], yue: ["顯示名稱未有儲存，因為刪敏感資料嘅本機歷史未能使用。", "顯示名稱保持不變，因為本機歷史未能記錄今次更改。", "個名留返原位：刪敏感資料嘅歷史未能使用，所以設定冇郁。", "歷史紀錄未能收取私隱安全收據，所以顯示名稱保持不變。", "個名唔肯冇收據就出門口；刪敏感資料歷史未能使用，所以冇儲存。"] },
  settingsSaveFailed: { en: "Settings could not be saved safely. The previous values remain active.", yue: "設定未能安全儲存，之前嘅值仍然生效。" },
  narratorHeading: { en: "Spoken narrator", yue: "語音旁白" },
  narratorToggleLabel: { en: "Speak extension events", yue: "讀出 extension 事件" },
  narratorLanguageLabel: { en: "Narrator language", yue: "旁白語言" },
  narratorLanguageEnglish: { en: "English", yue: "英文" },
  narratorLanguageCantonese: { en: "Hong Kong Cantonese", yue: "香港廣東話" },
  narratorLanguageBoth: { en: "English then Cantonese", yue: "先英文後廣東話" },
  narratorSoundLabel: { en: "Sound level", yue: "聲音程度" },
  narratorSoundNormal: { en: "Normal", yue: "正常" },
  narratorSoundReduced: { en: "Reduced", yue: "較細聲" },
  narratorSoundMuted: { en: "Muted", yue: "靜音" },
  narratorQuietLabel: { en: "Quiet mode", yue: "靜音模式" },
  narratorReducedMotionLabel: { en: "Respect reduced-motion preference", yue: "尊重減少動態偏好" },
  narratorHelp: { en: "Off by default. Spoken events are serialized, debounced, and rate-limited. English then Cantonese is spoken in order when Both is selected. Quiet mode and a reduced-motion preference suppress speech without changing the on-screen message.", yue: "預設關閉。語音事件會排隊、去抖同限制頻率。揀兩種語言時會先讀英文，再讀廣東話。靜音模式同減少動態偏好會暫停語音，但唔會改畫面訊息。" },
  narratorProvenance: { en: "Current values come from this extension's local settings record. The compiled value for Narrator is Off, language English, Normal sound, Quiet mode Off, and reduced-motion respect On.", yue: "目前值來自呢個 extension 嘅本機設定紀錄。旁白編譯預設係關閉、英文、正常聲、靜音模式關閉，同埋開啟尊重減少動態。" },
  narratorTest: { en: "Narrator test: the extension is ready to speak this short event.", yue: "旁白測試：extension 準備好讀出呢個短事件。" },
  narratorTestButton: { en: "Test narration", yue: "測試旁白" },
  narratorReady: { en: "Narrator is enabled. New extension events will be spoken locally.", yue: "旁白已開啟。新 extension 事件會喺本機讀出。" },
  narratorDisabled: { en: "Narrator is off. On-screen messages remain available.", yue: "旁白已關閉。畫面訊息仍然照常顯示。" },
  narratorSuppressed: { en: "Narration is paused by the current narrator settings; visible messages remain available.", yue: "旁白因目前設定而暫停；畫面訊息仍然照常顯示。" },
  narratorQueueFull: { en: "Narrator capacity is full; visible messages remain available and no handoff was blocked.", yue: "旁白容量已滿；畫面訊息仍然照常顯示，交接功能冇受阻。" },
  narratorTestQueued: { en: "Narrator test queued locally.", yue: "旁白測試已喺本機排隊。" },
  narratorUnavailable: { en: "Spoken narration is unavailable in this browser; on-screen messages remain available.", yue: "呢個瀏覽器未能提供語音旁白；畫面訊息仍然照常顯示。" },
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
  return replaceTokens(languageText(value, presentationSettings(settings)), variables);
}

export function narrationParts(key, settings, variables = {}) {
  const value = UI_TEXT[key] ?? UI_TEXT.protocolDetail;
  const effective = presentationSettings(settings);
  return {
    en: replaceTokens(languageText(value, { ...effective, languageMode: "en" }), variables),
    yue: replaceTokens(languageText(value, { ...effective, languageMode: "yue" }), variables),
  };
}

export function decorateMessage(text, settings, emoji = "💬") {
  const effective = presentationSettings(settings);
  return effective.showEmojis ? `${emoji} ${text}` : text;
}

export function hasLocalizationKey(key) {
  return Object.prototype.hasOwnProperty.call(UI_TEXT, key);
}
