import { DEFAULT_LANG, LANG_STORAGE_KEY, SUPPORTED_LANGS } from '../core/config.js';
import { getStoredValue, setStoredValue } from '../core/storage.js';
import { STRINGS } from './strings.js';

export function normalizeLang(code) {
  return SUPPORTED_LANGS.includes(code) ? code : DEFAULT_LANG;
}

export function getStrings(lang) {
  return STRINGS[normalizeLang(lang)];
}

export function translate(key, locale) {
  const s = getStrings(locale);
  return key in s ? s[key] : key;
}

export function getCurrentLocale() {
  return normalizeLang(document.documentElement.getAttribute('data-lang') || DEFAULT_LANG);
}

export function readStoredLang() {
  const v = getStoredValue(LANG_STORAGE_KEY);
  return v ? normalizeLang(v) : DEFAULT_LANG;
}

function storeLang(lang) {
  setStoredValue(LANG_STORAGE_KEY, lang);
}

function applyMeta(s) {
  const titleEl = document.querySelector('title');
  if (titleEl) titleEl.textContent = s.meta_title;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', s.meta_description);
  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) appleTitle.setAttribute('content', s.app_short_title);
}

/** @param {HTMLElement} root */
export function applyLang(lang, root = document) {
  const L = normalizeLang(lang);
  const s = getStrings(L);

  document.documentElement.lang = L;
  document.documentElement.setAttribute('data-lang', L);
  storeLang(L);
  applyMeta(s);

  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key || !(key in s)) return;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = /** @type {string} */ (s[/** @type {keyof typeof s} */ (key)]);
    } else {
      el.textContent = /** @type {string} */ (s[/** @type {keyof typeof s} */ (key)]);
    }
  });

  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    spec
      .trim()
      .split(/\s+/)
      .forEach((pair) => {
        const c = pair.indexOf(':');
        if (c < 0) return;
        const attr = pair.slice(0, c).trim();
        const k = pair.slice(c + 1).trim();
        if (attr && k && k in s) el.setAttribute(attr, /** @type {string} */ (s[/** @type {keyof typeof s} */ (k)]));
      });
  });

  document.querySelectorAll('.j-lang-select').forEach((sel) => {
    /** @type {HTMLSelectElement} */ (sel).value = L;
  });

  document.dispatchEvent(new CustomEvent('dance-player:lang', { detail: { lang: L } }));
}
