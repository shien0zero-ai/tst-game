/**
 * マウス感度の設定と保存を確認する自動テスト。
 * ブラウザの保存領域をメモリ上の代用品に置き換え、正常時と保存できない場合を再現する。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSensitivitySettings,
  SENSITIVITY_DEFAULT,
  SENSITIVITY_STORAGE_KEY,
} from '../src/settings.js';

// localStorage と同じ getItem / setItem を持つ、テスト専用の保存領域を作る。
function memoryStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[SENSITIVITY_STORAGE_KEY, initial]]);
  return {
    // 保存されていないキーは、実際の localStorage と同じく null を返す。
    getItem(key) { return data.get(key) ?? null; },
    // 同じキーへの再保存は、そのキーの値を更新する。
    setItem(key, value) { data.set(key, value); },
  };
}

// 保存データがない状態で設定を作り、初期値が 100% で、まだ保存操作を行っていないことを確かめる。
test('a new player gets normal sensitivity without writing browser storage', () => {
  const storage = memoryStorage();
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.value, SENSITIVITY_DEFAULT);
  assert.equal(settings.persisted, false);
  assert.equal(storage.getItem(SENSITIVITY_STORAGE_KEY), null);
});

// 感度を変更して保存し、別の設定オブジェクトを作っても同じ値を読み込めることを確かめる。
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

// 保存済みの高い感度を標準に戻し、保存データも 100% に置き換わることを確かめる。
test('reset replaces a saved preference with the normal sensitivity', () => {
  const storage = memoryStorage('250');
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.value, 250);
  assert.deepEqual(settings.reset(), { value: 100, saved: true });
  assert.equal(createSensitivitySettings(() => storage).value, 100);
});

// 数値として扱えない保存データを順番に読み込み、エラーで止まらず標準値を使い、元のデータを書き換えないことを確かめる。
test('corrupt stored settings fall back to normal without crashing or rewriting data', () => {
  for (const invalid of ['', ' ', 'fast', '{"sensitivity":200}', 'NaN', 'Infinity', '1e2', '0x64']) {
    const storage = memoryStorage(invalid);
    const settings = createSensitivitySettings(() => storage);
    assert.equal(settings.value, 100, `Stored value: ${JSON.stringify(invalid)}`);
    assert.equal(settings.persisted, false);
    assert.equal(storage.getItem(SENSITIVITY_STORAGE_KEY), invalid);
  }
});

// 範囲外や刻みの間の数値を指定し、10〜300%・5% 刻みに調整され、次回も同じ値を読めることを確かめる。
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

// 空文字、真偽値、配列などの不正な入力が、意図せずゼロ扱いにならず標準の 100% に戻ることを確かめる。
test('non-numeric control values restore normal sensitivity rather than coercing to zero', () => {
  const settings = createSensitivitySettings(() => memoryStorage());
  for (const invalid of [null, undefined, true, false, {}, [], '', ' ', NaN, Infinity, '-Infinity']) {
    settings.set(200);
    assert.equal(settings.set(invalid).value, 100);
  }
});

// 保存領域へのアクセス自体が禁止された状況を再現し、保存できなくても今回のゲーム内では感度変更とリセットが使えることを確かめる。
test('blocked storage access keeps sensitivity changes and reset usable in memory', () => {
  const settings = createSensitivitySettings(() => { throw new Error('SecurityError'); });
  assert.equal(settings.value, 100);
  assert.equal(settings.persisted, false);
  assert.deepEqual(settings.set(250), { value: 250, saved: false });
  assert.equal(settings.value, 250);
  assert.deepEqual(settings.reset(), { value: 100, saved: false });
});

// 読み込みだけが失敗する保存領域を使い、初期表示は標準値で、その後の保存は試せることを確かめる。
test('a storage read failure does not prevent a later successful save', () => {
  const storage = memoryStorage();
  storage.getItem = () => { throw new Error('SecurityError'); };
  const settings = createSensitivitySettings(() => storage);
  assert.equal(settings.value, 100);
  assert.deepEqual(settings.set(160), { value: 160, saved: true });
});

// 容量不足で書き込みに失敗させ、今回の感度は変更される一方、保存成功と誤表示せず、次回は前の値を読むことを確かめる。
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
