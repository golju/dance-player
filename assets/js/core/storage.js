/**
 * Safe localStorage wrapper.
 */

export function getStoredValue(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null || v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

export function setStoredValue(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}
