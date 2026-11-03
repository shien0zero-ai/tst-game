export const SENSITIVITY_DEFAULT = 100;
export const SENSITIVITY_MIN = 10;
export const SENSITIVITY_MAX = 300;
export const SENSITIVITY_STEP = 5;
export const SENSITIVITY_STORAGE_KEY = 'fieldcraft.mouseSensitivity';

function numericValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
    value = Number(trimmed);
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalize(value) {
  const number = numericValue(value);
  if (number === null) return SENSITIVITY_DEFAULT;
  const clamped = Math.max(SENSITIVITY_MIN, Math.min(SENSITIVITY_MAX, number));
  return Math.round(clamped / SENSITIVITY_STEP) * SENSITIVITY_STEP;
}

// Storage can be unavailable for downloaded files, private browser sessions, or
// browser policies. Keep the controls usable even when persistence is denied.
export function createSensitivitySettings(storageProvider = () => globalThis.localStorage) {
  let value = SENSITIVITY_DEFAULT;
  let persisted = false;
  try {
    const stored = storageProvider().getItem(SENSITIVITY_STORAGE_KEY);
    if (numericValue(stored) !== null) {
      value = normalize(stored);
      persisted = true;
    }
  } catch {
    // The default remains usable without storage.
  }

  const set = (nextValue) => {
    value = normalize(nextValue);
    persisted = false;
    try {
      storageProvider().setItem(SENSITIVITY_STORAGE_KEY, String(value));
      persisted = true;
    } catch {
      // Apply immediately in memory; the UI can report that saving failed.
    }
    return { value, saved: persisted };
  };

  return Object.freeze({
    get value() { return value; },
    get persisted() { return persisted; },
    set,
    reset() { return set(SENSITIVITY_DEFAULT); },
  });
}
