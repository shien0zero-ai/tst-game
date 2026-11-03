// マウス感度の数値と保存を管理するファイルです。
// 画面のスライダーとは分離し、保存が禁止されたブラウザでも設定を使えるようにします。

// 感度は百分率で扱います。100% が元の視点速度で、10〜300% を 5% 刻みで選べます。
export const SENSITIVITY_DEFAULT = 100;
export const SENSITIVITY_MIN = 10;
export const SENSITIVITY_MAX = 300;
export const SENSITIVITY_STEP = 5;
// localStorage はブラウザ内の保存領域です。この名前を目印に感度だけを読み書きします。
export const SENSITIVITY_STORAGE_KEY = 'fieldcraft.mouseSensitivity';

// 数値、または通常の十進数で書かれた文字列を数値にします。
// 空欄・真偽値・JSON・無限大などは感度として使わず、null で「無効」を伝えます。
function numericValue(value) {
  if (typeof value === 'string') {
    // 前後の空白を除き、数字・符号・小数点の組み合わせだけを受け付けます。
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
    value = Number(trimmed);
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// 外から渡された値を、実際に使えるスライダーの値へそろえます。
function normalize(value) {
  const number = numericValue(value);
  // 読めない値なら、操作不能な速度になるのを防ぐため標準値へ戻します。
  if (number === null) return SENSITIVITY_DEFAULT;
  // 最小値・最大値からはみ出さないようにし、最後に最も近い 5% 刻みへ丸めます。
  const clamped = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, number));
  return Math.round(clamped / SENSITIVITY_STEP) * SENSITIVITY_STEP;
}

// 現在の感度、変更、リセットをまとめた設定オブジェクトを作ります。
// storageProvider は保存領域を取得する関数です。テストでは代わりの保存領域を渡せます。
// ダウンロード版・プライベートモード・管理ポリシーなどで保存できない場合も想定します。
export function createSensitivitySettings(storageProvider = () => globalThis.localStorage) {
  // value は今回の起動中に使う値、persisted はその値が保存済みかどうかです。
  let value = SENSITIVITY_DEFAULT;
  let persisted = false;
  try {
    // 起動時は保存済みの値を読み取るだけで、標準値を勝手に書き込みません。
    const stored = storageProvider().getItem(SENSITIVITY_STORAGE_KEY);
    if (numericValue(stored) !== null) {
      value = normalize(stored);
      persisted = true;
    }
  } catch {
    // 保存領域そのものにアクセスできなくても、標準の感度でゲームを続けられます。
  }

  // 値の変更はまずメモリに反映し、その後でブラウザへの保存を試みます。
  const set = (nextValue) => {
    value = normalize(nextValue);
    persisted = false;
    try {
      // localStorage には文字列として保存します。次回起動時に numericValue で読み戻します。
      storageProvider().setItem(SENSITIVITY_STORAGE_KEY, String(value));
      persisted = true;
    } catch {
      // 容量不足や保存禁止でも value は有効です。画面には保存失敗だけを伝えられます。
    }
    return { value, saved: persisted };
  };

  // 設定の読み取り口と操作だけを公開し、外から直接プロパティを上書きさせません。
  // getter は、呼ばれた時点の最新の値を返します。reset も通常の保存処理を通します。
  return Object.freeze({
    get value() { return value; },
    get persisted() { return persisted; },
    set,
    reset() { return set(SENSITIVITY_DEFAULT); },
  });
}
