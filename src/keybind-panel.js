// 操作キー一覧の表示と「次に押したキーを割り当てる」入力待ちを管理する。
// キーの検証・保存は keybindings.js に任せ、親がキーイベントを先に渡す。
import { KEYBIND_ACTIONS, formatKey } from './keybindings.js';

const DEFAULT_NOTE = '変更する操作のキーを選び、新しいキーを押してください。Esc は一時停止専用です。';

export function createKeybindPanel({ settings, listElement, noteElement, resetButton, onChange = () => {} }) {
  const document = listElement.ownerDocument;
  let waitingAction = null;
  const buttons = new Map();

  // 一覧の再生成後も、操作していたボタンへフォーカスを戻す。
  function focusAction(id) { buttons.get(id)?.focus({ preventScroll: true }); }

  // textContent で安全にキー名を表示し、入力待ちの行だけを強調する。
  function render() {
    const fragment = document.createDocumentFragment();
    buttons.clear();
    for (const action of KEYBIND_ACTIONS) {
      const row = document.createElement('div');
      row.className = 'keybind-row';
      const label = document.createElement('span');
      label.className = 'keybind-label';
      label.textContent = action.label;
      const button = document.createElement('button');
      const listening = waitingAction === action.id;
      const keyName = formatKey(settings.get(action.id));
      button.type = 'button';
      button.className = 'keybind-button';
      button.classList.toggle('is-listening', listening);
      button.dataset.action = action.id;
      button.textContent = listening ? 'キーを押す…' : keyName;
      button.setAttribute('aria-pressed', String(listening));
      button.setAttribute('aria-label', `${action.label} のキーを変更（現在 ${keyName}）`);
      button.setAttribute('aria-describedby', noteElement.id);
      // 変更したい操作を一つ選び、別の行を押したら待機先を切り替える。
      button.addEventListener('click', () => {
        waitingAction = action.id;
        noteElement.textContent = `${action.label} の新しいキーを押してください。Esc で取り消せます。`;
        render();
        focusAction(action.id);
      });
      row.append(label, button);
      fragment.append(row);
      buttons.set(action.id, button);
    }
    listElement.replaceChildren(fragment);
  }

  // 取り消しや画面の切替では、設定値を変更せず入力待ちだけを解除する。
  function cancel() {
    const previous = waitingAction;
    waitingAction = null;
    noteElement.textContent = DEFAULT_NOTE;
    render();
    if (previous) focusAction(previous);
  }

  // 保存が拒否された場合も、今回の起動中には反映されたことを伝える。
  function showSaveResult(result) {
    noteElement.textContent = result.saved
      ? '操作キーをこのブラウザに保存しました。'
      : '今回の操作には反映済みです。ブラウザへの保存はできませんでした。';
  }

  // true は入力を消費した合図。親は移動やメニュー操作に同じキーを使わない。
  function handleKeydown(event) {
    if (!waitingAction) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return true;
    if (event.code === 'Escape') { cancel(); return true; }
    const action = waitingAction;
    const result = settings.set(action, event.code);
    if (!result.ok) {
      noteElement.textContent = `${result.error} 別のキーを押してください。Esc で取り消せます。`;
      return true;
    }
    waitingAction = null;
    render();
    showSaveResult(result);
    onChange(result.bindings);
    focusAction(action);
    return true;
  }

  // 初期設定への復帰も保存し、親にキー説明の更新を知らせる。
  resetButton.addEventListener('click', () => {
    waitingAction = null;
    const result = settings.reset();
    render();
    showSaveResult(result);
    onChange(result.bindings);
  });
  noteElement.textContent = DEFAULT_NOTE;
  render();
  return Object.freeze({ handleKeydown, cancel, get isCapturing() { return waitingAction !== null; } });
}
