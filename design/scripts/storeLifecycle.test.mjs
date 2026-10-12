import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = await readFile(new URL('../src/store/useAppStore.ts', import.meta.url), 'utf8');

async function verifyLifecycle(candidate) {
  const registrations = { state: 0, presentation: 0, vocabulary: 0 };
  const cleanups = { state: 0, presentation: 0, vocabulary: 0 };
  let refreshes = 0;
  const handlers = {};
  const register = (kind) => (handler) => {
    registrations[kind] += 1;
    handlers[kind] = handler;
    return () => { cleanups[kind] += 1; };
  };
  const applied = [];
  const api = {
    getState: async () => ({ items: [], queues: [], settings: { schoolModeEnabled: false } }),
    getPersonalVocabularyRuntime: async () => { refreshes += 1; return { fixture: 'empty' }; },
    onStateChanged: register('state'),
    onPresentationChanged: register('presentation'),
    onPersonalVocabularyChanged: register('vocabulary'),
  };
  const exports = {};
  const output = ts.transpileModule(candidate, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, {
    exports,
    window: { api },
    require: (name) => {
      if (name === 'zustand') return require('zustand');
      if (name === '@shared/personalVocabulary') return { createPersonalVocabularyRuntime: () => ({ fixture: 'empty' }) };
      if (name === './settingsAppearance') return { applyAppearanceSettings: () => {} };
      if (name === '../personalVocabulary/runtime') return { setPersonalVocabularyRuntime: (value) => applied.push(value) };
      throw new Error(`Unexpected store dependency: ${name}`);
    },
  });
  const cleanup = exports.useAppStore.getState().init();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(registrations, { state: 1, presentation: 1, vocabulary: 1 });
  assert.equal(refreshes, 1, 'initial vocabulary refresh occurs once');
  const before = applied.length;
  handlers.vocabulary({ fixture: 'changed' });
  assert.equal(applied.length, before + 1, 'one update reaches renderer memory once');
  cleanup();
  assert.deepEqual(cleanups, { state: 1, presentation: 1, vocabulary: 1 });
}

test('store initialization registers and cleans each vocabulary lifecycle subscription once', async () => {
  await verifyLifecycle(source);
});

test('store lifecycle regression rejects a missing vocabulary cleanup', async () => {
  const broken = source.replace('      unsubscribePersonalVocabulary();', '      // removed by negative fixture');
  assert.notEqual(broken, source);
  await assert.rejects(() => verifyLifecycle(broken), /Expected values to be strictly deep-equal/);
});

test('store lifecycle regression rejects a duplicate vocabulary registration and refresh', async () => {
  const block = `    refreshPersonalVocabularyRendererMemory();
    const unsubscribePersonalVocabulary = window.api.onPersonalVocabularyChanged((runtime) => {
      personalVocabularyGeneration += 1;
      applyPersonalVocabularyRuntime(runtime);
    });`;
  const broken = source.replace(block, block + '\n' + block.replace('unsubscribePersonalVocabulary', 'duplicateSubscription'));
  assert.notEqual(broken, source);
  await assert.rejects(() => verifyLifecycle(broken), /Expected values to be strictly deep-equal/);
});
