/** Dance Player — local file, countdown, fixed start offset. */

import { applyLang, getCurrentLocale, getStrings, readStoredLang } from './i18n/apply.js';

const STORAGE = {
  DELAY_SEC: 'dancePlayer.delaySec',
  START_SEC: 'dancePlayer.startSec',
};

const els = {
  file: document.getElementById('audio-file'),
  fileBtn: document.getElementById('pick-file-btn'),
  trackName: document.getElementById('track-name'),
  delaySlider: document.getElementById('delay-slider'),
  delayValue: document.getElementById('delay-value'),
  startSec: document.getElementById('start-sec'),
  play: document.getElementById('btn-play'),
  pause: document.getElementById('btn-pause'),
  stop: document.getElementById('btn-stop'),
  countdown: document.getElementById('countdown-num'),
  audio: document.getElementById('player'),
  transport: document.getElementById('transport'),
  transportTrack: document.getElementById('transport-track'),
  timeCurrent: document.getElementById('time-current'),
  timeDuration: document.getElementById('time-duration'),
  transportFill: document.getElementById('transport-fill'),
  startTimeRoller: document.getElementById('start-time-roller'),
  timeRollerFrame: document.getElementById('time-roller-frame'),
  timeRollerScroll: document.getElementById('time-roller-scroll'),
  timeRollerSpacer: document.getElementById('time-roller-spacer'),
  timeRollerPrev: document.getElementById('time-roller-prev'),
  timeRollerLive: document.getElementById('time-roller-live'),
  timeRollerNext: document.getElementById('time-roller-next'),
  timeRollerReadoutSr: document.getElementById('time-roller-readout-sr'),
  timeRollerMax: document.getElementById('time-roller-max'),
};

/** @type {string | null} */
let objectUrl = null;

/** @type {ReturnType<typeof setInterval> | null} */
let tick = null;

/** @type {number} */
let countEndMs = 0;

/** @type {boolean} */
let isScrubbing = false;

/** @type {boolean} */
let resumeAfterUserPause = false;

function syncActionButtons() {
  const hasSrc = !!els.audio.src;
  const counting = tick !== null;
  const playing = !els.audio.paused;
  els.play.disabled = !hasSrc || playing || counting;
  els.pause.disabled = !hasSrc || (!playing && !counting);
}

/** Pixel height of one roller step (derived from `--roller-item-h`). */
let rollerItemH = 44;

/** @type {{ steps: number, stepTenths: number } | null} */
let rollerMeta = null;

const MAX_ROLLER_STEPS = 12000;

function buildRollerMeta(maxSec) {
  const maxT = Math.round(maxSec * 10);
  if (maxT + 1 <= MAX_ROLLER_STEPS) {
    return { steps: maxT + 1, stepTenths: 1 };
  }
  const whole = Math.floor(maxSec) + 1;
  if (whole <= MAX_ROLLER_STEPS) {
    return { steps: whole, stepTenths: 10 };
  }
  const stepSec = Math.ceil((maxSec / (MAX_ROLLER_STEPS - 1)) * 1000) / 1000;
  const steps = Math.min(MAX_ROLLER_STEPS, Math.floor(maxSec / stepSec) + 1);
  return { steps, stepTenths: Math.round(stepSec * 10) };
}

function refreshRollerMeta() {
  rollerMeta = buildRollerMeta(getStartSecMax());
}

function readRollerItemH() {
  if (!els.timeRollerScroll) return rollerItemH;
  const st = getComputedStyle(els.timeRollerScroll);
  const raw = st.getPropertyValue('--roller-item-h').trim();
  if (raw.endsWith('rem')) {
    const rem = parseFloat(raw);
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    rollerItemH = rem * rootPx;
  } else if (raw.endsWith('px')) {
    rollerItemH = parseFloat(raw) || rollerItemH;
  }
  return rollerItemH;
}

function idxToSec(idx, meta, max) {
  const raw = (idx * meta.stepTenths) / 10;
  return clamp(Math.round(raw * 10) / 10, 0, max);
}

function secToIdx(sec, meta, max) {
  const t = Math.round(clamp(sec, 0, max) * 10);
  const idx = Math.round(t / meta.stepTenths);
  return clamp(idx, 0, meta.steps - 1);
}

function updateRollerStack(idx, meta, max) {
  if (idx > 0) els.timeRollerPrev.textContent = formatStartReadout(idxToSec(idx - 1, meta, max));
  else els.timeRollerPrev.textContent = '\u00a0';
  els.timeRollerLive.textContent = formatStartReadout(idxToSec(idx, meta, max));
  if (idx < meta.steps - 1) els.timeRollerNext.textContent = formatStartReadout(idxToSec(idx + 1, meta, max));
  else els.timeRollerNext.textContent = '\u00a0';
}

let rollerSuppressCommit = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let rollerCommitTimer = null;

let manualStartEditing = false;

function endRollerSuppress() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      rollerSuppressCommit = false;
    });
  });
}

function syncStartTimeUI() {
  const max = getStartSecMax();
  const v = clamp(parseFloat(els.startSec.value) || 0, 0, max);
  refreshRollerMeta();
  const meta = rollerMeta;
  if (!meta) return;

  const lbl = formatStartReadout(v);
  els.timeRollerReadoutSr.textContent = lbl;
  els.timeRollerLive.textContent = lbl;
  els.timeRollerMax.textContent = formatStartReadout(max);
  els.startTimeRoller.setAttribute('aria-valuemax', String(Math.round(max * 10) / 10));
  els.startTimeRoller.setAttribute('aria-valuenow', String(Math.round(v * 10) / 10));
  els.startTimeRoller.setAttribute('aria-valuetext', lbl);

  rollerSuppressCommit = true;
  requestAnimationFrame(() => {
    readRollerItemH();
    els.timeRollerSpacer.style.height = `${meta.steps * rollerItemH}px`;
    const idx = secToIdx(v, meta, max);
    els.timeRollerScroll.scrollTop = idx * rollerItemH;
    updateRollerStack(idx, meta, max);
    endRollerSuppress();
  });
}

function onRollerScrollLive() {
  if (rollerSuppressCommit) return;
  readRollerItemH();
  const max = getStartSecMax();
  const meta = rollerMeta;
  if (!meta) return;
  const idx = clamp(Math.round(els.timeRollerScroll.scrollTop / rollerItemH), 0, meta.steps - 1);
  const v = idxToSec(idx, meta, max);
  els.timeRollerLive.textContent = formatStartReadout(v);
  updateRollerStack(idx, meta, max);
}

function commitRollerFromScroll() {
  if (rollerSuppressCommit) return;
  readRollerItemH();
  refreshRollerMeta();
  const max = getStartSecMax();
  const meta = rollerMeta;
  if (!meta) return;
  const idx = clamp(Math.round(els.timeRollerScroll.scrollTop / rollerItemH), 0, meta.steps - 1);
  const v = idxToSec(idx, meta, max);
  els.startSec.value = String(v);
  persist();
  const lbl = formatStartReadout(v);
  els.timeRollerReadoutSr.textContent = lbl;
  els.timeRollerLive.textContent = lbl;
  els.timeRollerMax.textContent = formatStartReadout(max);
  els.startTimeRoller.setAttribute('aria-valuemax', String(Math.round(max * 10) / 10));
  els.startTimeRoller.setAttribute('aria-valuenow', String(Math.round(v * 10) / 10));
  els.startTimeRoller.setAttribute('aria-valuetext', lbl);
  rollerSuppressCommit = true;
  els.timeRollerScroll.scrollTop = idx * rollerItemH;
  updateRollerStack(idx, meta, max);
  endRollerSuppress();
  if (els.audio.paused) syncTransport();
}

function scheduleRollerCommit() {
  if (rollerSuppressCommit) return;
  if (rollerCommitTimer) clearTimeout(rollerCommitTimer);
  rollerCommitTimer = setTimeout(() => {
    rollerCommitTimer = null;
    commitRollerFromScroll();
  }, 120);
}

function bindStartRoller() {
  const sc = els.timeRollerScroll;
  sc.addEventListener('scroll', () => {
    onRollerScrollLive();
    scheduleRollerCommit();
  }, { passive: true });

  sc.addEventListener('scrollend', () => {
    if (rollerSuppressCommit) return;
    if (rollerCommitTimer) clearTimeout(rollerCommitTimer);
    rollerCommitTimer = null;
    commitRollerFromScroll();
  });

  sc.addEventListener('keydown', (e) => {
    refreshRollerMeta();
    const meta = rollerMeta;
    if (!meta) return;
    let d = 0;
    if (e.code === 'ArrowUp') d = -1;
    else if (e.code === 'ArrowDown') d = 1;
    else if (e.code === 'PageUp') d = -5;
    else if (e.code === 'PageDown') d = 5;
    else return;
    e.preventDefault();
    readRollerItemH();
    const idx = clamp(Math.round(sc.scrollTop / rollerItemH), 0, meta.steps - 1);
    const ni = clamp(idx + d, 0, meta.steps - 1);
    sc.scrollTo({ top: ni * rollerItemH, behavior: 'smooth' });
  });
}

function getStartSecMax() {
  const d = getDuration();
  return d > 0 ? Math.min(d, 360000) : 3600;
}

function formatStartReadout(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  sec = Math.round(sec * 10) / 10;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const whole = Math.floor(s);
  const tenths = Math.round((s - whole) * 10);
  let body = `${m}:${String(whole).padStart(2, '0')}`;
  if (tenths > 0) body += `.${tenths}`;
  return body;
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

function commitManualStartInput() {
  if (!manualStartEditing) return;
  const max = getStartSecMax();
  const fallback = parseFloat(els.startSec.dataset.lastValid || '0') || 0;
  const parsed = parseTimeInput(els.startSec.value);
  const v = Number.isFinite(parsed) ? clamp(parsed, 0, max) : clamp(fallback, 0, max);
  els.startSec.value = String(v);
  delete els.startSec.dataset.lastValid;
  manualStartEditing = false;
  els.startTimeRoller.classList.remove('is-start-manual');
  els.startSec.setAttribute('tabindex', '-1');
  els.startSec.setAttribute('aria-hidden', 'true');
  persist();
  syncStartTimeUI();
  if (els.audio.paused) syncTransport();
}

function cancelManualStartInput() {
  if (!manualStartEditing) return;
  const max = getStartSecMax();
  const fallback = parseFloat(els.startSec.dataset.lastValid || '0') || 0;
  els.startSec.value = String(clamp(fallback, 0, max));
  delete els.startSec.dataset.lastValid;
  manualStartEditing = false;
  els.startTimeRoller.classList.remove('is-start-manual');
  els.startSec.setAttribute('tabindex', '-1');
  els.startSec.setAttribute('aria-hidden', 'true');
}

function openManualStartInput() {
  if (manualStartEditing) return;
  manualStartEditing = true;
  const max = getStartSecMax();
  const v = clamp(parseFloat(els.startSec.value) || 0, 0, max);
  els.startSec.dataset.lastValid = String(v);
  els.startSec.value = formatStartReadout(v);
  els.startSec.removeAttribute('aria-hidden');
  els.startSec.setAttribute('tabindex', '0');
  els.startTimeRoller.classList.add('is-start-manual');
  requestAnimationFrame(() => {
    els.startSec.focus();
    els.startSec.select();
  });
}

function bindStartManualEntry() {
  els.timeRollerFrame.addEventListener('dblclick', (e) => {
    e.preventDefault();
    openManualStartInput();
  });

  els.startSec.addEventListener('blur', () => {
    if (manualStartEditing) commitManualStartInput();
  });

  els.startSec.addEventListener('keydown', (e) => {
    if (!manualStartEditing) return;
    if (e.code === 'Enter') {
      e.preventDefault();
      els.startSec.blur();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelManualStartInput();
      els.timeRollerScroll.focus({ preventScroll: true });
    }
  });
}

function clampStartSecToMax() {
  const max = getStartSecMax();
  const raw = parseFloat(els.startSec.value);
  const v = clamp(Number.isFinite(raw) ? raw : 0, 0, max);
  if (!Number.isFinite(raw) || Math.abs(raw - v) > 0.001) els.startSec.value = String(v);
  els.startSec.setAttribute('max', String(max));
  syncStartTimeUI();
}

function loadStored() {
  const d = localStorage.getItem(STORAGE.DELAY_SEC);
  const s = localStorage.getItem(STORAGE.START_SEC);
  if (d !== null) {
    const n = clamp(parseInt(d, 10), 0, 10);
    els.delaySlider.value = String(n);
  }
  if (s !== null) {
    const x = clamp(parseFloat(s), 0, 360000);
    if (!Number.isNaN(x)) els.startSec.value = String(x);
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function persist() {
  localStorage.setItem(STORAGE.DELAY_SEC, els.delaySlider.value);
  localStorage.setItem(STORAGE.START_SEC, els.startSec.value);
}

function clearTick() {
  if (tick !== null) {
    clearInterval(tick);
    tick = null;
  }
}

function setCountdownIdle() {
  els.countdown.classList.add('countdown-hint');
  els.countdown.classList.remove('is-ticking');
  els.countdown.textContent = getStrings(getCurrentLocale()).hint_countdown;
}

function setCountdownTick(n) {
  els.countdown.classList.remove('countdown-hint');
  els.countdown.classList.add('is-ticking');
  els.countdown.textContent = String(n);
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

function updateTransportAria() {
  const track = els.transportTrack;
  if (!track || els.transport.hidden) return;
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

function syncTransport() {
  if (isScrubbing) return;
  const d = els.audio.duration;
  if (!Number.isFinite(d) || d <= 0) {
    els.timeDuration.textContent = '0:00';
    els.transportFill.style.width = '0%';
    els.timeCurrent.textContent = formatTime(els.audio.currentTime);
    updateTransportAria();
    return;
  }
  els.timeDuration.textContent = formatTime(d);
  els.timeCurrent.textContent = formatTime(els.audio.currentTime);
  const pct = clamp((els.audio.currentTime / d) * 100, 0, 100);
  els.transportFill.style.width = `${pct}%`;
  updateTransportAria();
}

function ratioFromClientX(clientX) {
  const track = els.transportTrack;
  const rect = track.getBoundingClientRect();
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
}

function setTransportVisible(show) {
  els.transport.hidden = !show;
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
      els.play.disabled = true;
      els.audio.removeAttribute('src');
      setTransportVisible(false);
      resumeAfterUserPause = false;
      clampStartSecToMax();
      syncActionButtons();
      return;
    }
    objectUrl = URL.createObjectURL(file);
    els.audio.src = objectUrl;
    els.trackName.textContent = file.name;
    els.play.disabled = false;
    resumeAfterUserPause = false;
    syncActionButtons();
  });
}

function syncDelayLabel() {
  const v = parseInt(els.delaySlider.value, 10);
  const s = getStrings(getCurrentLocale());
  els.delayValue.textContent = v === 0 ? s.delay_none : `${v} ${s.delay_sec_unit}`;
}

async function beginPlay(startSec) {
  els.audio.currentTime = startSec;
  resumeAfterUserPause = false;
  try {
    await els.audio.play();
  } catch {
    /* iOS может отклонить без жеста — кнопка уже жест */
  }
  els.play.disabled = false;
  setCountdownIdle();
  syncTransport();
  syncActionButtons();
}

function runCountdownStep() {
  const left = Math.max(0, Math.ceil((countEndMs - Date.now()) / 1000));
  if (left > 0) setCountdownTick(left);

  if (Date.now() >= countEndMs) {
    clearTick();
    const startSec = clamp(parseFloat(els.startSec.value) || 0, 0, 360000);
    void beginPlay(startSec);
  }
}

async function armPlayback() {
  if (!els.audio.src) return;

  if (resumeAfterUserPause && tick === null && els.audio.paused) {
    try {
      await els.audio.play();
    } catch {
      /* ignore */
    }
    resumeAfterUserPause = false;
    syncActionButtons();
    return;
  }

  resumeAfterUserPause = false;
  clearTick();
  const delaySec = clamp(parseInt(els.delaySlider.value, 10), 0, 10);
  const startSec = clamp(parseFloat(els.startSec.value) || 0, 0, 360000);

  persist();
  els.play.disabled = true;
  els.audio.pause();

  if (delaySec <= 0) {
    await beginPlay(startSec);
    return;
  }

  countEndMs = Date.now() + delaySec * 1000;
  runCountdownStep();
  tick = setInterval(runCountdownStep, 200);
  syncActionButtons();
}

function pausePlayback() {
  if (!els.audio.src) return;
  if (tick !== null) {
    clearTick();
    setCountdownIdle();
    resumeAfterUserPause = false;
    syncActionButtons();
    return;
  }
  if (els.audio.paused) return;
  els.audio.pause();
  resumeAfterUserPause = true;
  syncActionButtons();
}

function hardStop() {
  clearTick();
  resumeAfterUserPause = false;
  els.audio.pause();
  els.audio.currentTime = clamp(parseFloat(els.startSec.value) || 0, 0, 360000);
  els.play.disabled = !els.audio.src;
  setCountdownIdle();
  syncTransport();
  syncActionButtons();
}

function bindControls() {
  els.delaySlider.addEventListener('input', () => {
    syncDelayLabel();
    persist();
  });

  els.startSec.addEventListener('input', () => {
    if (manualStartEditing) return;
    persist();
    syncStartTimeUI();
    if (els.audio.paused) syncTransport();
  });

  els.play.addEventListener('click', () => void armPlayback());
  els.pause.addEventListener('click', pausePlayback);
  els.stop.addEventListener('click', hardStop);

  els.audio.addEventListener('play', syncActionButtons);
  els.audio.addEventListener('pause', syncActionButtons);

  els.audio.addEventListener('loadedmetadata', () => {
    setTransportVisible(true);
    clampStartSecToMax();
    syncTransport();
    syncActionButtons();
  });

  els.audio.addEventListener('timeupdate', syncTransport);

  els.audio.addEventListener('ended', () => {
    resumeAfterUserPause = false;
    els.play.disabled = !els.audio.src;
    setCountdownIdle();
    syncTransport();
    syncActionButtons();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tick !== null) runCountdownStep();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const t = document.activeElement?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      const el = document.activeElement;
      if (
        el === els.transportTrack ||
        (el instanceof Element && el.closest('.time-roller-scroll'))
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
      if (!els.play.disabled) void armPlayback();
    }
    if (e.code === 'Escape') hardStop();
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
  syncDelayLabel();
  if (!els.countdown.classList.contains('is-ticking')) {
    els.countdown.textContent = getStrings(getCurrentLocale()).hint_countdown;
  }
  if (!els.audio.src) els.trackName.textContent = getStrings(getCurrentLocale()).track_none;
  updateTransportAria();
}

function init() {
  document.addEventListener('dance-player:lang', refreshDynamicCopy);
  loadStored();
  applyLang(readStoredLang());
  clampStartSecToMax();
  els.play.disabled = true;
  setCountdownIdle();
  setTransportVisible(false);
  wireLangSelect();
  bindFile();
  bindControls();
  bindTransportScrub();
  bindStartRoller();
  bindStartManualEntry();
  syncActionButtons();
}

init();
