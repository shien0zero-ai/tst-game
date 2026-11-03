// 操作名と物理キー（KeyboardEvent.code）の対応、検証、ブラウザ保存を管理する。
export const DEFAULT_BINDINGS = Object.freeze({
  forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', respawn: 'KeyR', inventory: 'Tab',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5', slot6: 'Digit6',
});

// 表示順と日本語の操作名。標準設定と一覧は外部から変更できないよう固定する。
export const KEYBIND_ACTIONS = Object.freeze([
  { id: 'forward', label: '前に移動' }, { id: 'backward', label: '後ろに移動' },
  { id: 'left', label: '左に移動' }, { id: 'right', label: '右に移動' },
  { id: 'jump', label: 'ジャンプ' }, { id: 'sprint', label: '走る' },
  { id: 'respawn', label: '開始地点に戻る' }, { id: 'inventory', label: 'インベントリ' },
  ...Array.from({ length: 6 }, (_, index) => ({ id: `slot${index + 1}`, label: `ブロック選択 ${index + 1}` })),
].map(action => Object.freeze(action)));
export const KEYBIND_STORAGE_KEY = 'fieldcraft.keybindings';

// 英字・数字以外に使えるキー。Esc とブラウザの重要な修飾キーは含めない。
const NAMED_KEYS = Object.freeze({
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Space: 'Space', ShiftLeft: '左Shift', ShiftRight: '右Shift',
  Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'CapsLock',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
});

// 保存用のコードを、ボタンやホットバーに表示する短い名前に変える。
export function formatKey(code) {
  if (typeof code !== 'string' || !code) return '未設定';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return Object.hasOwn(NAMED_KEYS, code) ? NAMED_KEYS[code] : code;
}

// 常に設定へ戻れるよう Esc は固定。ブラウザ・OS の操作用キーも予約する。
function keyError(code) {
  if (code === 'Escape') return 'Esc は一時停止に使うため、割り当てできません。';
  if (typeof code === 'string' && /^(?:Control|Alt|Meta)(?:Left|Right)$|^F(?:[1-9]|1[0-2])$/.test(code)) {
    return 'ブラウザやOSの操作に使うキーは割り当てできません。';
  }
  if (typeof code !== 'string' || !(/^Key[A-Z]$|^Digit[0-9]$/.test(code) || Object.hasOwn(NAMED_KEYS, code))) {
    return 'このキーは割り当てできません。英字・数字・矢印キーなどを選んでください。';
  }
  return null;
}

// 保存データは一部を補完した後に全体を検証し、重複や壊れた割り当てを避ける。
function validBindings(candidate) {
  const used = new Set();
  for (const action of KEYBIND_ACTIONS) {
    const code = candidate[action.id];
    if (keyError(code) || used.has(code)) return false;
    used.add(code);
  }
  return true;
}

export function createKeybindingsSettings(storageProvider = () => globalThis.localStorage) {
  let bindings = { ...DEFAULT_BINDINGS };
  let persisted = false;
  try {
    const stored = storageProvider().getItem(KEYBIND_STORAGE_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && Object.keys(parsed).every(action => Object.hasOwn(DEFAULT_BINDINGS, action))) {
        const candidate = { ...DEFAULT_BINDINGS, ...parsed };
        if (validBindings(candidate)) { bindings = candidate; persisted = true; }
      }
    }
  } catch {
    // 保存禁止や JSON の破損でも、標準操作でゲームを開始できる。
  }

  // 対応表はコピーして返し、画面側から内部設定を書き換えさせない。
  const result = (ok, saved, error = null) => ({ ok, saved, error, bindings: { ...bindings } });
  const save = () => {
    persisted = false;
    try {
      storageProvider().setItem(KEYBIND_STORAGE_KEY, JSON.stringify(bindings));
      persisted = true;
    } catch {
      // 保存できなくても、その起動中の新しい設定は維持する。
    }
    return result(true, persisted);
  };

  return Object.freeze({
    get bindings() { return { ...bindings }; },
    get persisted() { return persisted; },
    get(action) { return Object.hasOwn(bindings, action) ? bindings[action] : null; },
    // 不正な指定を拒否したときは、既存の対応表を一切変えない。
    set(action, code) {
      if (!Object.hasOwn(DEFAULT_BINDINGS, action)) return result(false, false, '設定する操作が見つかりません。');
      const error = keyError(code);
      if (error) return result(false, false, error);
      const duplicate = KEYBIND_ACTIONS.find(item => item.id !== action && bindings[item.id] === code);
      if (duplicate) return result(false, false, `「${formatKey(code)}」は「${duplicate.label}」で使っています。別のキーを選んでください。`);
      bindings = { ...bindings, [action]: code };
      return save();
    },
    reset() { bindings = { ...DEFAULT_BINDINGS }; return save(); },
    // 押されているキーの集合と、現在の割り当てだけを照合する。
    isPressed(action, keys) {
      return Object.hasOwn(bindings, action) && typeof keys?.has === 'function' && Boolean(keys.has(bindings[action]));
    },
  });
}
