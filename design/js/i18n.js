// ABDM-M3 localization: EN base from data/en_US.properties (verbatim upstream), playful HK Cantonese set,
// per-language funny-level overlays (1=serious … 5=max). Voice changes, facts never do.

export function parseProperties(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).replace(/\\n/g, '\n').replace(/\\!/g, '!').replace(/\\:/g, ':');
  }
  return out;
}

// ---------- New surface keys (global-instruction features), EN base ----------
export const EXTRA_EN = {
  x_downloads: 'Downloads', x_home: 'Home', x_new_download_fab: 'New download',
  x_from_url: 'From URL', x_from_clipboard: 'From clipboard', x_batch: 'Batch download',
  x_empty_title: 'No downloads yet', x_empty_body: 'Add your first download with the New download button, paste a link, or drop one anywhere in this window.',
  x_empty_filtered: 'Nothing matches this filter', x_empty_filtered_body: 'No downloads match the current category, status and search. Clear filters to see the whole list.',
  x_clear_filters: 'Clear filters', x_active: 'Active', x_global_speed: 'Global speed',
  x_search_downloads: 'Search downloads', x_search_settings: 'Search settings', x_search_menu: 'Search menu', x_search_tabs: 'Search tabs',
  x_regex_builder: 'Regex builder', x_regex_mode: 'Regex mode', x_plain_text: 'Plain text', x_pattern: 'Pattern', x_flags: 'Flags',
  x_sample_text: 'Sample text', x_live_matches: 'Live matches', x_capture_groups: 'Capture groups', x_no_matches: 'No matches',
  x_invalid_pattern: 'Invalid pattern', x_copy_pattern: 'Copy pattern', x_insert_token: 'Insert', x_regex_engine_note: 'Engine: JavaScript RegExp (ECMAScript). Escaping follows JS string-free literal syntax.',
  x_anchors: 'Anchors', x_classes: 'Character classes', x_groups: 'Groups', x_quantifiers: 'Quantifiers', x_alternation: 'Alternation', x_literals: 'Literal',
  x_tab_pin: 'Pin tab', x_tab_unpin: 'Unpin tab', x_tab_close: 'Close window', x_tab_close_others: 'Close others', x_tab_close_right: 'Close tabs to the right',
  x_tab_close_containing: 'Close tabs containing text…', x_tab_close_not_containing: 'Close tabs NOT containing text…',
  x_tab_group_new: 'Add to new group…', x_tab_group_remove: 'Remove from group', x_tab_group_rename: 'Rename group', x_tab_group_color: 'Group color', x_tab_group_collapse: 'Collapse group', x_tab_group_expand: 'Expand group', x_tab_group_close: 'Close group', x_tab_group_ungroup: 'Ungroup tabs',
  x_tab_list: 'All windows', x_tab_search_master: 'Search all windows', x_tab_search_group: 'Search in group', x_tab_search_groups: 'Search groups by name',
  x_tabs_match_count: '{{count}} tabs match', x_tabs_will_close: '{{count}} tabs will close', x_tabs_pinned_excluded: '{{count}} pinned tabs excluded', x_include_pinned: 'Include pinned tabs',
  x_bulk_close_empty: 'Enter text first — bulk close never runs on an empty query.',
  x_group_name: 'Group name', x_new_group: 'New group',
  x_notifications: 'Notifications', x_notification_centre: 'Notification centre', x_clear_all: 'Clear all', x_mark_read: 'Mark all read', x_no_notifications: 'No notifications yet', x_no_notifications_body: 'Download events, queue events and errors will appear here.',
  x_super_confirm_title: 'Safety check', x_super_confirm_body: 'This action is irreversible. Turn both keys, then slide to confirm.',
  x_key_a: 'Key A', x_key_b: 'Key B', x_slide_to_confirm: 'Slide to confirm', x_emergency_exit: 'Emergency exit', x_authorized: 'Authorized',
  x_edit_appearance: 'Edit appearance…', x_edit_tab_appearance: 'Edit tab appearance…', x_edit_group_appearance: 'Edit group appearance…',
  x_appearance_editor: 'Appearance editor', x_target: 'Target', x_typography: 'Typography', x_colors: 'Colors', x_shape_spacing: 'Shape & spacing',
  x_font_family: 'Font family', x_font_size: 'Font size', x_font_weight: 'Weight', x_italic: 'Italic', x_underline: 'Underline', x_strikethrough: 'Strikethrough', x_overline: 'Overline', x_letter_spacing: 'Letter spacing', x_word_spacing: 'Word spacing', x_line_height: 'Line height', x_capitalization: 'Capitalization', x_small_caps: 'Small caps', x_superscript: 'Superscript', x_subscript: 'Subscript', x_baseline_offset: 'Baseline offset', x_text_direction: 'Direction', x_alignment: 'Alignment', x_text_color: 'Text color', x_highlight: 'Highlight', x_text_outline: 'Outline', x_text_shadow: 'Shadow', x_text_glow: 'Glow',
  x_background_color: 'Background', x_border_color: 'Border color', x_corner_radius: 'Corner radius', x_padding: 'Padding', x_gap: 'Gap', x_icon_size: 'Icon size',
  x_reset_element: 'Reset this element', x_reset_property: 'Reset property', x_reset_all_appearance: 'Reset all customizations',
  x_presets: 'Presets', x_save_preset: 'Save preset…', x_export_theme: 'Export theme', x_import_theme: 'Import theme',
  x_unsupported_prop: 'Not supported on this platform — value kept, not applied.',
  x_color_picker: 'Color picker', x_spectrum: 'Spectrum', x_recent: 'Recent', x_custom_colors: 'Custom', x_eyedropper: 'Eyedropper', x_contrast_vs: 'Contrast', x_gamut_warning: 'Outside sRGB — will be clipped', x_color_space: 'Color space: sRGB', x_copy_value: 'Copy value',
  x_history: 'Version history', x_history_empty: 'No revisions yet', x_history_empty_body: 'Every change to downloads, queues, categories and settings is snapshotted here and can be restored.',
  x_restore: 'Restore', x_restored_as_new: 'Restored as a new revision (history is append-only)', x_label_revision: 'Label revision…', x_diff: 'Inspect',
  x_filter_by_action: 'Filter by action', x_date_range: 'Date range', x_date_from: 'From', x_date_to: 'To', x_date_presets: 'Presets', x_today: 'Today', x_last_7: 'Last 7 days', x_last_30: 'Last 30 days', x_all_time: 'All time', x_invalid_date: 'Not a date I recognise — try 2026-08-01 or your locale format', x_search_history: 'Search history',
  x_act_created: 'Created', x_act_updated: 'Updated', x_act_deleted: 'Deleted', x_act_restored: 'Restored', x_act_imported: 'Imported', x_act_settings: 'Settings changed', x_act_bulk: 'Bulk action',
  x_changelog: 'Changelog', x_changelog_search: 'Search changelog', x_export_visible: 'Export visible', x_exported_range: 'Exported range', x_no_changes_recorded: 'No changes recorded for this version.',
  x_release_codename: 'Release code name', x_codename_note: 'Every release carries a dim-sum code name beside its version.',
  x_export: 'Export…', x_export_title: 'Export', x_export_format: 'Format', x_export_scope: 'Scope', x_export_selected: 'Selected ({{count}})', x_export_filtered: 'Filtered view ({{count}})', x_export_all: 'Everything ({{count}})', x_export_note: 'UTF-8, LF line endings. Schema: abdm-m3/v1.', x_export_lossy_note: '{{format}} cannot carry nested fields ({{fields}}) — they will be flattened.', x_download_file: 'Download file', x_copy_output: 'Copy output',
  x_bulk_actions: 'Bulk actions', x_selected_n: '{{count}} selected', x_select_all_matching: 'Select all matching ({{count}})', x_select_page: 'Select visible', x_invert_selection: 'Invert selection', x_will_change: '{{count}} will change', x_skipped_n: '{{count}} skipped: {{reason}}',
  x_move_to: 'Move to…', x_retry_failed: 'Retry failed', x_requeue: 'Re-queue',
  x_language_mode: 'Language mode', x_language_mode_desc: 'English, playful Hong Kong Cantonese, or both at once', x_lang_en: 'English', x_lang_yue: '廣東話 Cantonese', x_lang_bi: 'Bilingual 雙語',
  x_funny_en: 'Funny level — English', x_funny_yue: 'Funny level — Cantonese', x_funny_desc: 'Styles ALL copy in this language — including errors, warnings and destructive prompts. Facts are never changed, only the voice. 1 = fully serious, 5 = maximum playfulness.',
  x_funny_l1: 'Serious', x_funny_l2: 'Warm', x_funny_l3: 'Playful', x_funny_l4: 'Cheeky', x_funny_l5: 'Full send',
  x_narrator: 'Spoken narrator', x_narrator_desc: 'Speaks app events aloud. Off by default; one utterance at a time; yields to screen readers.', x_narrator_lang: 'Narrator language', x_narrator_both: 'Both (EN then 粵)',
  x_reduced_motion: 'Reduce motion', x_reduced_motion_desc: 'Minimise animations across the app (also follows your system preference)',
  x_density: 'Density', x_density_desc: 'Spacing scale of the interface', x_comfortable: 'Comfortable', x_compact: 'Compact', x_spacious: 'Spacious',
  x_seed_color: 'Accent (seed) color', x_seed_color_desc: 'Material 3 palette is derived from this seed at runtime',
  x_theme_mode: 'Theme', x_light: 'Light', x_dark: 'Dark', x_follow_system: 'Follow system',
  x_font_setting_desc: 'Interface font, size scale and weight — live preview, CJK-safe fallback',
  x_disclosure_title: 'Before you dive in', x_disclosure_body: 'This app has a funny-level setting per language. It styles every message — errors, warnings and delete prompts included. Facts always stay exact; only the voice changes. You can change or reset it any time in Settings → Appearance.', x_got_it: 'Got it',
  x_dimsum_surprise: 'Dim sum surprise', x_dimsum_of_the_day: 'A little something', x_dimsum_note: 'A 10% chance on launch. It never blocks anything and never repeats within one launch.',
  x_open_settings_search: 'Search all settings', x_setting_on_other_tab: 'Found in {{section}} — jump there', x_no_settings_match: 'No settings match',
  x_window: 'Window', x_minimize: 'Minimize', x_maximize: 'Maximize', x_restore_win: 'Restore', x_menu_search_placeholder: 'Type to filter…',
  x_confirm_needed: 'Confirmation required', x_stopped: 'Stopped', x_started: 'Started',
  x_queue_started: 'Queue "{{name}}" started', x_queue_stopped: 'Queue "{{name}}" stopped', x_queue_finished: 'Queue "{{name}}" finished',
  x_download_added: 'Added "{{name}}"', x_download_finished: '"{{name}}" finished', x_download_failed: '"{{name}}" failed: {{reason}}', x_download_paused: '"{{name}}" paused', x_download_resumed: '"{{name}}" resumed', x_download_deleted: 'Deleted {{count}} item(s)', x_clipboard_no_links: 'No downloadable links in the clipboard', x_links_imported: '{{count}} link(s) imported',
  x_undo: 'Undo', x_view: 'View', x_details: 'Details', x_apply: 'Apply', x_add_host: 'Add host', x_remove_host: 'Remove host',
  x_columns: 'Columns', x_sound_played: 'Sound: {{name}}', x_test: 'Test',
  x_open_in_editor: 'Open in VS Code', x_open_in_editor_desc: 'Exports can be opened directly in Visual Studio Code. If VS Code is not detected, you will be offered the download instead.', x_editor_not_found: 'VS Code was not found on this machine. Get it at code.visualstudio.com — the export stays in your Downloads folder.',
  x_speed_chart: 'Speed', x_avg: 'avg', x_parts: 'parts',
  x_confirm_delete_queue: 'Delete queue "{{name}}"? Items stay in the download list.',
  x_scheduler_next: 'Next run: {{time}}', x_scheduler_off: 'Scheduler off',
  x_simulated_note: 'Simulated network — this prototype downloads no real bytes.',
};

// ---------- Cantonese base (level-1 serious, natural HK written Cantonese) ----------
export const YUE = {
  app_title: 'AB 下載管理器', x_downloads: '下載', x_home: '主頁', x_new_download_fab: '新增下載',
  x_from_url: '輸入連結', x_from_clipboard: '由剪貼簿匯入', x_batch: '批量下載', batch_download: '批量下載',
  new_download: '新增下載', import_from_clipboard: '由剪貼簿匯入', exit: '退出', show_downloads: '顯示下載清單',
  file: '檔案', tasks: '任務', tools: '工具', help: '說明', settings: '設定', about: '關於',
  all: '全部', finished: '已完成', Unfinished: '未完成', all_missing_files: '所有檔案唔見咗嘅項目', all_finished: '所有已完成', all_unfinished: '所有未完成', entire_list: '成個清單',
  delete: '刪除', remove: '移除', cancel: '取消', close: '關閉', ok: '好', add: '加入', paste: '貼上', change: '更改', edit: '編輯', download: '下載', refresh: '重新整理', open: '開啟', copy: '複製', reset: '重設', start: '開始', done: '完成', clear: '清除', search: '搜尋', menu: '選單', more_options: '更多選項', share: '分享', back: '返回', next: '下一步', skip: '跳過',
  open_file: '開啟檔案', open_folder: '開啟資料夾', resume: '繼續', pause: '暫停', restart_download: '重新下載', copy_link: '複製連結', show_properties: '顯示屬性', move_to_queue: '移去隊列', move_to_category: '移去分類', edit_download_title: '編輯下載', file_checksum: '檔案校驗碼',
  stop_all: '全部停止', queues: '隊列', start_queue: '開始隊列', stop_queue: '停止隊列', add_new_queue: '新增隊列', remove_queue: '移除隊列', queue_name: '隊列名稱', config: '設定', items: '項目', move_up: '上移', move_down: '下移', clear_queue_items: '清空隊列',
  categories: '分類', add_category: '新增分類', edit_category: '編輯分類', delete_category: '刪除分類', category_name: '分類名稱', auto_categorize_downloads: '自動分類下載', restore_defaults: '還原預設', category_file_types: '分類檔案類型', category_url_patterns: '網址規則', category_download_location: '分類下載位置',
  name: '名稱', size: '大小', status: '狀態', speed: '速度', time_left: '剩餘時間', date_added: '加入日期', link: '連結', info: '資訊', icon: '圖示', location: '位置', address: '地址', port: '埠', username: '使用者名稱', password: '密碼', language: '語言', website: '網站', general: '一般', warning: '警告', suggestion: '建議：',
  downloading: '下載緊', paused: '已暫停', error: '錯誤', added: '已加入', idle: '閒置', preparing_file: '準備檔案中', creating_file: '建立檔案中', resuming: '恢復緊', retrying: '重試緊', waiting: '等緊', canceled: '已取消', connecting: '連接緊', disconnected: '已斷開', receiving_data: '接收資料中', not_finished: '未完成',
  unknown: '未知', unknown_error: '未知錯誤', enabled: '已啟用', disabled: '已停用', default: '預設', unlimited: '無限制', use_global_settings: '用全域設定', yes: '係', no: '唔係', auto: '自動', custom: '自訂', unspecified: '不指定', system: '系統',
  list_is_empty: '清單係空嘅！', search_in_the_list: '喺清單入面搜尋',
  download_link: '下載連結', download_location: '下載位置', use_category: '用分類', select_queue: '揀隊列', without_queue: '唔用隊列', save_to: '儲存到',
  add_download: '新增下載', download_already_exists: '呢個下載已經存在', invalid_file_name: '檔案名稱無效', cant_write_to_this_folder: '寫入唔到呢個資料夾', file_name_already_exists: '檔案名已經存在',
  show_solutions: '顯示解決方法…', change_solution: '更改方案', select_a_solution: '揀個解決方法', select_download_strategy_description: '你俾嘅連結已經喺下載清單入面，請話俾我知你想點做',
  download_strategy_add_a_numbered_file: '加編號檔案', download_strategy_add_a_numbered_file_description: '喺檔案名後面加個編號', download_strategy_override_existing_file: '覆寫現有檔案', download_strategy_override_existing_file_description: '移除現有下載並寫入嗰個檔案', download_strategy_update_download_link: '更新現有下載', download_strategy_update_download_link_description: '更新現有下載嘅連結同認證資料', download_strategy_show_downloaded_file: '顯示已下載檔案', download_strategy_show_downloaded_file_description: '顯示已存在嘅下載項目，可以繼續或者開啟佢',
  resume_support: '支援續傳', on_completion: '完成之後', parts_info: '分段資訊', parts_info_downloaded_size: '已下載', parts_info_total_size: '總計', download_page_downloaded_size: '已下載', download_page_download_completed: '下載完成',
  unsupported_resume_warning: '呢個下載唔支援續傳！之後可能要喺下載清單重新開始', stop_anyway: '照樣停止', remember_this: '記住呢個選擇', customize_columns: '自訂欄位',
  confirm_delete_download_items_title: '確認刪除', also_delete_file_from_disk: '同時刪除磁碟上嘅檔案', your_download_will_not_be_deleted: '你嘅下載唔會被刪除',
  confirm_exit: '確認退出', confirm_exit_description: '真係要退出 AB 下載管理器？\n進行中嘅下載／隊列會停晒！',
  drop_link_or_file_here: '將連結或檔案掉落嚟呢度', nothing_will_be_imported: '冇嘢會被匯入',
  appearance: '外觀', download_engine: '下載引擎', browser_integration: '瀏覽器整合',
  settings_theme: '主題', settings_language: '語言', settings_font: '字體', settings_ui_scale: '介面縮放', settings_compact_top_bar: '緊湊頂欄', settings_show_icon_labels: '顯示圖示標籤', settings_use_relative_date_time: '用相對日期／時間', settings_start_on_boot: '開機自動啟動', settings_use_system_tray: '用系統匣', settings_download_size_unit: '大小單位', settings_download_speed_unit: '速度單位', settings_show_average_speed: '顯示平均速度', settings_notification_sound: '通知聲', settings_notification_sound_general: '一般通知聲', settings_notification_sound_error: '錯誤通知聲', settings_notification_sound_success: '成功通知聲', settings_show_download_progress_dialog: '自動顯示下載進度視窗', settings_show_completion_dialog: '顯示下載完成視窗',
  settings_default_download_folder: '預設下載資料夾', settings_use_category_by_default: '預設用分類', settings_global_speed_limiter: '全域限速', settings_download_thread_count: '線程數', settings_download_max_concurrent_downloads: '最大同時下載數', settings_download_max_retries_count: '最大重試次數', settings_dynamic_part_creation: '動態分段', settings_per_host_settings: '逐主機設定', settings_use_proxy: '使用代理', settings_default_user_agent: '預設 User-Agent', settings_ignore_ssl_certificates: '忽略 SSL 證書', settings_use_server_last_modified_time: '用伺服器修改時間', settings_track_deleted_files_on_disk: '追蹤磁碟上被刪嘅檔案', settings_append_extension_to_incomplete_downloads: '未完成下載加 .part 副檔名', settings_delete_partial_file_on_download_cancellation: '取消下載時刪除部分檔案', settings_use_sparse_file_allocation: '稀疏檔案配置',
  settings_browser_integration: '瀏覽器整合', settings_browser_integration_server_port: '伺服器埠', settings_api_auth_enabled: '使用 API 金鑰', settings_api_auth_key: 'API 金鑰',
  download_item_settings_speed_limit: '限速', download_item_settings_thread_count: '線程數', download_item_settings_download_page: '下載頁面', download_item_settings_file_checksum: '檔案校驗碼', download_item_settings_user_agent: 'User-Agent',
  proxy_no: '唔用代理', proxy_system: '系統代理', proxy_manual: '手動代理', proxy_pac: '代理自動設定 (PAC)', proxy_type: '代理類型', use_authentication: '使用認證', change_proxy: '更改代理',
  queue_max_concurrent_download: '最大同時下載', queue_automatic_stop: '自動停止', queue_scheduler: '排程器', queue_enable_scheduler: '啟用排程器', queue_active_days: '生效日子', queue_scheduler_enable_auto_start_time: '啟用自動開始時間', queue_scheduler_auto_start_time: '自動開始時間', queue_scheduler_enable_auto_stop_time: '啟用自動停止時間', queue_scheduler_auto_stop_time: '自動停止時間', queue_shutdown_on_completion: '完成後關機',
  monday: '星期一', tuesday: '星期二', wednesday: '星期三', thursday: '星期四', friday: '星期五', saturday: '星期六', sunday: '星期日',
  batch_download_link_help: '輸入一條有萬用字元嘅連結（用 *）', enter_range: '輸入範圍', range_from: '由', range_to: '到', batch_download_wildcard_length: '萬用字元長度', first_link: '第一條連結', last_link: '最後一條連結', invalid_url: '網址無效',
  file_checksum_page: '檔案校驗碼檢查器', checksum_algorithm: '演算法', calculated_checksum: '計算出嘅校驗碼', saved_checksum: '儲存咗嘅校驗碼', matches: '相符', not_matches: '唔相符', copy_to_clipboard: '複製到剪貼簿', file_not_found: '搵唔到檔案', download_not_finished: '下載未完成',
  settings_per_host_settings_host: '主機', settings_per_host_settings_new_host: '<新主機>', settings_per_host_settings_not_selected: '請先建立或者揀一個項目！',
  download_error: '下載錯誤', version_n: '版本 {{value}}', developed_with_love_for_you: '用❤️為你開發', donate: '捐助', visit_the_project_website: '去專案網站', this_is_a_free_and_open_source_software: '呢個係自由開源軟件', view_the_source_code: '睇原始碼', powered_by_open_source_software: '由開源軟件驅動', view_the_open_source_licenses: '睇開源授權', localized_by_translators: '由翻譯者本地化', meet_the_translators: '認識翻譯者', third_party_libraries: '第三方程式庫', translators: '翻譯者', channel: '頻道', group: '群組', contribute: '貢獻',
  update: '更新', update_updater: '更新程式', update_available: '有新版本', update_check_for_update: '檢查更新', update_checking_for_update: '檢查緊更新', update_no_update: '你用緊最新版本', update_check_error: '檢查更新時出錯', update_release_notes: '版本說明', update_available_suggest_to_to_update: '可以更新到最新版本，享受新功能、改進同效能提升。',
  shutdown_alert: '關機警告', system_shutdown_soon: '系統就嚟關機！', system_shutdown_failed: '系統關機失敗！', system_shutdown_soon_description: '系統好快就會關機。如果你仲用緊部電腦，請儲存你嘅工作或者取消關機。', shutdown_now: '而家關機', system_shutdown_reason_queue_completed: '隊列入面所有下載已經完成。', system_shutdown_download_finished: '下載完成。',
  select_all: '全選', select_inside: '選取範圍內', select_invert: '反向選取', sort_by: '排序方式',
  n_items_selected: '揀咗 {{count}} 項', n_links_will_be_imported: '會匯入 {{count}} 條連結',
  window_close: '關閉', window_minimize: '最小化', window_maximize: '最大化', window_restore: '還原',
  x_search_downloads: '搜尋下載', x_search_settings: '搜尋設定', x_search_menu: '篩選選單', x_search_tabs: '搜尋分頁',
  x_regex_builder: '正規表達式建構器', x_regex_mode: '正規模式', x_plain_text: '純文字', x_pattern: '規則', x_flags: '旗標', x_sample_text: '測試文字', x_live_matches: '即時匹配', x_capture_groups: '擷取組', x_no_matches: '冇匹配', x_invalid_pattern: '規則無效', x_copy_pattern: '複製規則', x_insert_token: '插入', x_anchors: '定位符', x_classes: '字元類別', x_groups: '群組', x_quantifiers: '數量詞', x_alternation: '或者', x_literals: '字面文字',
  x_tab_pin: '釘住分頁', x_tab_unpin: '解除釘住', x_tab_close: '關閉視窗', x_tab_close_others: '關閉其他', x_tab_close_right: '關閉右邊分頁', x_tab_close_containing: '關閉包含文字嘅分頁…', x_tab_close_not_containing: '關閉唔包含文字嘅分頁…', x_tab_group_new: '加入新群組…', x_tab_group_remove: '移出群組', x_tab_group_rename: '改群組名', x_tab_group_color: '群組顏色', x_tab_group_collapse: '收埋群組', x_tab_group_expand: '展開群組', x_tab_group_close: '關閉群組', x_tab_group_ungroup: '解散群組', x_tab_list: '所有視窗', x_tab_search_master: '搜尋所有視窗', x_tab_search_group: '喺群組入面搜尋', x_tab_search_groups: '按名搜尋群組',
  x_tabs_match_count: '{{count}} 個分頁匹配', x_tabs_will_close: '會關閉 {{count}} 個分頁', x_tabs_pinned_excluded: '已排除 {{count}} 個釘住分頁', x_include_pinned: '包埋釘住嘅分頁', x_bulk_close_empty: '要先入文字 — 空查詢唔會執行批量關閉。', x_group_name: '群組名', x_new_group: '新群組',
  x_notifications: '通知', x_notification_centre: '通知中心', x_clear_all: '全部清除', x_mark_read: '全部標為已讀', x_no_notifications: '暫時冇通知', x_no_notifications_body: '下載事件、隊列事件同錯誤會喺呢度出現。',
  x_super_confirm_title: '安全確認', x_super_confirm_body: '呢個動作冇得反悔。轉兩條鎖匙，然後推滑桿確認。', x_key_a: '鎖匙 A', x_key_b: '鎖匙 B', x_slide_to_confirm: '推到底確認', x_emergency_exit: '緊急退出', x_authorized: '已授權',
  x_edit_appearance: '編輯外觀…', x_edit_tab_appearance: '編輯分頁外觀…', x_edit_group_appearance: '編輯群組外觀…', x_appearance_editor: '外觀編輯器', x_target: '目標', x_typography: '字體排印', x_colors: '顏色', x_shape_spacing: '形狀同間距', x_font_family: '字體', x_font_size: '字號', x_font_weight: '字重', x_italic: '斜體', x_underline: '底線', x_strikethrough: '刪除線', x_letter_spacing: '字距', x_line_height: '行高', x_alignment: '對齊', x_text_color: '文字顏色', x_highlight: '底色', x_background_color: '背景', x_corner_radius: '圓角', x_padding: '內距', x_reset_element: '重設呢個元素', x_reset_all_appearance: '重設所有自訂', x_presets: '預設組合', x_save_preset: '儲存預設…', x_export_theme: '匯出主題', x_import_theme: '匯入主題',
  x_color_picker: '顏色揀選器', x_spectrum: '光譜', x_recent: '最近', x_contrast_vs: '對比度', x_gamut_warning: '超出 sRGB 色域 — 會被裁剪', x_copy_value: '複製數值',
  x_history: '版本歷史', x_history_empty: '仲未有修訂', x_restore: '還原', x_restored_as_new: '已還原為新修訂（歷史只會append）', x_filter_by_action: '按動作篩選', x_date_range: '日期範圍', x_today: '今日', x_last_7: '最近 7 日', x_last_30: '最近 30 日', x_all_time: '全部時間', x_search_history: '搜尋歷史', x_act_created: '建立', x_act_updated: '更新', x_act_deleted: '刪除', x_act_restored: '還原', x_act_imported: '匯入', x_act_settings: '設定更改', x_act_bulk: '批量動作',
  x_changelog: '更新日誌', x_changelog_search: '搜尋更新日誌', x_export_visible: '匯出可見範圍', x_release_codename: '版本代號', x_no_changes_recorded: '呢個版本冇記錄到更改。',
  x_export: '匯出…', x_export_title: '匯出', x_export_format: '格式', x_export_scope: '範圍', x_export_all: '全部（{{count}}）', x_export_selected: '已選（{{count}}）', x_export_filtered: '篩選結果（{{count}}）', x_download_file: '下載檔案', x_copy_output: '複製輸出',
  x_bulk_actions: '批量動作', x_selected_n: '揀咗 {{count}} 項', x_select_all_matching: '選晒全部匹配（{{count}}）', x_select_page: '選取可見', x_invert_selection: '反向選取', x_will_change: '{{count}} 項會改變', x_retry_failed: '重試失敗項目',
  x_language_mode: '語言模式', x_lang_en: 'English 英文', x_lang_yue: '廣東話', x_lang_bi: '雙語 Bilingual', x_funny_en: '好笑程度 — 英文', x_funny_yue: '好笑程度 — 廣東話', x_funny_desc: '影響呢種語言嘅所有文字 — 包括錯誤、警告同刪除提示。事實永遠唔會變，只係語氣變。1 = 完全認真，5 = 玩到盡。', x_funny_l1: '認真', x_funny_l2: '溫暖', x_funny_l3: '玩味', x_funny_l4: '串嘴', x_funny_l5: '玩到盡',
  x_narrator: '旁白', x_narrator_lang: '旁白語言', x_narrator_both: '兩種（先英後粵）', x_reduced_motion: '減少動態', x_density: '密度', x_comfortable: '舒適', x_compact: '緊湊', x_spacious: '寬鬆', x_seed_color: '主色（種子色）', x_theme_mode: '主題', x_light: '淺色', x_dark: '深色', x_follow_system: '跟隨系統',
  x_disclosure_title: '開始之前', x_disclosure_body: '呢個 app 每種語言都有「好笑程度」設定，會影響所有訊息 — 包括錯誤、警告同刪除提示。事實一定準確，只係語氣唔同。隨時可以喺 設定 → 外觀 度改。', x_got_it: '知道喇',
  x_dimsum_of_the_day: '小小心意', x_dimsum_note: '每次啟動有 10% 機會出現。唔會阻住你，一次啟動最多出現一次。',
  x_empty_title: '仲未有下載', x_empty_body: '用「新增下載」掣、貼上連結，或者將連結掉入嚟呢個視窗，加你第一個下載。', x_empty_filtered: '呢個篩選乜都冇', x_empty_filtered_body: '而家嘅分類、狀態同搜尋冇匹配嘅下載。清除篩選就見返成個清單。', x_clear_filters: '清除篩選',
  x_active: '進行中', x_global_speed: '整體速度', x_window: '視窗', x_columns: '欄位', x_apply: '套用', x_undo: '復原', x_view: '睇下', x_details: '詳情', x_test: '試下',
  x_download_added: '加咗「{{name}}」', x_download_finished: '「{{name}}」搞掂', x_download_failed: '「{{name}}」失敗：{{reason}}', x_download_paused: '「{{name}}」暫停咗', x_download_resumed: '「{{name}}」繼續緊', x_download_deleted: '刪咗 {{count}} 項', x_queue_started: '隊列「{{name}}」開始咗', x_queue_stopped: '隊列「{{name}}」停咗', x_queue_finished: '隊列「{{name}}」完成晒', x_links_imported: '匯入咗 {{count}} 條連結', x_clipboard_no_links: '剪貼簿入面冇可以下載嘅連結',
  x_confirm_delete_queue: '刪除隊列「{{name}}」？入面嘅項目會留返喺下載清單。',
  x_simulated_note: '模擬網絡 — 呢個原型唔會真係下載任何嘢。',
};

// ---------- Funny overlays. Voice only; every fact stays. ----------
const EN_F = {
  2: {
    x_empty_title: 'Nothing here yet', x_empty_body: 'Add your first download with the New download button, paste a link, or just drop one anywhere in this window.',
    x_download_finished: 'Nice — "{{name}}" is done', x_download_added: '"{{name}}" is in',
    list_is_empty: 'The list is empty.', update_no_update: 'You are all up to date',
    downloading: 'Downloading', x_got_it: 'Sounds good',
  },
  3: {
    x_empty_title: 'A very empty download list', x_empty_body: 'The big New download button is right there. Paste a link, drop a file — this list won\u2019t fill itself.',
    x_download_finished: '"{{name}}" landed safely', x_download_added: '"{{name}}" joined the list', x_download_failed: '"{{name}}" tripped: {{reason}}',
    downloading: 'Downloading', retrying: 'Retrying (again)', waiting: 'Waiting its turn', x_download_paused: '"{{name}}" is taking a break', x_download_resumed: '"{{name}}" is back at it',
    confirm_delete_download_items_description: 'Delete {{count}} items? They\u2019ll leave the list — files on disk stay unless you tick the box below.',
    update_no_update: 'Latest version. Nothing to fetch', x_queue_finished: 'Queue "{{name}}" cleared its plate',
    stop_anyway: 'Stop anyway', x_dimsum_of_the_day: 'Surprise! A little dim sum',
    x_slide_to_confirm: 'Slide all the way to confirm', drop_link_or_file_here: 'Drop it like it\u2019s a link (or a file)',
  },
  4: {
    x_empty_title: 'Echo… echo… (empty list)', x_empty_body: 'Zero downloads. The New download button is getting lonely — paste a link or drop one in.',
    x_download_finished: '"{{name}}" stuck the landing 100%', x_download_added: '"{{name}}" pulled up a chair', x_download_failed: '"{{name}}" face-planted: {{reason}}',
    retrying: 'Retrying — persistence is a virtue', waiting: 'In the waiting room', x_download_paused: '"{{name}}" hit snooze', x_download_resumed: '"{{name}}" un-snoozed',
    confirm_delete_download_items_description: 'Evicting {{count}} items from the list. Disk files survive unless you tick the box. Choose wisely.',
    x_queue_finished: 'Queue "{{name}}" — all done, mic drop', update_no_update: 'Newest of the new. Version-wise you\u2019re untouchable',
    x_dimsum_of_the_day: 'Kitchen sends its regards', x_slide_to_confirm: 'Slide it aaaall the way',
  },
  5: {
    x_empty_title: 'Gloriously, majestically empty', x_empty_body: 'Not a single download. A blank canvas. An untouched buffet. Smash New download, paste a link, or fling one into this window — history awaits.',
    x_empty_filtered: 'Filters ate everything', x_empty_filtered_body: 'Category + status + search agreed on exactly zero downloads. Clear the filters and the list comes back — promise.',
    x_download_finished: '"{{name}}" has ARRIVED. Roll out the red carpet', x_download_added: '"{{name}}" strutted onto the list', x_download_failed: '"{{name}}" went down in flames: {{reason}}. It happens to the best of us',
    x_download_paused: '"{{name}}" is on a tea break', x_download_resumed: '"{{name}}" slammed the tea down and got back to work', x_download_deleted: 'Poof — {{count}} item(s) gone from the list',
    downloading: 'Inhaling bytes', retrying: 'Retrying — never surrender', waiting: 'Queued and quietly plotting', preparing_file: 'Warming up the disk', resuming: 'Cracking knuckles',
    confirm_delete_download_items_title: 'The point of no return', confirm_delete_download_items_description: 'You\u2019re about to vaporise {{count}} items from the list. Files on disk survive unless you tick the box below. There is no undo for this one.',
    confirm_exit_description: 'Leaving already? Active downloads and queues will be stopped mid-bite!\nThey\u2019ll wait for you, unfinished, forever (or until you reopen the app).',
    x_queue_started: 'Queue "{{name}}" is OFF TO THE RACES', x_queue_stopped: 'Queue "{{name}}" slammed the brakes', x_queue_finished: 'Queue "{{name}}" devoured everything. Standing ovation',
    update_no_update: 'You\u2019re running the freshest build known to humankind', update_available: 'A shiny new version dropped',
    unsupported_resume_warning: 'This server does NOT do resumes. Pause now and you\u2019ll RESTART from zero later. Your call, hero.', stop_anyway: 'Stop anyway, I like danger',
    x_super_confirm_body: 'Deeply irreversible territory. Two keys, one slider, zero regrets — read what it says above before you turn anything.',
    x_slide_to_confirm: 'Sliiiiide to seal the deal', x_authorized: 'AUTHORIZED. May fortune favour you',
    x_dimsum_of_the_day: 'STEAMER ALERT! The kitchen blesses this launch', x_got_it: 'Say less',
    drop_link_or_file_here: 'FEED ME LINKS (files also accepted)', n_links_will_be_imported: '{{count}} tasty links will be imported',
    x_clipboard_no_links: 'Clipboard checked. Links found: zero. Awkward.', list_is_empty: 'Nothing. Nada. 空. Add something!',
    cant_write_to_this_folder: 'That folder said NO (no write permission)', download_already_exists: 'Déjà vu — this download already exists',
    x_restored_as_new: 'Time travel complete — restored as a brand-new revision (history stays append-only)',
  },
};
const YUE_F = {
  2: {
    x_download_finished: '「{{name}}」搞掂喇', x_empty_title: '呢度暫時空嘅', downloading: '下載緊',
  },
  3: {
    x_empty_title: '下載清單空到回音', x_empty_body: '「新增下載」個掣喺隔籬咋。貼條link、掉個檔案入嚟 — 清單唔會自己填滿自己㗎。',
    x_download_finished: '「{{name}}」安全著陸', x_download_added: '「{{name}}」入咗隊', x_download_failed: '「{{name}}」仆咗一跤：{{reason}}',
    x_download_paused: '「{{name}}」抖緊', x_download_resumed: '「{{name}}」返工喇', retrying: '再試緊（唔放棄）', waiting: '排緊隊',
    confirm_delete_download_items_description: '刪 {{count}} 項？佢哋會離開清單 — 磁碟上嘅檔案會留低，除非你剔埋下面個格。',
    x_queue_finished: '隊列「{{name}}」清晒枱', update_no_update: '最新版本，冇嘢好攞', x_dimsum_of_the_day: '嚟啦！一籠小驚喜',
    drop_link_or_file_here: '掉條link（或者檔案）落嚟',
  },
  4: {
    x_empty_title: '空？空到打乒乓波', x_download_finished: '「{{name}}」完美落地', x_download_added: '「{{name}}」搬咗張凳坐低', x_download_failed: '「{{name}}」炒咗車：{{reason}}',
    x_download_paused: '「{{name}}」去咗飲茶', x_download_resumed: '「{{name}}」飲完茶開返工', retrying: '再試 — 唔到黃河心不死',
    confirm_delete_download_items_description: '趕 {{count}} 項出清單。磁碟檔案冇事，除非你剔埋個格。諗清楚。',
    x_queue_finished: '隊列「{{name}}」食晒收工', x_dimsum_of_the_day: '廚房送禮',
  },
  5: {
    x_empty_title: '空空如也，乾乾淨淨', x_empty_body: '一個下載都冇。一張白紙、一圍未開嘅酒席。快啲撳「新增下載」、貼條link，或者大力掉條link入嚟 — 見證歷史啦！',
    x_empty_filtered: '啲篩選食晒所有嘢', x_empty_filtered_body: '分類＋狀態＋搜尋夾埋，結果係零。清除篩選，成個清單就返晒嚟 — 講咗算數。',
    x_download_finished: '「{{name}}」到埗！！鋪紅地氈啦', x_download_added: '「{{name}}」大搖大擺行入清單', x_download_failed: '「{{name}}」轟烈咁陣亡：{{reason}}。人生嘛', x_download_deleted: '嘭一聲 — 清單少咗 {{count}} 項',
    x_download_paused: '「{{name}}」去咗嘆茶', x_download_resumed: '「{{name}}」擺低個杯即刻開工',
    downloading: '狂吸緊啲bytes', retrying: '再嚟過 — 永不言敗', waiting: '排緊隊靜靜哋密謀', preparing_file: '同隻碟熱緊身', resuming: '拗緊手指準備開波',
    confirm_delete_download_items_title: '冇得返轉頭嘅一步', confirm_delete_download_items_description: '你就嚟從清單度蒸發 {{count}} 項。磁碟上嘅檔案會生還，除非你剔埋下面個格。呢一下冇得undo。',
    confirm_exit_description: '咁快走？進行中嘅下載同隊列會即刻停晒！\n佢哋會未完成咁等你返嚟（或者等到你開返個app為止）。',
    x_queue_started: '隊列「{{name}}」開閘衝喇！', x_queue_stopped: '隊列「{{name}}」急剎車', x_queue_finished: '隊列「{{name}}」食到碟都反埋。全場起立鼓掌',
    update_no_update: '你用緊全人類最新鮮嘅版本', update_available: '有靚版本新鮮出爐',
    unsupported_resume_warning: '個伺服器唔俾續傳㗎！而家暫停，遲啲就要由零開始。英雄，你話事。', stop_anyway: '照停，我唔怕',
    x_super_confirm_body: '深度冇得反悔地帶。兩條鎖匙、一條滑桿、零後悔 — 轉鎖匙之前睇清楚上面寫乜。',
    x_slide_to_confirm: '推～到～底～先算數', x_authorized: '批准咗！祝君好運',
    x_dimsum_of_the_day: '蒸籠嚟喇！廚房祝福呢次啟動', x_got_it: '收到收到',
    drop_link_or_file_here: '餵我食link！（檔案都食）', n_links_will_be_imported: '會匯入 {{count}} 條靚link',
    x_clipboard_no_links: '查過剪貼簿喇。搵到嘅link：零。好尷尬。', list_is_empty: '乜都冇。空晒。加返啲嘢啦！',
    cant_write_to_this_folder: '個資料夾話唔俾（冇寫入權限）', download_already_exists: '似曾相識 — 呢個下載已經存在',
  },
};

function resolve(dicts, level, key) {
  for (let l = level; l >= 2; l--) { const v = dicts[l] && dicts[l][key]; if (v != null) return v; }
  return null;
}
export function makeStrings(base) {
  const en = { ...base, ...EXTRA_EN };
  return {
    get(key, { lang = 'en', funnyEN = 1, funnyYUE = 1 } = {}) {
      const enStr = resolve(EN_F, funnyEN, key) ?? en[key] ?? key;
      const yueStr = resolve(YUE_F, funnyYUE, key) ?? YUE[key] ?? enStr;
      if (lang === 'yue') return { p: yueStr, s: '' };
      if (lang === 'bi') return { p: enStr, s: yueStr === enStr ? '' : yueStr };
      return { p: enStr, s: '' };
    },
    has(key) { return en[key] != null || YUE[key] != null; },
    keys() { return Object.keys(en); },
  };
}
export function fmt(str, args) {
  if (!args) return str;
  return String(str).replace(/\{\{(\w+)\}\}/g, (m, k) => (args[k] != null ? args[k] : m));
}
