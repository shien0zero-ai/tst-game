import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSensitivitySettings,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_STORAGE_KEY,
} from '../src/settings.js';

function memoryStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[SENSITIVITY_STORAGE_KEY, initial]]);
  return {
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); },
  };
}

test('a new player gets normal sensitivity without writing browser storage', () => {
  const storage = memoryStorage();
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.value, SENSITIVITY_DEFAULT);
  assert.equal(settings.persisted, false);
  assert.equal(storage.getItem(SENSITIVITY_STORAGE_KEY), null);
});

test('changing sensitivity persists the setting for the next game instance', () => {
  const storage = memoryStorage();
  const settings = createSensitivitySettings(() => storage);
  assert.deepEqual(settings.set('175'), { value: 175, saved: true });
  assert.equal(settings.value, 175);
  assert.equal(settings.persisted, true);
  assert.equal(storage.getItem(SENSITIVITY_STORAGE_KEY), '175');
  const reopened = createSensitivitySettings(() => storage);
  assert.equal(reopened.value, 175);
  assert.equal(reopened.persisted, true);
});

test('reset replaces a saved preference with the normal sensitivity', () => {
  const storage = memoryStorage('250');
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.value, 250);
  assert.deepEqual(settings.reset(), { value: 100, saved: true });
  assert.equal(createSensitivitySettings(() => storage).value, 100);
});

test('corrupt stored settings fall back to normal without crashing or rewriting data', () => {
  for (const invalid of ['', ' ', 'fast', '{"sensitivity":200}', 'NaN', 'Infinity', '1e2', '0x64']) {
    const storage = memoryStorage(invalid);
    const settings = createSensitivitySettings(() => storage);
    assert.equal(settings.value, 100, `Stored value: ${JSON.stringify(invalid)}`);
    assert.equal(settings.persisted, false);
    assert.equal(storage.getItem(SENSITIVITY_STORAGE_KEY), invalid);
  }
});

test('valid numeric settings are constrained to the supported slider range and step', () => {
  const storage = memoryStorage();
  const settings = createSensitivitySettings(() => storage);
  for (const [input, expected] of [[-10, 10], [0, 10], [10, 10], [12, 10], [13, 15], [103, 105], [299, 300], [300, 300], [900, 300]]) {
    assert.equal(settings.set(input).value, expected, `Input: ${input}`);
    assert.equal(createSensitivitySettings(() => storage).value, expected);
  }
  assert.equal(createSensitivitySettings(() => memoryStorage('900')).value, 300);
  assert.equal(createSensitivitySettings(() => memoryStorage('-10')).value, 10);
});

test('non-numeric control values restore normal sensitivity rather than coercing to zero', () => {
  const settings = createSensitivitySettings(() => memoryStorage());
  for (const invalid of [null, undefined, true, false, {}, [], '', ' ', NaN, Infinity, '-Infinity']) {
    settings.set(200);
    assert.equal(settings.set(invalid).value, 100);
  }
});

test('blocked storage access keeps sensitivity changes and reset usable in memory', () => {
  const settings = createSensitivitySettings(() => { throw new Error('SecurityError'); });
  assert.equal(settings.value, 100);
  assert.equal(settings.persisted, false);
  assert.deepEqual(settings.set(250), { value: 250, saved: false });
  assert.equal(settings.value, 250);
  assert.deepEqual(settings.reset(), { value: 100, saved: false });
});

test('a storage read failure does not prevent a later successful save', () => {
  const storage = memoryStorage();
  storage.getItem = () => { throw new Error('SecurityError'); };
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.value, 100);
  assert.deepEqual(settings.set(160), { value: 160, saved: true });
});

test('a full storage quota applies the new value without falsely reporting it saved', () => {
  const storage = memoryStorage('200');
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.persisted, true);
  assert.deepEqual(settings.set(150), { value: 150, saved: false });
  assert.equal(settings.value, 150);
  assert.equal(settings.persisted, false);
  assert.equal(createSensitivitySettings(() => storage).value, 200);
});
