(function (global) {
  "use strict";

  const CONTROL_CAPTURE_PATHS = Object.freeze({
    "picker-theme": "../docs/screenshots/site/interactive-controls-theme-picker.png",
    "picker-appearance-target": "../docs/screenshots/site/interactive-controls-appearance-target-picker.png",
    "picker-appearance-spacing": "../docs/screenshots/site/interactive-controls-appearance-spacing-picker.png",
    "picker-notification-filter": "../docs/screenshots/site/interactive-controls-notification-filter-picker.png",
    "tab-context-menu": "../docs/screenshots/site/interactive-controls-regex-menu.png",
    "appearance-render-readers": "../docs/screenshots/site/interactive-controls-appearance-target-picker.png",
    "tab-discovery-activation": "../docs/screenshots/site/interactive-controls-regex-menu.png"
  });
  const CHECK_ANCHOR = 'const INTERACTIVE_CONTROLS_CHUT_ANCHOR = "site-controls-regex-completeness-v1";';
  const COMMON_ANCHORS = Object.freeze({
    html: Object.freeze([
      '<script src="./data/interactive-controls-contract.js"></script>'
    ]),
    app: Object.freeze([
      'function chooseChoiceOption(id, value) {',
      'function handleChoiceOptionKeydown(id, event) {',
      'function renderContextMenuOptions() {',
      'function applyPinnedTabState() {'
    ]),
    css: Object.freeze([
      '.choice-picker { position: relative; min-width: 0; }',
      '.choice-picker-panel { position: absolute; z-index: 45; top: calc(100% + .35rem); left: 0; width: min(32rem, calc(100vw - 2rem)); max-height: min(28rem, calc(100vh - 4rem)); overflow: auto; padding: .7rem; border: 1px solid var(--outline); border-radius: var(--radius-md); background: var(--surface-container-high); box-shadow: var(--shadow-2); }',
      '.context-menu-filter { padding: .2rem .2rem .55rem; border-bottom: 1px solid var(--outline-variant); }'
    ])
  });
  const CONTROL_INVENTORY = Object.freeze([
    Object.freeze({
      id: "picker-theme",
      title: "Theme selector",
      kind: "select-picker",
      anchors: Object.freeze({
        html: '<div class="choice-picker" data-select-picker="picker-theme" data-select-id="theme-setting">',
        app: '{ id: "picker-theme", selectId: "theme-setting", labelId: "theme-setting-label" },',
        docs: "### Theme selector"
      })
    }),
    Object.freeze({
      id: "picker-appearance-target",
      title: "Appearance target selector",
      kind: "select-picker",
      anchors: Object.freeze({
        html: '<div class="choice-picker" data-select-picker="picker-appearance-target" data-select-id="appearance-target">',
        app: '{ id: "picker-appearance-target", selectId: "appearance-target", labelId: "appearance-target-label" },',
        docs: "### Appearance target selector"
      })
    }),
    Object.freeze({
      id: "picker-appearance-spacing",
      title: "Appearance spacing selector",
      kind: "select-picker",
      anchors: Object.freeze({
        html: '<div class="choice-picker" data-select-picker="picker-appearance-spacing" data-select-id="appearance-spacing">',
        app: '{ id: "picker-appearance-spacing", selectId: "appearance-spacing", labelId: "appearance-spacing-label" },',
        docs: "### Appearance spacing selector"
      })
    }),
    Object.freeze({
      id: "picker-notification-filter",
      title: "Notification filter selector",
      kind: "select-picker",
      anchors: Object.freeze({
        html: '<div class="choice-picker" data-select-picker="picker-notification-filter" data-select-id="notification-filter">',
        app: '{ id: "picker-notification-filter", selectId: "notification-filter", labelId: "notification-filter-label" },',
        docs: "### Notification filter selector"
      })
    }),
    Object.freeze({
      id: "tab-context-menu",
      title: "Tab context menu",
      kind: "context-menu",
      anchors: Object.freeze({
        html: '<div class="context-menu-filter" data-search-id="tab-context-menu">',
        app: 'const TAB_CONTEXT_MENU_SEARCH_ID = "tab-context-menu";',
        docs: "### Tab context menu"
      })
    }),
    Object.freeze({
      id: "appearance-render-readers",
      title: "Appearance target and spacing render readers",
      kind: "render-reader",
      anchors: Object.freeze({
        app: 'const APPEARANCE_SPACING_FACTORS = Object.freeze({ tight: 0.82, comfortable: 1, airy: 1.2 });',
        css: '/* CONTROL-READER: tabs appearance overrides */',
        docs: "### Appearance rendering"
      })
    }),
    Object.freeze({
      id: "tab-discovery-activation",
      title: "Tab discovery result activation",
      kind: "interactive-result",
      anchors: Object.freeze({
        app: 'const row = create("button", "tab-result");',
        css: '.tab-result { display: grid; width: 100%; grid-template-columns: auto 1fr auto; gap: .6rem; align-items: center; padding: .6rem .7rem; border: 1px solid transparent; border-radius: .7rem; background: var(--surface-container); color: var(--on-surface); cursor: pointer; font-size: .78rem; text-align: left; }',
        docs: "### Keyboard activation repair"
      })
    })
  ]);
  const REQUIRED_IDS = Object.freeze(CONTROL_INVENTORY.map((entry) => entry.id));

  function ensure(condition, message) {
    if (!condition) throw new Error(message);
  }

  function hasExactLine(source, anchor) {
    const expected = String(anchor).trim();
    return String(source ?? "").split(/\r\n|\n|\r/).some((line) => line.trim() === expected);
  }

  function removeExactLine(source, anchor) {
    const expected = String(anchor).trim();
    const lines = String(source ?? "").split(/\r\n|\n|\r/);
    const index = lines.findIndex((line) => line.trim() === expected);
    ensure(index >= 0, `negative fixture cannot find exact anchor: ${expected}`);
    lines.splice(index, 1, "/* deliberate control-contract negative fixture */");
    return lines.join("\n");
  }

  function validateControlInventory(candidate, sources) {
    ensure(candidate?.schemaVersion === 1, "interactive control inventory schemaVersion must be 1");
    ensure(candidate?.surface === "GitHub Pages local selects and tab context menu", "interactive control inventory surface must be exact");
    ensure(Array.isArray(candidate?.requiredIds) && candidate.requiredIds.length === REQUIRED_IDS.length, "interactive control inventory requiredIds must be complete");
    ensure(Array.isArray(candidate?.controls) && candidate.controls.length === REQUIRED_IDS.length, "interactive control inventory controls must be complete");
    ensure(new Set(candidate.requiredIds).size === candidate.requiredIds.length, "interactive control inventory requiredIds must be unique");
    for (const id of REQUIRED_IDS) ensure(candidate.requiredIds.includes(id), `interactive control inventory is missing ${id}`);
    const controlsById = new Map(candidate.controls.map((entry) => [entry?.id, entry]));
    ensure(controlsById.size === REQUIRED_IDS.length, "interactive control inventory control IDs must be unique");
    for (const expected of CONTROL_INVENTORY) {
      const declared = controlsById.get(expected.id);
      ensure(declared, `interactive control inventory record is missing ${expected.id}`);
      ensure(declared.kind === expected.kind, `${expected.id} kind is wrong`);
      const expectedCapture = CONTROL_CAPTURE_PATHS[expected.id];
      ensure(declared.capture === expectedCapture, `${expected.id} capture record is wrong`);
      ensure(Array.isArray(declared.proofs) && declared.proofs.includes("localized") && declared.proofs.includes("keyboard") && declared.proofs.includes("builder"), `${expected.id} proofs are incomplete`);
      for (const [corpus, anchor] of Object.entries(expected.anchors)) {
        ensure(hasExactLine(sources?.[corpus], anchor), `${expected.id} is missing exact ${corpus} anchor: ${anchor}`);
      }
    }
    for (const [corpus, anchors] of Object.entries(COMMON_ANCHORS)) {
      for (const anchor of anchors) ensure(hasExactLine(sources?.[corpus], anchor), `interactive control common ${corpus} anchor is missing: ${anchor}`);
    }
    ensure(hasExactLine(sources?.check, CHECK_ANCHOR), "interactive control completeness gate registration is missing");
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (const expected of CONTROL_INVENTORY) {
      const capturePath = CONTROL_CAPTURE_PATHS[expected.id];
      const capture = sources?.captures?.[capturePath];
      ensure(capture && capture.length >= 32, `${expected.id} capture is missing or too small`);
      ensure(png.every((value, index) => capture[index] === value), `${expected.id} capture must be a PNG`);
    }
    return CONTROL_INVENTORY;
  }

  global.MDM_SITE_INTERACTIVE_CONTROLS_CONTRACT = Object.freeze({
    schemaVersion: 1,
    surface: "GitHub Pages local selects and tab context menu",
    requiredIds: REQUIRED_IDS,
    controls: CONTROL_INVENTORY.map((entry) => Object.freeze({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      capture: CONTROL_CAPTURE_PATHS[entry.id],
      proofs: Object.freeze(["implementation", "localized", "keyboard", "builder", "built-interaction", "capture"])
    })),
    controlCapturePaths: CONTROL_CAPTURE_PATHS,
    checkAnchor: CHECK_ANCHOR,
    commonAnchors: COMMON_ANCHORS,
    inventory: CONTROL_INVENTORY,
    hasExactLine,
    removeExactLine,
    validateControlInventory
  });
})(typeof window === "object" ? window : globalThis);
