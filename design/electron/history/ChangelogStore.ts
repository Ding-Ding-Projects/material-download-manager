import { validateRegexPattern } from "../../shared/regex";
import { exportRecords, isExportFormat, type ExportFormat, type ExportResult } from "../../shared/export";
import { evaluateRegexBatchIsolated } from "../regex/RegexWorkerClient";

export const CHANGELOG_SCHEMA_VERSION = 1 as const;
export const CHANGELOG_IPC_CHANNELS = {
  GET_VIEW: "changelog:getView",
  EXPORT_VIEW: "changelog:exportView",
} as const;

export const CHANGELOG_REPOSITORY_URL = "https://github.com/Ding-Ding-Projects/material-download-manager";

/**
 * Embedded from the repository's published stable release records at build
 * time. The renderer never fetches release data at runtime. Each record keeps
 * the factual release identity, source commit, and stable distribution state;
 * the store derives the credential-free commit URL.
 */
export const DEFAULT_CHANGELOG_ENTRIES: readonly ChangelogEntry[] = [
  {
    id: "v0.1.44",
    version: "0.1.44",
    releaseDate: "2026-08-07",
    title: "v0.1.44 — Steamed Squid with Garlic Vermicelli · 蒜蓉粉絲蒸魷魚",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Squid with Garlic Vermicelli · 蒜蓉粉絲蒸魷魚" },
      { category: "Handoff", text: "Recorded the verified auto-organize engine branch and its remaining Settings UI, documentation, and screenshot work in issue #11." },
      { category: "Source", text: "Release metadata identifies commit 58477373899251d2c9c569559961badb28b94243." },
    ],
    commitSha: "58477373899251d2c9c569559961badb28b94243",
  },
  {
    id: "v0.1.43",
    version: "0.1.43",
    releaseDate: "2026-08-07",
    title: "v0.1.43 — Steamed Tofu with Dried Scallop · 瑤柱蒸豆腐",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Tofu with Dried Scallop · 瑤柱蒸豆腐" },
      { category: "Engine", text: "Added the auto-organize engine for six category folders and bounded custom regular-expression rules, with the Settings UI explicitly left for the recorded handoff." },
      { category: "Source", text: "Release metadata identifies commit faf94df12007b205ceb30cf8d05a9d3adbb37a74." },
    ],
    commitSha: "faf94df12007b205ceb30cf8d05a9d3adbb37a74",
  },
  {
    id: "v0.1.42",
    version: "0.1.42",
    releaseDate: "2026-08-07",
    title: "v0.1.42 — Steamed Egg with Dried Scallop · 瑤柱蒸水蛋",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Egg with Dried Scallop · 瑤柱蒸水蛋" },
      { category: "Build", text: "Default-branch release of the narrow-site tab-rail correction that keeps mobile layouts within the viewport." },
      { category: "Source", text: "Release metadata identifies commit a5a78b9bf896e4c63398977681281d60c6764d4b." },
    ],
    commitSha: "a5a78b9bf896e4c63398977681281d60c6764d4b",
  },
  {
    id: "v0.1.41",
    version: "0.1.41",
    releaseDate: "2026-08-07",
    title: "v0.1.41 — Steamed Beef Patty with Tangerine Peel · 陳皮蒸牛肉餅",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Beef Patty with Tangerine Peel · 陳皮蒸牛肉餅" },
      { category: "Layout", text: "Made the mobile site tab rail stretch to the viewport and scroll internally instead of inflating narrow pages to roughly 700 pixels." },
      { category: "Source", text: "Release metadata identifies commit a5a78b9bf896e4c63398977681281d60c6764d4b." },
    ],
    commitSha: "a5a78b9bf896e4c63398977681281d60c6764d4b",
  },
  {
    id: "v0.1.40",
    version: "0.1.40",
    releaseDate: "2026-08-07",
    title: "v0.1.40 — Steamed Pork Patty with Salted Egg · 鹹蛋蒸肉餅",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Pork Patty with Salted Egg · 鹹蛋蒸肉餅" },
      { category: "Changelog", text: "Brought the offline changelog through v0.1.39 and recorded the self-healing Electron bootstrap verification evidence." },
      { category: "Source", text: "Release metadata identifies commit 28a821167fb4f9c88393e2d9540e2b3f9a068152." },
    ],
    commitSha: "28a821167fb4f9c88393e2d9540e2b3f9a068152",
  },
  {
    id: "v0.1.39",
    version: "0.1.39",
    releaseDate: "2026-08-07",
    title: "v0.1.39 — Salted Caramel Chocolate Dumpling · 海鹽焦糖朱古力餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Salted Caramel Chocolate Dumpling · 海鹽焦糖朱古力餃" },
      { category: "Build", text: "Default-branch integration of the self-healing electron binary bootstrap: ensure-electron-binary.mjs verifies the platform binary synchronously before start and the UI smoke harness, restoring it from a checksum-verified archive when the electron installer silently produces nothing." },
      { category: "Source", text: "Release metadata identifies commit 356dc99d0d2124b6b8aea585ac6e3a13ea393525." },
    ],
    commitSha: "356dc99d0d2124b6b8aea585ac6e3a13ea393525",
  },
  {
    id: "v0.1.38",
    version: "0.1.38",
    releaseDate: "2026-08-07",
    title: "v0.1.38 — Mushroom Pork Tofu Skin Parcel · 北菇豬肉腐皮扎",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Mushroom Pork Tofu Skin Parcel · 北菇豬肉腐皮扎" },
      { category: "Build", text: "Branch verification release for the self-healing electron binary bootstrap before its default-branch merge." },
      { category: "Source", text: "Release metadata identifies commit 0aed1d21d2eda649f3f715ec55d79caa4602fe8d." },
    ],
    commitSha: "0aed1d21d2eda649f3f715ec55d79caa4602fe8d",
  },
  {
    id: "v0.1.37",
    version: "0.1.37",
    releaseDate: "2026-08-07",
    title: "v0.1.37 — Chicken and Fish Maw Bean Curd Roll · 雞絲花膠腐皮卷",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Chicken and Fish Maw Bean Curd Roll · 雞絲花膠腐皮卷" },
      { category: "Source", text: "Release metadata identifies commit a1cf009ce1135be656f8fc1c6889ade7d2724834." },
    ],
    commitSha: "a1cf009ce1135be656f8fc1c6889ade7d2724834",
  },
  {
    id: "v0.1.36",
    version: "0.1.36",
    releaseDate: "2026-08-07",
    title: "v0.1.36 — Oyster Sauce Bean Curd Skin Roll · 蠔皇鮮竹卷",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Oyster Sauce Bean Curd Skin Roll · 蠔皇鮮竹卷" },
      { category: "Source", text: "Release metadata identifies commit 327b5a2a7a1b45ad691d21f56eb8a6ca414c1b84." },
    ],
    commitSha: "327b5a2a7a1b45ad691d21f56eb8a6ca414c1b84",
  },
  {
    id: "v0.1.35",
    version: "0.1.35",
    releaseDate: "2026-08-07",
    title: "v0.1.35 — Steamed Bean Curd Skin Roll · 鮮竹卷",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Bean Curd Skin Roll · 鮮竹卷" },
      { category: "Source", text: "Release metadata identifies commit a221f31a5479bfb1fda736eae36a37351a923c0d." },
    ],
    commitSha: "a221f31a5479bfb1fda736eae36a37351a923c0d",
  },
  {
    id: "v0.1.34",
    version: "0.1.34",
    releaseDate: "2026-08-07",
    title: "v0.1.34 — Steamed Bitter Melon Stuffed with Fish · 鯪魚釀苦瓜",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Bitter Melon Stuffed with Fish · 鯪魚釀苦瓜" },
      { category: "Source", text: "Release metadata identifies commit 2602fdb4650194a53459f8903ee2856218ca9df0." },
    ],
    commitSha: "2602fdb4650194a53459f8903ee2856218ca9df0",
  },
  {
    id: "v0.1.33",
    version: "0.1.33",
    releaseDate: "2026-08-07",
    title: "v0.1.33 — Steamed Eggplant Stuffed with Shrimp · 百花釀茄子",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Eggplant Stuffed with Shrimp · 百花釀茄子" },
      { category: "Source", text: "Release metadata identifies commit 0050941cd34005b29ab4f31368101c3a9c5de4a6." },
    ],
    commitSha: "0050941cd34005b29ab4f31368101c3a9c5de4a6",
  },
  {
    id: "v0.1.32",
    version: "0.1.32",
    releaseDate: "2026-08-07",
    title: "v0.1.32 — Steamed Tofu Stuffed with Shrimp · 百花釀豆腐",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Tofu Stuffed with Shrimp · 百花釀豆腐" },
      { category: "Source", text: "Release metadata identifies commit 0050941cd34005b29ab4f31368101c3a9c5de4a6." },
    ],
    commitSha: "0050941cd34005b29ab4f31368101c3a9c5de4a6",
  },
  {
    id: "v0.1.31",
    version: "0.1.31",
    releaseDate: "2026-08-07",
    title: "v0.1.31 — Steamed Fish Maw with Oyster Sauce · 蠔皇蒸花膠",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Fish Maw with Oyster Sauce · 蠔皇蒸花膠" },
      { category: "Source", text: "Release metadata identifies commit 613869cdff1e68c35d6b0dda1d60f73ef2aa4271." },
    ],
    commitSha: "613869cdff1e68c35d6b0dda1d60f73ef2aa4271",
  },
  {
    id: "v0.1.30",
    version: "0.1.30",
    releaseDate: "2026-08-07",
    title: "v0.1.30 — Steamed Curry Cuttlefish · 咖喱蒸魷魚",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Curry Cuttlefish · 咖喱蒸魷魚" },
      { category: "Source", text: "Release metadata identifies commit 613869cdff1e68c35d6b0dda1d60f73ef2aa4271." },
    ],
    commitSha: "613869cdff1e68c35d6b0dda1d60f73ef2aa4271",
  },
  {
    id: "v0.1.29",
    version: "0.1.29",
    releaseDate: "2026-08-07",
    title: "v0.1.29 — Steamed Beef Tripe with Chu Hou Sauce · 柱侯金錢肚",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Beef Tripe with Chu Hou Sauce · 柱侯金錢肚" },
      { category: "Source", text: "Release metadata identifies commit 49c9e13682ac96481406e92e7e00866abdc9433e." },
    ],
    commitSha: "49c9e13682ac96481406e92e7e00866abdc9433e",
  },
  {
    id: "v0.1.28",
    version: "0.1.28",
    releaseDate: "2026-08-07",
    title: "v0.1.28 — Steamed Beef Tripe with Ginger and Scallion · 薑蔥牛柏葉",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Beef Tripe with Ginger and Scallion · 薑蔥牛柏葉" },
      { category: "Source", text: "Release metadata identifies commit d37ad7cacbd7528bc80551375dc683be36c73eec." },
    ],
    commitSha: "d37ad7cacbd7528bc80551375dc683be36c73eec",
  },
  {
    id: "v0.1.27",
    version: "0.1.27",
    releaseDate: "2026-08-07",
    title: "v0.1.27 — Satay Chicken Feet · 沙嗲蒸鳳爪",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Satay Chicken Feet · 沙嗲蒸鳳爪" },
      { category: "Source", text: "Release metadata identifies commit d37ad7cacbd7528bc80551375dc683be36c73eec." },
    ],
    commitSha: "d37ad7cacbd7528bc80551375dc683be36c73eec",
  },
  {
    id: "v0.1.26",
    version: "0.1.26",
    releaseDate: "2026-08-07",
    title: "v0.1.26 — Steamed Chicken Feet in Black Bean Sauce · 豉汁蒸鳳爪",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Chicken Feet in Black Bean Sauce · 豉汁蒸鳳爪" },
      { category: "Source", text: "Release metadata identifies commit 17cb95cd363b6935b9e9f6343825de51df2524d1." },
    ],
    commitSha: "17cb95cd363b6935b9e9f6343825de51df2524d1",
  },
  {
    id: "v0.1.25",
    version: "0.1.25",
    releaseDate: "2026-08-07",
    title: "v0.1.25 — Steamed Pork Ribs with Plum Sauce · 梅子蒸排骨",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Pork Ribs with Plum Sauce · 梅子蒸排骨" },
      { category: "Source", text: "Release metadata identifies commit 17cb95cd363b6935b9e9f6343825de51df2524d1." },
    ],
    commitSha: "17cb95cd363b6935b9e9f6343825de51df2524d1",
  },
  {
    id: "v0.1.24",
    version: "0.1.24",
    releaseDate: "2026-08-07",
    title: "v0.1.24 — Steamed Pork Ribs with Garlic · 蒜香蒸排骨",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Pork Ribs with Garlic · 蒜香蒸排骨" },
      { category: "Source", text: "Release metadata identifies commit 45ad1b54e4911a39e6c43287fd9e68d6bd9b850c." },
    ],
    commitSha: "45ad1b54e4911a39e6c43287fd9e68d6bd9b850c",
  },
  {
    id: "v0.1.23",
    version: "0.1.23",
    releaseDate: "2026-08-07",
    title: "v0.1.23 — Steamed Pork Ribs with Black Bean · 豉汁蒸排骨",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Pork Ribs with Black Bean · 豉汁蒸排骨" },
      { category: "Source", text: "Release metadata identifies commit 45ad1b54e4911a39e6c43287fd9e68d6bd9b850c." },
    ],
    commitSha: "45ad1b54e4911a39e6c43287fd9e68d6bd9b850c",
  },
  {
    id: "v0.1.22",
    version: "0.1.22",
    releaseDate: "2026-08-07",
    title: "v0.1.22 — Watercress Beef Balls · 西洋菜牛肉球",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Watercress Beef Balls · 西洋菜牛肉球" },
      { category: "Source", text: "Release metadata identifies commit 35445636a3dd12b2004f2e5b374e5effef68562d." },
    ],
    commitSha: "35445636a3dd12b2004f2e5b374e5effef68562d",
  },
  {
    id: "v0.1.21",
    version: "0.1.21",
    releaseDate: "2026-08-07",
    title: "v0.1.21 — Dried Tangerine Peel Beef Balls · 陳皮牛肉球",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Dried Tangerine Peel Beef Balls · 陳皮牛肉球" },
      { category: "Source", text: "Release metadata identifies commit 433c54dd72f749da8ecb611bd04f677b994115a2." },
    ],
    commitSha: "433c54dd72f749da8ecb611bd04f677b994115a2",
  },
  {
    id: "v0.1.20",
    version: "0.1.20",
    releaseDate: "2026-08-07",
    title: "v0.1.20 — Steamed Beef Balls · 山竹牛肉",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Steamed Beef Balls · 山竹牛肉" },
      { category: "Source", text: "Release metadata identifies commit 433c54dd72f749da8ecb611bd04f677b994115a2." },
    ],
    commitSha: "433c54dd72f749da8ecb611bd04f677b994115a2",
  },
  {
    id: "v0.1.19",
    version: "0.1.19",
    releaseDate: "2026-08-07",
    title: "v0.1.19 — Dark Chocolate Crystal Dumpling · 黑朱古力水晶餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Dark Chocolate Crystal Dumpling · 黑朱古力水晶餃" },
      { category: "Source", text: "Release metadata identifies commit 104a487d9b640b441663017c365de72d2e8a79cb." },
    ],
    commitSha: "104a487d9b640b441663017c365de72d2e8a79cb",
  },
  {
    id: "v0.1.18",
    version: "0.1.18",
    releaseDate: "2026-08-07",
    title: "v0.1.18 — Black Truffle Siu Mai · 黑松露燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Black Truffle Siu Mai · 黑松露燒賣" },
      { category: "Source", text: "Release metadata identifies commit a0c27b621fa957de99d129d95df7a7e9bee396f6." },
    ],
    commitSha: "a0c27b621fa957de99d129d95df7a7e9bee396f6",
  },
  {
    id: "v0.1.17",
    version: "0.1.17",
    releaseDate: "2026-08-07",
    title: "v0.1.17 — Fish Maw Siu Mai · 花膠燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Fish Maw Siu Mai · 花膠燒賣" },
      { category: "Source", text: "Release metadata identifies commit a0c27b621fa957de99d129d95df7a7e9bee396f6." },
    ],
    commitSha: "a0c27b621fa957de99d129d95df7a7e9bee396f6",
  },
  {
    id: "v0.1.16",
    version: "0.1.16",
    releaseDate: "2026-08-07",
    title: "v0.1.16 — Mushroom Siu Mai · 北菇燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Mushroom Siu Mai · 北菇燒賣" },
      { category: "Source", text: "Release metadata identifies commit 5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c." },
    ],
    commitSha: "5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c",
  },
  {
    id: "v0.1.15",
    version: "0.1.15",
    releaseDate: "2026-08-07",
    title: "v0.1.15 — Chicken Siu Mai · 雞肉燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Chicken Siu Mai · 雞肉燒賣" },
      { category: "Source", text: "Release metadata identifies commit 5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c." },
    ],
    commitSha: "5b968f54e976ca32f2d1c5b003acd5f34bdd9b5c",
  },
  {
    id: "v0.1.14",
    version: "0.1.14",
    releaseDate: "2026-08-07",
    title: "v0.1.14 — Beef Siu Mai · 牛肉燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Beef Siu Mai · 牛肉燒賣" },
      { category: "Source", text: "Release metadata identifies commit 57a43a2bf303c02ae84183f8b22d366e43c96105." },
    ],
    commitSha: "57a43a2bf303c02ae84183f8b22d366e43c96105",
  },
  {
    id: "v0.1.13",
    version: "0.1.13",
    releaseDate: "2026-08-07",
    title: "v0.1.13 — Scallop Siu Mai · 帶子燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Scallop Siu Mai · 帶子燒賣" },
      { category: "Source", text: "Release metadata identifies commit 57a43a2bf303c02ae84183f8b22d366e43c96105." },
    ],
    commitSha: "57a43a2bf303c02ae84183f8b22d366e43c96105",
  },
  {
    id: "v0.1.12",
    version: "0.1.12",
    releaseDate: "2026-08-07",
    title: "v0.1.12 — Quail Egg Siu Mai · 鵪鶉蛋燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Quail Egg Siu Mai · 鵪鶉蛋燒賣" },
      { category: "Source", text: "Release metadata identifies commit e6fd63d4227c740c7b73298784d95d0b84b9a869." },
    ],
    commitSha: "e6fd63d4227c740c7b73298784d95d0b84b9a869",
  },
  {
    id: "v0.1.11",
    version: "0.1.11",
    releaseDate: "2026-08-07",
    title: "v0.1.11 — Crab Roe Siu Mai · 蟹籽燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Crab Roe Siu Mai · 蟹籽燒賣" },
      { category: "Source", text: "Release metadata identifies commit e6fd63d4227c740c7b73298784d95d0b84b9a869." },
    ],
    commitSha: "e6fd63d4227c740c7b73298784d95d0b84b9a869",
  },
  {
    id: "v0.1.10",
    version: "0.1.10",
    releaseDate: "2026-08-07",
    title: "v0.1.10 — Classic Siu Mai · 燒賣",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Classic Siu Mai · 燒賣" },
      { category: "Source", text: "Release metadata identifies commit 895bc6e16de223111721457c05b09bfe641c7641." },
    ],
    commitSha: "895bc6e16de223111721457c05b09bfe641c7641",
  },
  {
    id: "v0.1.9",
    version: "0.1.9",
    releaseDate: "2026-08-07",
    title: "v0.1.9 — Cuttlefish Shrimp Dumpling · 墨魚蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Cuttlefish Shrimp Dumpling · 墨魚蝦餃" },
      { category: "Source", text: "Release metadata identifies commit 895bc6e16de223111721457c05b09bfe641c7641." },
    ],
    commitSha: "895bc6e16de223111721457c05b09bfe641c7641",
  },
  {
    id: "v0.1.8",
    version: "0.1.8",
    releaseDate: "2026-08-07",
    title: "v0.1.8 — Dried Scallop Shrimp Dumpling · 瑤柱蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Dried Scallop Shrimp Dumpling · 瑤柱蝦餃" },
      { category: "Source", text: "Release metadata identifies commit a008ce6446e5d25a02574d708401e4075e2253ac." },
    ],
    commitSha: "a008ce6446e5d25a02574d708401e4075e2253ac",
  },
  {
    id: "v0.1.7",
    version: "0.1.7",
    releaseDate: "2026-08-07",
    title: "v0.1.7 — Lobster Dumpling · 龍蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Lobster Dumpling · 龍蝦餃" },
      { category: "Source", text: "Release metadata identifies commit a008ce6446e5d25a02574d708401e4075e2253ac." },
    ],
    commitSha: "a008ce6446e5d25a02574d708401e4075e2253ac",
  },
  {
    id: "v0.1.6",
    version: "0.1.6",
    releaseDate: "2026-08-07",
    title: "v0.1.6 — Pea Shoot Shrimp Dumpling · 豆苗蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Pea Shoot Shrimp Dumpling · 豆苗蝦餃" },
      { category: "Source", text: "Release metadata identifies commit 47e493f0b2448dba24bd755e5a0eb0029b769ed4." },
    ],
    commitSha: "47e493f0b2448dba24bd755e5a0eb0029b769ed4",
  },
  {
    id: "v0.1.5",
    version: "0.1.5",
    releaseDate: "2026-08-07",
    title: "v0.1.5 — Spinach Shrimp Dumpling · 菠菜蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Spinach Shrimp Dumpling · 菠菜蝦餃" },
      { category: "Source", text: "Release metadata identifies commit 47e493f0b2448dba24bd755e5a0eb0029b769ed4." },
    ],
    commitSha: "47e493f0b2448dba24bd755e5a0eb0029b769ed4",
  },
  {
    id: "v0.1.4",
    version: "0.1.4",
    releaseDate: "2026-08-07",
    title: "v0.1.4 — Chive Shrimp Dumpling · 韭菜蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Chive Shrimp Dumpling · 韭菜蝦餃" },
      { category: "Source", text: "Release metadata identifies commit ea038ace72cfb1e36307884a21a8467304a0fefb." },
    ],
    commitSha: "ea038ace72cfb1e36307884a21a8467304a0fefb",
  },
  {
    id: "v0.1.3",
    version: "0.1.3",
    releaseDate: "2026-08-07",
    title: "v0.1.3 — Crab Roe Har Gow · 蟹籽蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Crab Roe Har Gow · 蟹籽蝦餃" },
      { category: "Source", text: "Release metadata identifies commit ea038ace72cfb1e36307884a21a8467304a0fefb." },
    ],
    commitSha: "ea038ace72cfb1e36307884a21a8467304a0fefb",
  },
  {
    id: "v0.1.2",
    version: "0.1.2",
    releaseDate: "2026-08-07",
    title: "v0.1.2 — Bamboo Shoot Har Gow · 筍尖蝦餃",
    changes: [
      { category: "Release", text: "Published as a stable, non-draft, non-prerelease release with intentionally unsigned Squirrel.Windows artifacts." },
      { category: "Code name", text: "Bamboo Shoot Har Gow · 筍尖蝦餃" },
      { category: "Source", text: "Release metadata identifies commit 63a8bdcfb5ff577e08fa0d6d030f3d5d9a6b3e2c." },
    ],
    commitSha: "63a8bdcfb5ff577e08fa0d6d030f3d5d9a6b3e2c",
  },
];

const MAX_ENTRIES = 512;
const MAX_ID_LENGTH = 128;
const MAX_VERSION_LENGTH = 128;
const MAX_TITLE_LENGTH = 512;
const MAX_CHANGE_LENGTH = 4_096;
const MAX_SEARCH_LENGTH = 2_048;
const COMMIT_SHA = /^[0-9a-f]{40}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ChangelogCategory = string;

export interface ChangelogChange {
  category: ChangelogCategory;
  text: string;
}

/** Source data is factual and contains no derived forge URL or renderer markup. */
export interface ChangelogEntry {
  id: string;
  version: string;
  releaseDate: string;
  title: string;
  changes: ChangelogChange[];
  commitSha: string;
}

export interface ChangelogViewEntry extends ChangelogEntry {
  commitUrl: string;
}

export interface ChangelogViewRequest {
  search: string;
  regex: boolean;
  flags: string;
  dateFrom: string | null;
  dateTo: string | null;
}

export interface ChangelogView {
  schemaVersion: typeof CHANGELOG_SCHEMA_VERSION;
  entries: ChangelogViewEntry[];
  totalEntries: number;
  matchingEntries: number;
  request: ChangelogViewRequest;
  emptyReason: string | null;
}

function isSafeCommitUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
      /\/commit\/[0-9a-f]{40}$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** Runtime response guard for a future preload bridge to validate IPC data. */
export function isChangelogView(value: unknown): value is ChangelogView {
  if (!isRecord(value) || value.schemaVersion !== CHANGELOG_SCHEMA_VERSION ||
    typeof value.totalEntries !== "number" || typeof value.matchingEntries !== "number" ||
    !Array.isArray(value.entries) || !isRecord(value.request) ||
    (value.emptyReason !== null && typeof value.emptyReason !== "string")) {
    return false;
  }
  if (value.totalEntries < 0 || value.matchingEntries < 0 || value.matchingEntries > value.totalEntries || value.entries.length !== value.matchingEntries) {
    return false;
  }
  if (typeof value.request.search !== "string" || typeof value.request.regex !== "boolean" ||
    typeof value.request.flags !== "string" ||
    (value.request.dateFrom !== null && typeof value.request.dateFrom !== "string") ||
    (value.request.dateTo !== null && typeof value.request.dateTo !== "string")) {
    return false;
  }
  return value.entries.every((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.version !== "string" ||
      typeof entry.releaseDate !== "string" || !ISO_DATE.test(entry.releaseDate) ||
      typeof entry.title !== "string" || !Array.isArray(entry.changes) ||
      typeof entry.commitSha !== "string" || !COMMIT_SHA.test(entry.commitSha) ||
      !isSafeCommitUrl(entry.commitUrl)) return false;
    return entry.changes.every((change) => isRecord(change) && typeof change.category === "string" && typeof change.text === "string");
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertBoundedString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${field}`);
  }
}

function assertIsoDate(value: unknown, field: string): asserts value is string {
  assertBoundedString(value, field, 10);
  if (!ISO_DATE.test(value)) throw new Error(`Invalid ${field}`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (parsed.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ${field}`);
}

function parseChange(value: unknown, index: number): ChangelogChange {
  if (!isRecord(value)) throw new Error(`Invalid changelog change ${index}`);
  assertBoundedString(value.category, `changelog change ${index} category`, 64);
  assertBoundedString(value.text, `changelog change ${index} text`, MAX_CHANGE_LENGTH);
  return { category: value.category, text: value.text };
}

function parseEntry(value: unknown, index: number): ChangelogEntry {
  if (!isRecord(value)) throw new Error(`Invalid changelog entry ${index}`);
  assertBoundedString(value.id, `changelog entry ${index} id`, MAX_ID_LENGTH);
  assertBoundedString(value.version, `changelog entry ${index} version`, MAX_VERSION_LENGTH);
  assertIsoDate(value.releaseDate, `changelog entry ${index} release date`);
  assertBoundedString(value.title, `changelog entry ${index} title`, MAX_TITLE_LENGTH);
  if (!Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 64) {
    throw new Error(`Invalid changelog entry ${index} changes`);
  }
  assertBoundedString(value.commitSha, `changelog entry ${index} commit SHA`, 40);
  if (!COMMIT_SHA.test(value.commitSha)) throw new Error(`Invalid changelog entry ${index} commit SHA`);
  return {
    id: value.id,
    version: value.version,
    releaseDate: value.releaseDate,
    title: value.title,
    changes: value.changes.map(parseChange),
    commitSha: value.commitSha.toLowerCase(),
  };
}

export function parseChangelogEntries(value: unknown): ChangelogEntry[] {
  const source = isRecord(value) && Array.isArray(value.entries) ? value.entries : value;
  if (!Array.isArray(source) || source.length > MAX_ENTRIES) throw new Error("Invalid changelog entries");
  const ids = new Set<string>();
  return source.map((entry, index) => {
    const parsed = parseEntry(entry, index);
    if (ids.has(parsed.id)) throw new Error(`Duplicate changelog entry id: ${parsed.id}`);
    ids.add(parsed.id);
    return parsed;
  });
}

function normalizeRepositoryUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid changelog repository URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Changelog repository URL must be credential-free HTTPS");
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Changelog repository URL must identify one repository");
  }
  return `${url.origin}/${parts.join("/")}`;
}

export function normalizeChangelogViewRequest(value: unknown): ChangelogViewRequest {
  if (value === undefined || value === null) {
    return { search: "", regex: false, flags: "", dateFrom: null, dateTo: null };
  }
  if (!isRecord(value)) throw new Error("Invalid changelog view request");
  const search = value.search === undefined ? "" : value.search;
  if (typeof search !== "string" || search.length > MAX_SEARCH_LENGTH) throw new Error("Invalid changelog search");
  const regex = value.regex === undefined ? false : value.regex;
  if (typeof regex !== "boolean") throw new Error("Invalid changelog search mode");
  const flags = value.flags === undefined ? "" : value.flags;
  if (typeof flags !== "string" || flags.length > 6) throw new Error("Invalid changelog regex flags");
  if (validateRegexPattern(regex ? search : "", flags)) {
    throw new Error("Invalid changelog regular expression");
  }
  const dateFrom = value.dateFrom === undefined || value.dateFrom === null ? null : value.dateFrom;
  const dateTo = value.dateTo === undefined || value.dateTo === null ? null : value.dateTo;
  if (dateFrom !== null) assertIsoDate(dateFrom, "changelog start date");
  if (dateTo !== null) assertIsoDate(dateTo, "changelog end date");
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error("Changelog start date must not be after end date");
  return { search, regex, flags, dateFrom, dateTo };
}

function entrySearchText(entry: ChangelogEntry): string {
  return [
    entry.id,
    entry.version,
    entry.releaseDate,
    entry.title,
    ...entry.changes.flatMap((change) => [change.category, change.text]),
  ].join(" ");
}

function matches(entry: ChangelogEntry, request: ChangelogViewRequest): boolean {
  if (request.dateFrom && entry.releaseDate < request.dateFrom) return false;
  if (request.dateTo && entry.releaseDate > request.dateTo) return false;
  if (!request.search) return true;
  const haystack = entrySearchText(entry);
  return request.regex || haystack.toLocaleLowerCase().includes(request.search.toLocaleLowerCase());
}

function cloneEntry(entry: ChangelogEntry, repositoryUrl: string): ChangelogViewEntry {
  return {
    ...entry,
    changes: entry.changes.map((change) => ({ ...change })),
    commitUrl: `${repositoryUrl}/commit/${entry.commitSha}`,
  };
}

export class ChangelogStore {
  private readonly entries: ChangelogEntry[];
  private readonly repositoryUrl: string;

  constructor(
    entries: unknown,
    repositoryUrl: string,
    private readonly evaluateRegexBatch = evaluateRegexBatchIsolated
  ) {
    this.entries = parseChangelogEntries(entries);
    this.repositoryUrl = normalizeRepositoryUrl(repositoryUrl);
  }

  getEntries(): ChangelogViewEntry[] {
    return this.entries.map((entry) => cloneEntry(entry, this.repositoryUrl));
  }

  async getView(request: unknown = undefined): Promise<ChangelogView> {
    const normalized = normalizeChangelogViewRequest(request);
    let entries = this.entries.filter((entry) => matches(entry, normalized));
    if (normalized.regex && normalized.search && entries.length > 0) {
      const evaluations = await this.evaluateRegexBatch(
        normalized.search,
        normalized.flags,
        entries.map(entrySearchText)
      );
      const evaluationError = evaluations.find((evaluation) => evaluation.error)?.error;
      if (evaluationError) throw new Error(`Changelog regular expression evaluation failed: ${evaluationError}`);
      entries = entries.filter((_, index) => (evaluations[index]?.matches.length ?? 0) > 0);
    }
    return {
      schemaVersion: CHANGELOG_SCHEMA_VERSION,
      entries: entries.map((entry) => cloneEntry(entry, this.repositoryUrl)),
      totalEntries: this.entries.length,
      matchingEntries: entries.length,
      request: normalized,
      emptyReason: entries.length === 0
        ? normalized.search || normalized.dateFrom || normalized.dateTo
          ? "No changelog entries match the active search or date filter."
          : "No changelog entries are available."
        : null,
    };
  }

  async exportView(format: ExportFormat, request: unknown = undefined): Promise<ExportResult> {
    if (!isExportFormat(format)) throw new Error("Invalid changelog export format");
    const view = await this.getView(request);
    return exportRecords(view.entries.map((entry) => ({
      id: entry.id,
      version: entry.version,
      releaseDate: entry.releaseDate,
      title: entry.title,
      changes: entry.changes,
      commitSha: entry.commitSha,
      commitUrl: entry.commitUrl,
    })), format);
  }
}

export interface ChangelogIpcHandlers {
  getView(request: unknown): Promise<ChangelogView>;
  exportView(request: unknown, format: unknown): Promise<ExportResult>;
}

/**
 * IPC-safe adapter: it accepts only structured, bounded data and returns plain
 * serializable view objects. The main process can register these methods with
 * ipcMain.handle without giving the renderer a store, filesystem, or network
 * capability. No handler performs a network fetch.
 */
export function createChangelogIpcHandlers(store: ChangelogStore): ChangelogIpcHandlers {
  return {
    getView: (request) => store.getView(request),
    exportView: (request, format) => {
      if (!isExportFormat(format)) throw new Error("Invalid changelog export format");
      return store.exportView(format, request);
    },
  };
}
