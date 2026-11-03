// キー設定の保存・復元・検証を確認し、不正な割り当てで操作不能になるのを防ぐ。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeybindingsSettings, DEFAULT_BINDINGS, KEYBIND_ACTIONS, KEYBIND_STORAGE_KEY, formatKey } from '../src/keybindings.js';

// テスト専用の保存領域。実ブラウザの設定は書き換えない。
function memoryStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[KEYBIND_STORAGE_KEY, initial]]);
  return { getItem(key) { return data.get(key) ?? null; }, setItem(key, value) { data.set(key, value); } };
}

// 初回は標準操作を維持し、勝手には保存しない。
test('未保存なら標準のキー割り当てで開始する', () => {
  const storage = memoryStorage();
  const settings = createKeybindingsSettings(() => storage);
  assert.deepEqual(settings.bindings, DEFAULT_BINDINGS);
  assert.equal(settings.get('forward'), 'KeyW');
  assert.equal(settings.get('inventory'), 'Tab');
  assert.equal(settings.persisted, false);
  assert.equal(storage.getItem(KEYBIND_STORAGE_KEY), null);
  assert.equal(KEYBIND_ACTIONS.length, 14);
  assert.ok(Object.isFrozen(DEFAULT_BINDINGS) && Object.isFrozen(KEYBIND_ACTIONS) && Object.isFrozen(KEYBIND_ACTIONS[0]));
});
// 変更は押下判定と次回の起動の両方に反映する。
test('前進を矢印キーへ変更して保存・再読み込みできる', () => {
  const storage = memoryStorage();
  const settings = createKeybindingsSettings(() => storage);
  const changed = settings.set('forward', 'ArrowUp');
  assert.equal(changed.ok, true);
  assert.equal(changed.saved, true);
  assert.equal(changed.error, null);
  assert.equal(settings.isPressed('forward', new Set(['ArrowUp'])), true);
  assert.equal(settings.isPressed('forward', new Set(['KeyW'])), false);
  const reopened = createKeybindingsSettings(() => storage);
  assert.equal(reopened.get('forward'), 'ArrowUp');
  assert.equal(reopened.persisted, true);
});
// 重複を拒否した場合は、既存の保存済み設定を維持する。
test('他の操作と同じキーを割り当てられない', () => {
  const settings = createKeybindingsSettings(() => memoryStorage());
  settings.set('forward', 'ArrowUp');
  const before = settings.bindings;
  const rejected = settings.set('backward', 'ArrowUp');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.saved, false);
  assert.match(rejected.error, /前に移動/);
  assert.deepEqual(settings.bindings, before);
  assert.equal(settings.persisted, true);
  assert.equal(settings.set('forward', 'ArrowUp').ok, true);
});
// Escとブラウザ操作用の修飾キーは予約する。
test('Esc・修飾キー・ファンクションキーを予約する', () => {
  const settings = createKeybindingsSettings(() => memoryStorage());
  for (const code of ['Escape', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'F1', 'F5', 'F12']) {
    const rejected = settings.set('forward', code);
    assert.equal(rejected.ok, false, code);
    assert.ok(rejected.error, code);
    assert.equal(settings.get('forward'), 'KeyW');
  }
});
// 未知の操作やコードを割り当てとして受け付けない。
test('未知の操作や未対応のキーを拒否する', () => {
  const settings = createKeybindingsSettings(() => memoryStorage());
  assert.equal(settings.set('fly', 'KeyF').ok, false);
  assert.equal(settings.set('__proto__', 'KeyP').ok, false);
  assert.equal(settings.get('fly'), null);
  assert.equal(settings.get('__proto__'), null);
  for (const code of ['', null, undefined, 12, 'w', 'Keya', 'Numpad0', 'MouseLeft']) assert.equal(settings.set('forward', code).ok, false);
  assert.deepEqual(settings.bindings, DEFAULT_BINDINGS);
});
// 対応する一般キーや記号キーは用途を限定せず使える。
test('対応する特殊キー・記号キーを割り当てられる', () => {
  const settings = createKeybindingsSettings(() => memoryStorage());
  for (const code of ['KeyZ', 'Digit0', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ShiftRight', 'Enter', 'Backspace', 'CapsLock',
    'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backquote']) {
    assert.equal(settings.set('forward', code).ok, true, code);
  }
  assert.equal(settings.set('jump', 'Space').ok, true);
  assert.equal(settings.set('inventory', 'Tab').ok, true);
});
// 標準へ戻した値も保存し、古い設定が次回に復活しないようにする。
test('リセットは全操作を標準に戻して保存する', () => {
  const storage = memoryStorage();
  const settings = createKeybindingsSettings(() => storage);
  settings.set('forward', 'ArrowUp'); settings.set('jump', 'KeyJ');
  assert.deepEqual(settings.reset(), { ok: true, saved: true, error: null, bindings: { ...DEFAULT_BINDINGS } });
  assert.deepEqual(createKeybindingsSettings(() => storage).bindings, DEFAULT_BINDINGS);
});
// 将来操作が増えたときも、不足している操作を標準で補う。
test('一部だけの保存データを標準値で補って読み込む', () => {
  const settings = createKeybindingsSettings(() => memoryStorage(JSON.stringify({ forward: 'ArrowUp' })));
  assert.equal(settings.get('forward'), 'ArrowUp');
  assert.equal(settings.get('jump'), 'Space');
  assert.equal(settings.get('slot6'), 'Digit6');
  assert.equal(settings.persisted, true);
});
// 不正なデータの一部だけを採用せず、全体を安全な標準へ戻す。
test('不正な保存データは全体を標準に戻す', () => {
  for (const raw of ['{', 'null', '[]', '123', '"KeyW"', JSON.stringify({ unknown: 'KeyG' }),
    JSON.stringify({ forward: 'KeyS' }), JSON.stringify({ forward: 'Escape' }), JSON.stringify({ forward: null }),
    JSON.stringify({ forward: 'ArrowUp', backward: 'ArrowUp' }), '{"__proto__":"KeyP"}']) {
    const storage = memoryStorage(raw);
    const settings = createKeybindingsSettings(() => storage);
    assert.deepEqual(settings.bindings, DEFAULT_BINDINGS, raw);
    assert.equal(settings.persisted, false, raw);
    assert.equal(storage.getItem(KEYBIND_STORAGE_KEY), raw);
  }
});
// 対応表の読み取り結果はコピーで、内部の設定を書き換えられない。
test('公開する対応表は内部設定と分離したコピーになる', () => {
  const settings = createKeybindingsSettings(() => memoryStorage());
  const copy = settings.bindings;
  copy.forward = 'KeyF';
  const changed = settings.set('jump', 'KeyJ'); changed.bindings.jump = 'KeyK';
  assert.equal(settings.get('forward'), 'KeyW');
  assert.equal(settings.get('jump'), 'KeyJ');
});
// 保存が禁止されても、起動中の操作変更は使える。
test('保存が禁止されてもメモリ内では変更とリセットが使える', () => {
  const settings = createKeybindingsSettings(() => { throw new Error('SecurityError'); });
  const changed = settings.set('inventory', 'KeyI');
  assert.equal(changed.ok, true); assert.equal(changed.saved, false); assert.equal(changed.error, null);
  assert.equal(settings.isPressed('inventory', new Set(['KeyI'])), true);
  assert.equal(settings.persisted, false);
  assert.equal(settings.reset().ok, true);
  assert.equal(settings.get('inventory'), 'Tab');
});
// 容量不足では保存済みのデータと今回の変更を区別する。
test('保存容量が足りなければ既存の保存と今回の変更を区別する', () => {
  const storage = memoryStorage(JSON.stringify({ forward: 'ArrowUp' }));
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const settings = createKeybindingsSettings(() => storage);
  assert.equal(settings.persisted, true);
  assert.equal(settings.set('forward', 'KeyF').saved, false);
  assert.equal(settings.get('forward'), 'KeyF');
  assert.equal(settings.persisted, false);
  assert.equal(createKeybindingsSettings(() => storage).get('forward'), 'ArrowUp');
});
// 読み取りの失敗だけでは、その後の保存まで諦めない。
test('読み取り失敗の後でも変更の保存を試みる', () => {
  const storage = memoryStorage(); storage.getItem = () => { throw new Error('SecurityError'); };
  assert.equal(createKeybindingsSettings(() => storage).set('forward', 'ArrowUp').saved, true);
});
// 押下判定は割り当てた操作とキーだけに反応する。
test('押下判定は割り当てたキーと操作だけを確認する', () => {
  const settings = createKeybindingsSettings(() => memoryStorage());
  assert.equal(settings.isPressed('forward', new Set(['KeyW', 'Space'])), true);
  assert.equal(settings.isPressed('backward', new Set(['KeyW', 'Space'])), false);
  assert.equal(settings.isPressed('fly', new Set(['KeyW'])), false);
  assert.equal(settings.isPressed('jump', null), false);
});
// ボタンに表示するキー名は、保存用コードとは別に読みやすく整える。
test('設定画面に使うキー名を読みやすくする', () => {
  for (const [code, name] of [['KeyW', 'W'], ['Digit0', '0'], ['Space', 'Space'], ['Tab', 'Tab'],
    ['ShiftLeft', '左Shift'], ['ShiftRight', '右Shift'], ['ArrowUp', '↑'], ['Slash', '/'], [null, '未設定']]) {
    assert.equal(formatKey(code), name);
  }
});
