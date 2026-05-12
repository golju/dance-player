/** Dance Player — local file, countdown, fixed start offset. */

import { applyLang, getCurrentLocale, getStrings, readStoredLang } from './i18n/apply.js';

const STORAGE = {
  DELAY_SEC: 'dancePlayer.delaySec',
  START_SEC: 'dancePlayer.startSec',
};

/** Allowed timer durations before playback from Start. */
const DELAY_OPTIONS = [3, 5, 8, 10];

const els = {
  file: document.getElementById('audio-file'),
  fileBtn: document.getElementById('pick-file-btn'),
  trackName: document.getElementById('track-name'),
  trackMeta: document.getElementById('track-meta'),
  startPicker: document.getElementById('start-picker'),
  startTimeField: document.getElementById('start-time-field'),
  startReadoutSr: document.getElementById('start-readout-sr'),
  delayChips: document.getElementById('delay-chips'),
  startSec: document.getElementById('start-sec'),
  playPause: document.getElementById('btn-play-pause'),
  goToStart: document.getElementById('btn-go-to-start'),
  playCountdown: document.getElementById('btn-play-countdown'),
  playCountdownLabel: document.getElementById('btn-play-countdown-label'),
  countdownStage: document.getElementById('countdown-stage'),
  countdownIdle: document.getElementById('countdown-idle'),
  countdownActive: document.getElementById('countdown-active'),
  countdown: document.getElementById('countdown-num'),
  countdownPillTime: document.getElementById('countdown-pill-time'),
  audio: document.getElementById('player'),
  transport: document.getElementById('transport'),
  transportTrack: document.getElementById('transport-track'),
  timeCurrent: document.getElementById('time-current'),
  timeDuration: document.getElementById('time-duration'),
  transportFill: document.getElementById('transport-fill'),
  btnSetStartCurrent: document.getElementById('btn-set-start-current'),
  goToStartTime: document.getElementById('btn-go-to-start-time'),
};

/** @type {string | null} */
let objectUrl = null;

/** @type {number | null} — requestAnimationFrame id while counting down */
let tick = null;

/** @type {number} */
let countEndMs = 0;

/** @type {number} */
let countdownTotalSec = 0;

/** @type {number} — позиция воспроизведения (сек) в момент запуска отсчёта таймера */
let countdownResumeAtSec = 0;

/** @type {number | null} */
let lastDisplayedSec = null;

/** @type {boolean} */
let isScrubbing = false;

function playCountdownAriaLabel(seconds) {
  const s = getStrings(getCurrentLocale());
  const tpl = s.btn_play_countdown_aria_with_seconds;
  return typeof tpl === 'string' ? tpl.replace('{seconds}', String(seconds)) : s.btn_play_countdown_aria;
}

function syncActionButtons() {
  const hasSrc = !!els.audio.src;
  const counting = tick !== null;
  const playing = !els.audio.paused;
  els.playPause.disabled = !hasSrc;
  if (els.goToStart) els.goToStart.disabled = !hasSrc || getDuration() <= 0;
  if (els.playCountdown) els.playCountdown.disabled = !hasSrc;
  const showPause = playing || counting;
  els.playPause.dataset.mode = showPause ? 'pause' : 'play';
  const s = getStrings(getCurrentLocale());
  els.playPause.setAttribute('aria-label', showPause ? s.btn_pause : s.btn_play);

  const delaySec = getDelaySec();
  if (els.playCountdownLabel) els.playCountdownLabel.textContent = `⏱ ${delaySec}s`;
  if (els.playCountdown) els.playCountdown.setAttribute('aria-label', playCountdownAriaLabel(delaySec));
  syncGoToStartButton();
}

function syncGoToStartButton() {
  if (!els.goToStart) return;
  const t = formatStartReadout(getCommittedStartSec());
  if (els.goToStartTime) els.goToStartTime.textContent = t;
  const s = getStrings(getCurrentLocale());
  const ariaTpl = s.btn_go_to_start_aria;
  const aria = typeof ariaTpl === 'string' ? ariaTpl.replace(/\{time\}/g, t) : `Go to ${t}`;
  els.goToStart.setAttribute('aria-label', aria);
  els.goToStart.title = aria;
}

function parseStartSecFromField() {
  const parsed = parseTimeInput(els.startSec.value);
  const rawNum = parseFloat(String(els.startSec.value).trim().replace(',', '.'));
  if (Number.isFinite(parsed)) return parsed;
  if (Number.isFinite(rawNum)) return rawNum;
  return 0;
}

function getCommittedStartSec() {
  const max = getDuration() > 0 ? getStartSecMax() : 360000;
  return Math.round(clamp(parseStartSecFromField(), 0, max));
}

/** После ввода в поле старта (Enter / blur на мобильном) — переставить позицию трека. */
function seekAudioToCommittedStart() {
  if (!els.audio.src || getDuration() <= 0) return;
  els.audio.currentTime = getCommittedStartSec();
}

function syncStartTimeUI() {
  const max = getStartSecMax();
  const editing = document.activeElement === els.startSec;
  const v = Math.round(clamp(parseStartSecFromField(), 0, Math.max(max, 0)));

  if (!editing) {
    els.startSec.value = formatStartReadout(v);
    const lbl = formatStartReadout(v);
    if (els.startReadoutSr) els.startReadoutSr.textContent = lbl;
    if (els.startTimeField) {
      els.startTimeField.setAttribute('aria-valuetext', lbl);
    }
  }

  syncStartFieldAvailability();
  syncGoToStartButton();
}

function getStartSecMax() {
  const d = getDuration();
  return d > 0 ? Math.min(d, 360000) : 0;
}

function syncStartFieldAvailability() {
  const on = getDuration() > 0;
  if (els.startTimeField) els.startTimeField.classList.toggle('is-field-disabled', !on);
  if (els.startPicker) els.startPicker.classList.toggle('is-disabled', !on);
  if (els.btnSetStartCurrent) els.btnSetStartCurrent.disabled = !on;
  if (els.startSec) {
    els.startSec.disabled = !on;
    els.startSec.tabIndex = on ? 0 : -1;
    if (!on && document.activeElement === els.startSec) els.startSec.blur();
  }
}

function formatStartReadout(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `90`, `90.5`, `1:30`, `1:30.5` (comma as decimal allowed). */
function parseTimeInput(raw) {
  const s = String(raw).trim().replace(',', '.');
  if (!s) return NaN;
  if (!s.includes(':')) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  }
  const m = /^(\d+):(\d{1,2})(?:\.(\d))?$/.exec(s);
  if (!m) return NaN;
  const min = parseInt(m[1], 10);
  const sec = parseInt(m[2], 10);
  const tenth = m[3] !== undefined ? parseInt(m[3], 10) : 0;
  if (sec > 59 || tenth > 9) return NaN;
  return min * 60 + sec + tenth / 10;
}

function digitsLeftOfCaret(str, caret) {
  let n = 0;
  const end = Math.min(typeof caret === 'number' ? caret : str.length, str.length);
  for (let i = 0; i < end; i++) if (/\d/.test(str[i])) n++;
  return n;
}

function caretAfterNthDigit(str, n) {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < str.length; i++) {
    if (/\d/.test(str[i])) {
      seen++;
      if (seen >= n) return i + 1;
    }
  }
  return str.length;
}

/**
 * Дружелюбный ввод: только цифры и двоеточие с клавиатуры;
 * без «:» три и более цифры дают м:сс (напр. 145 → 1:45).
 */
function normalizeStartTimeTyping(raw) {
  let s = String(raw ?? '')
    .replace(/,/g, '.')
    .replace(/[^\d.:]/g, '');
  const ci = s.indexOf(':');
  if (ci !== -1) {
    s = s.slice(0, ci + 1) + s.slice(ci + 1).replace(/:/g, '');
  }

  if (s.includes(':')) {
    const i = s.indexOf(':');
    let left = s.slice(0, i).replace(/\D/g, '');
    const rest = s.slice(i + 1);
    let right = '';
    let dotUsed = false;
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k];
      if (/\d/.test(ch)) right += ch;
      else if (ch === '.' && !dotUsed && right.length > 0) {
        right += '.';
        dotUsed = true;
      } else break;
    }
    if (dotUsed) {
      const [whole, frac = ''] = right.split('.');
      const f = frac.slice(0, 1);
      right = f.length ? `${whole}.${f}` : `${whole}.`;
    }
    if (!left && !right) return '0:';
    if (!left && right) left = '0';
    return `${left}:${right}`;
  }

  if (s.includes('.')) {
    const cleaned = s.replace(/[^\d.]/g, '');
    const dot = cleaned.indexOf('.');
    const head = cleaned.slice(0, dot).replace(/\D/g, '');
    const frac = cleaned.slice(dot + 1).replace(/\D/g, '').slice(0, 1);
    return frac.length ? `${head}.${frac}` : `${head}.`;
  }

  const digits = s.replace(/\D/g, '');
  if (!digits.length) return '';
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return `${digits[0]}:${digits.slice(1)}`;
  return `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

function bindStartField() {
  els.startSec.addEventListener('focus', () => {
    const max = getStartSecMax();
    const v = Math.round(clamp(parseStartSecFromField(), 0, max));
    els.startSec.dataset.commitBaseline = String(v);
  });

  els.startSec.addEventListener('input', (e) => {
    if (/** @type {InputEvent} */ (e).isComposing) return;
    const el = els.startSec;
    const oldVal = el.value;
    const caret = el.selectionStart ?? oldVal.length;
    const norm = normalizeStartTimeTyping(oldVal);
    if (norm === oldVal) return;
    const d = digitsLeftOfCaret(oldVal, caret);
    el.value = norm;
    const next = caretAfterNthDigit(norm, d);
    requestAnimationFrame(() => {
      try {
        el.setSelectionRange(next, next);
      } catch {
        /* ignore */
      }
    });
    syncGoToStartButton();
  });

  els.startSec.addEventListener('blur', () => {
    delete els.startSec.dataset.commitBaseline;
    const max = getStartSecMax();
    const v = Math.round(clamp(parseStartSecFromField(), 0, max));
    els.startSec.value = formatStartReadout(v);
    persist();
    syncStartTimeUI();
    seekAudioToCommittedStart();
    syncTransport();
  });

  els.startSec.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      e.preventDefault();
      els.startSec.blur();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      const max = getStartSecMax();
      const baseline = parseFloat(els.startSec.dataset.commitBaseline || '');
      const fb = Number.isFinite(baseline) ? baseline : 0;
      els.startSec.value = formatStartReadout(Math.round(clamp(fb, 0, max)));
      delete els.startSec.dataset.commitBaseline;
      els.startSec.blur();
    }
  });
}

function clampStartSecToMax() {
  const max = getStartSecMax();
  const v = Math.round(clamp(parseStartSecFromField(), 0, max));
  els.startSec.value = formatStartReadout(v);
  els.startSec.setAttribute('max', String(max));
  syncStartTimeUI();
}

function loadStored() {
  const d = localStorage.getItem(STORAGE.DELAY_SEC);
  const s = localStorage.getItem(STORAGE.START_SEC);
  if (d !== null && els.delayChips) {
    const n = nearestDelayOption(parseInt(d, 10));
    const chip = els.delayChips.querySelector(`[data-delay="${n}"]`);
    if (chip) selectDelayChip(/** @type {HTMLElement} */ (chip));
  }
  if (s !== null) {
    const x = clamp(parseFloat(s), 0, 360000);
    if (!Number.isNaN(x)) els.startSec.value = formatStartReadout(Math.round(x));
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function nearestDelayOption(sec) {
  const raw = parseInt(String(sec), 10);
  if (!Number.isFinite(raw) || raw <= 0) return 5;
  const x = clamp(Math.round(raw), 3, 10);
  let best = DELAY_OPTIONS[0];
  let bestDist = Math.abs(best - x);
  for (const o of DELAY_OPTIONS) {
    const dist = Math.abs(o - x);
    if (dist < bestDist || (dist === bestDist && o < best)) {
      best = o;
      bestDist = dist;
    }
  }
  return best;
}

function getDelaySec() {
  if (!els.delayChips) return 5;
  const sel = els.delayChips.querySelector('.delay-chip--selected');
  if (!sel) return 5;
  const v = parseInt(sel.getAttribute('data-delay'), 10);
  return DELAY_OPTIONS.includes(v) ? v : nearestDelayOption(v);
}

function selectDelayChip(btn) {
  if (!els.delayChips || !btn) return;
  els.delayChips.querySelectorAll('.delay-chip').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('delay-chip--selected', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.tabIndex = on ? 0 : -1;
  });
}

function persist() {
  localStorage.setItem(STORAGE.DELAY_SEC, String(getDelaySec()));
  localStorage.setItem(STORAGE.START_SEC, String(getCommittedStartSec()));
}

function clearTick() {
  if (tick !== null) {
    cancelAnimationFrame(tick);
    tick = null;
  }
}

function updateCountdownRing(leftMs) {
  if (!els.countdownStage) return;
  const pct =
    countdownTotalSec > 0 ? clamp(1 - leftMs / (countdownTotalSec * 1000), 0, 1) : 0;
  els.countdownStage.style.setProperty('--countdown-pct', String(pct));
}

/** Two-digit values (e.g. 10s) need a smaller headline or they clip inside the ring. */
function setCountdownDisplayedSeconds(n) {
  if (!els.countdown) return;
  const s = String(n);
  els.countdown.textContent = s;
  els.countdown.classList.toggle('countdown-num--double', s.length >= 2);
}

function enterCountdownMode(totalSec) {
  countdownTotalSec = totalSec;
  if (!els.countdownIdle || !els.countdownActive || !els.countdownStage || !els.countdown) return;
  els.countdownIdle.hidden = true;
  els.countdownActive.hidden = false;
  els.countdownStage.classList.add('countdown--ticking');
  els.countdown.classList.add('is-ticking');
  updateCountdownRing(countdownTotalSec * 1000);
  setCountdownDisplayedSeconds(totalSec);
  lastDisplayedSec = totalSec;
  if (els.countdownPillTime) els.countdownPillTime.textContent = formatTime(countdownResumeAtSec);
}

function setCountdownIdle() {
  countdownTotalSec = 0;
  lastDisplayedSec = null;
  if (!els.countdownStage || !els.countdownIdle || !els.countdownActive || !els.countdown) return;
  els.countdownStage.style.removeProperty('--countdown-pct');
  els.countdownStage.classList.remove('countdown--ticking');
  els.countdown.classList.remove('is-ticking', 'countdown-num--double');
  els.countdownIdle.hidden = false;
  els.countdownActive.hidden = true;
  const hint = els.countdownIdle.querySelector('[data-i18n="hint_countdown"]');
  if (hint) hint.textContent = getStrings(getCurrentLocale()).hint_countdown;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getDuration() {
  const d = els.audio.duration;
  return Number.isFinite(d) && d > 0 ? d : 0;
}

function fileExtFromName(name) {
  if (!name) return '';
  const i = name.lastIndexOf('.');
  if (i < 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toUpperCase();
}

function syncTrackMeta() {
  const el = els.trackMeta;
  if (!el) return;
  const s = getStrings(getCurrentLocale());
  if (!els.audio.src) {
    el.textContent = s.track_meta_idle;
    return;
  }
  const name = els.trackName.getAttribute('title') || els.trackName.textContent || '';
  const ext = fileExtFromName(name);
  const d = getDuration();
  if (d <= 0) {
    el.textContent = ext || s.track_meta_loading;
    return;
  }
  const dur = formatTime(d);
  el.textContent = ext ? `${dur} \u2022 ${ext}` : dur;
}

function setTransportThumbPct(pct) {
  els.transportTrack.style.setProperty('--transport-pct', `${clamp(pct, 0, 100)}%`);
}

function updateTransportAria() {
  const track = els.transportTrack;
  if (!track) return;
  const d = getDuration();
  const t = els.audio.currentTime;
  if (d <= 0) {
    track.setAttribute('aria-valuenow', '0');
    track.setAttribute('aria-valuetext', '');
    return;
  }
  const s = getStrings(getCurrentLocale());
  const pct = clamp((t / d) * 100, 0, 100);
  track.setAttribute('aria-valuenow', String(Math.round(pct)));
  track.setAttribute('aria-valuetext', `${formatTime(t)} ${s.transport_time_of} ${formatTime(d)}`);
}

function transportTimelineReady() {
  return !!els.audio.src && getDuration() > 0;
}

function syncTransportAvailability() {
  const ready = transportTimelineReady();
  els.transport.classList.toggle('transport--idle', !ready);
  els.transportTrack.tabIndex = ready ? 0 : -1;
  if (ready) els.transportTrack.removeAttribute('aria-disabled');
  else els.transportTrack.setAttribute('aria-disabled', 'true');
}

function syncTransport() {
  if (isScrubbing) return;
  const d = els.audio.duration;
  if (!Number.isFinite(d) || d <= 0) {
    els.timeDuration.textContent = '0:00';
    els.transportFill.style.width = '0%';
    els.timeCurrent.textContent = formatTime(els.audio.currentTime);
    updateTransportAria();
    setTransportThumbPct(0);
  } else {
    els.timeDuration.textContent = formatTime(d);
    els.timeCurrent.textContent = formatTime(els.audio.currentTime);
    const pct = clamp((els.audio.currentTime / d) * 100, 0, 100);
    els.transportFill.style.width = `${pct}%`;
    updateTransportAria();
    setTransportThumbPct(pct);
  }
  syncTransportAvailability();
}

function ratioFromClientX(clientX) {
  const rail = els.transportTrack.querySelector('.transport-bar-rail');
  const target = rail instanceof Element ? rail : els.transportTrack;
  const rect = target.getBoundingClientRect();
  const x = clamp(clientX - rect.left, 0, rect.width);
  return rect.width > 0 ? x / rect.width : 0;
}

function seekToRatio(ratio) {
  const d = getDuration();
  if (d <= 0) return;
  const r = clamp(ratio, 0, 1);
  els.audio.currentTime = r * d;
  els.timeDuration.textContent = formatTime(d);
  els.timeCurrent.textContent = formatTime(els.audio.currentTime);
  els.transportFill.style.width = `${r * 100}%`;
  updateTransportAria();
  setTransportThumbPct(r * 100);
}

function revokeUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function bindFile() {
  els.fileBtn.addEventListener('click', () => els.file.click());

  els.file.addEventListener('change', () => {
    const file = els.file.files?.[0];
    revokeUrl();
    if (!file) {
      els.trackName.textContent = getStrings(getCurrentLocale()).track_none;
      els.trackName.removeAttribute('title');
      els.audio.removeAttribute('src');
      clampStartSecToMax();
      syncTransport();
      syncActionButtons();
      syncTrackMeta();
      return;
    }
    objectUrl = URL.createObjectURL(file);
    els.audio.src = objectUrl;
    void els.audio.load();
    els.trackName.textContent = file.name;
    els.trackName.title = file.name;
    syncStartFieldAvailability();
    syncTransport();
    syncActionButtons();
    syncTrackMeta();
  });
}

function startSecForPlayback() {
  const max = getDuration() > 0 ? getStartSecMax() : 360000;
  return Math.round(clamp(parseStartSecFromField(), 0, max));
}

async function resumeAfterCountdown() {
  setCountdownIdle();
  try {
    await els.audio.play();
  } catch {
    /* iOS может отклонить без жеста — кнопка уже жест */
  }
  syncTransport();
  syncActionButtons();
}

function countdownLoop() {
  if (!els.countdown) {
    tick = null;
    return;
  }
  const leftMs = Math.max(0, countEndMs - Date.now());
  const left = Math.ceil(leftMs / 1000);
  updateCountdownRing(leftMs);

  if (left > 0) {
    if (left !== lastDisplayedSec) {
      lastDisplayedSec = left;
      setCountdownDisplayedSeconds(left);
      if (els.countdownPillTime) els.countdownPillTime.textContent = formatTime(countdownResumeAtSec);
    }
  }

  if (Date.now() >= countEndMs) {
    tick = null;
    lastDisplayedSec = null;
    void resumeAfterCountdown();
    return;
  }

  tick = requestAnimationFrame(countdownLoop);
}

async function playNow() {
  if (!els.audio.src) return;
  clearTick();
  setCountdownIdle();
  try {
    await els.audio.play();
  } catch {
    /* iOS может отклонить без жеста */
  }
  syncTransport();
  syncActionButtons();
}

function playWithCountdown() {
  if (!els.audio.src) return;
  const d = getDuration();
  if (d <= 0) return;
  let delaySec = getDelaySec();
  if (!DELAY_OPTIONS.includes(delaySec)) delaySec = nearestDelayOption(delaySec);
  delaySec = Math.max(3, delaySec);

  countdownResumeAtSec = Math.round(clamp(els.audio.currentTime, 0, d));

  persist();
  els.audio.pause();
  clearTick();
  countEndMs = Date.now() + delaySec * 1000;
  enterCountdownMode(delaySec);
  tick = requestAnimationFrame(countdownLoop);
  syncActionButtons();
}

function pausePlayback() {
  if (!els.audio.src) return;
  if (tick !== null) {
    clearTick();
    setCountdownIdle();
    syncActionButtons();
    return;
  }
  if (els.audio.paused) return;
  els.audio.pause();
  syncActionButtons();
}

function hardStop() {
  clearTick();
  els.audio.pause();
  els.audio.currentTime = startSecForPlayback();
  setCountdownIdle();
  syncTransport();
  syncActionButtons();
}

async function performGoToStart() {
  if (!els.audio.src || getDuration() <= 0) return;
  const resumePlayback = !els.audio.paused;
  if (tick !== null) {
    clearTick();
    setCountdownIdle();
  }
  els.audio.currentTime = startSecForPlayback();
  syncTransport();
  syncActionButtons();
  if (resumePlayback) {
    try {
      await els.audio.play();
    } catch {
      /* iOS may reject */
    }
  }
}

function bindDelayChips() {
  const root = els.delayChips;
  if (!root) return;

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.delay-chip');
    if (!btn || !root.contains(btn)) return;
    selectDelayChip(/** @type {HTMLElement} */ (btn));
    persist();
    syncActionButtons();
  });

  root.addEventListener('keydown', (e) => {
    const chips = [...root.querySelectorAll('.delay-chip')];
    const i = chips.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (i < 0) return;
    if (e.code === 'ArrowRight' || e.code === 'ArrowDown') {
      e.preventDefault();
      const next = chips[(i + 1) % chips.length];
      selectDelayChip(next);
      next.focus();
      persist();
      syncActionButtons();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
      e.preventDefault();
      const next = chips[(i - 1 + chips.length) % chips.length];
      selectDelayChip(next);
      next.focus();
      persist();
      syncActionButtons();
      return;
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      selectDelayChip(chips[i]);
      persist();
      syncActionButtons();
    }
  });
}

function bindControls() {
  bindDelayChips();

  if (els.btnSetStartCurrent) {
    els.btnSetStartCurrent.addEventListener('click', () => {
      if (getDuration() <= 0) return;
      const max = getStartSecMax();
      const t = Math.round(clamp(els.audio.currentTime, 0, max));
      els.startSec.value = formatStartReadout(t);
      persist();
      syncStartTimeUI();
      if (els.audio.paused) syncTransport();
    });
  }

  els.playPause.addEventListener('click', () => {
    if (tick !== null || !els.audio.paused) pausePlayback();
    else void playNow();
  });
  if (els.playCountdown) {
    els.playCountdown.addEventListener('click', () => {
      if (tick !== null) pausePlayback();
      else playWithCountdown();
    });
  }
  if (els.goToStart) els.goToStart.addEventListener('click', () => void performGoToStart());

  els.audio.addEventListener('play', syncActionButtons);
  els.audio.addEventListener('pause', syncActionButtons);

  function applyAudioDuration() {
    if (getDuration() <= 0) {
      syncTransport();
      syncActionButtons();
      syncTrackMeta();
      return;
    }
    clampStartSecToMax();
    syncTransport();
    syncActionButtons();
    syncTrackMeta();
  }

  els.audio.addEventListener('loadedmetadata', applyAudioDuration);
  els.audio.addEventListener('durationchange', applyAudioDuration);

  els.audio.addEventListener('timeupdate', syncTransport);

  els.audio.addEventListener('ended', () => {
    setCountdownIdle();
    syncTransport();
    syncActionButtons();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!els.countdownStage?.classList.contains('countdown--ticking')) return;
    const leftMs = Math.max(0, countEndMs - Date.now());
    updateCountdownRing(leftMs);
    if (tick === null && leftMs > 0) tick = requestAnimationFrame(countdownLoop);
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const ae = document.activeElement;
      if (ae instanceof Element && ae.closest('#delay-chips')) return;
      if (ae instanceof Element && ae.closest('#btn-set-start-current')) return;
      if (
        ae === els.playPause ||
        ae === els.playCountdown ||
        ae === els.goToStart
      )
        return;
      const t = ae?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      const el = document.activeElement;
      if (
        el === els.transportTrack
      ) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      if (tick !== null) {
        pausePlayback();
        return;
      }
      if (!els.audio.paused) {
        pausePlayback();
        return;
      }
      if (!els.playPause.disabled) void playNow();
    }
    if (e.code === 'Escape') {
      if (document.activeElement === els.startSec) return;
      hardStop();
    }
  });
}

function bindTransportScrub() {
  const track = els.transportTrack;

  const endScrub = () => {
    if (!isScrubbing) return;
    isScrubbing = false;
    track.classList.remove('is-scrubbing');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endScrub);
    window.removeEventListener('pointercancel', endScrub);
    syncTransport();
  };

  /** @param {PointerEvent} e */
  const onPointerMove = (e) => {
    if (!isScrubbing) return;
    seekToRatio(ratioFromClientX(e.clientX));
  };

  track.addEventListener('pointerdown', (e) => {
    if (getDuration() <= 0) return;
    if (e.button !== 0) return;
    e.preventDefault();
    track.focus({ preventScroll: true });
    isScrubbing = true;
    track.classList.add('is-scrubbing');
    seekToRatio(ratioFromClientX(e.clientX));
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endScrub);
    window.addEventListener('pointercancel', endScrub);
  });

  track.addEventListener('keydown', (e) => {
    if (getDuration() <= 0) return;
    const d = getDuration();
    let t = els.audio.currentTime;
    let handled = true;
    if (e.code === 'ArrowRight') t = clamp(t + 5, 0, d);
    else if (e.code === 'ArrowLeft') t = clamp(t - 5, 0, d);
    else if (e.code === 'Home') t = 0;
    else if (e.code === 'End') t = d;
    else handled = false;
    if (!handled) return;
    e.preventDefault();
    els.audio.currentTime = t;
    syncTransport();
  });
}

function wireLangSelect() {
  document.querySelectorAll('.j-lang-select').forEach((sel) => {
    sel.addEventListener('change', () => applyLang(/** @type {HTMLSelectElement} */ (sel).value));
  });
}

function refreshDynamicCopy() {
  if (!els.countdownStage?.classList.contains('countdown--ticking')) {
    const hint = els.countdownIdle?.querySelector('[data-i18n="hint_countdown"]');
    if (hint) hint.textContent = getStrings(getCurrentLocale()).hint_countdown;
  }
  if (!els.audio.src) {
    els.trackName.textContent = getStrings(getCurrentLocale()).track_none;
    els.trackName.removeAttribute('title');
  }
  updateTransportAria();
  syncActionButtons();
  syncTrackMeta();
}

function init() {
  document.addEventListener('dance-player:lang', refreshDynamicCopy);
  loadStored();
  applyLang(readStoredLang());
  clampStartSecToMax();
  els.playPause.disabled = true;
  setCountdownIdle();
  syncTransport();
  wireLangSelect();
  bindFile();
  bindControls();
  bindTransportScrub();
  bindStartField();
  syncTrackMeta();
  syncActionButtons();
}

init();
