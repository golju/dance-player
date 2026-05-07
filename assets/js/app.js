/** Dance cue player — local file, countdown, fixed start offset. */

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
  stop: document.getElementById('btn-stop'),
  countdown: document.getElementById('countdown-num'),
  audio: document.getElementById('player'),
  transport: document.getElementById('transport'),
  timeCurrent: document.getElementById('time-current'),
  timeDuration: document.getElementById('time-duration'),
  transportFill: document.getElementById('transport-fill'),
};

/** @type {string | null} */
let objectUrl = null;

/** @type {ReturnType<typeof setInterval> | null} */
let tick = null;

/** @type {number} */
let countEndMs = 0;

function loadStored() {
  const d = localStorage.getItem(STORAGE.DELAY_SEC);
  const s = localStorage.getItem(STORAGE.START_SEC);
  if (d !== null) {
    const n = clamp(parseInt(d, 10), 0, 10);
    els.delaySlider.value = String(n);
  }
  if (s !== null) {
    const x = clamp(parseFloat(s), 0, 3600);
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

const IDLE_HINT = 'После запуска — обратный отсчёт';

function setCountdownIdle() {
  els.countdown.classList.add('countdown-hint');
  els.countdown.classList.remove('is-ticking');
  els.countdown.textContent = IDLE_HINT;
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

function syncTransport() {
  const d = els.audio.duration;
  if (!Number.isFinite(d) || d <= 0) {
    els.timeDuration.textContent = '0:00';
    els.transportFill.style.width = '0%';
    els.timeCurrent.textContent = formatTime(els.audio.currentTime);
    return;
  }
  els.timeDuration.textContent = formatTime(d);
  els.timeCurrent.textContent = formatTime(els.audio.currentTime);
  const pct = clamp((els.audio.currentTime / d) * 100, 0, 100);
  els.transportFill.style.width = `${pct}%`;
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
      els.trackName.textContent = 'Файл не выбран';
      els.play.disabled = true;
      els.audio.removeAttribute('src');
      setTransportVisible(false);
      return;
    }
    objectUrl = URL.createObjectURL(file);
    els.audio.src = objectUrl;
    els.trackName.textContent = file.name;
    els.play.disabled = false;
  });
}

function syncDelayLabel() {
  const v = parseInt(els.delaySlider.value, 10);
  els.delayValue.textContent = v === 0 ? 'нет' : `${v} сек`;
}

async function beginPlay(startSec) {
  els.audio.currentTime = startSec;
  try {
    await els.audio.play();
  } catch {
    /* iOS может отклонить без жеста — кнопка уже жест */
  }
  els.play.disabled = false;
  setCountdownIdle();
  syncTransport();
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
  clearTick();
  const delaySec = clamp(parseInt(els.delaySlider.value, 10), 0, 10);
  const startSec = clamp(parseFloat(els.startSec.value) || 0, 0, 360000);

  if (!els.audio.src) return;

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
}

function hardStop() {
  clearTick();
  els.audio.pause();
  els.audio.currentTime = clamp(parseFloat(els.startSec.value) || 0, 0, 360000);
  els.play.disabled = !els.audio.src;
  setCountdownIdle();
  syncTransport();
}

function bindControls() {
  els.delaySlider.addEventListener('input', () => {
    syncDelayLabel();
    persist();
  });

  els.startSec.addEventListener('input', () => {
    persist();
    if (els.audio.paused) syncTransport();
  });

  els.play.addEventListener('click', () => void armPlayback());
  els.stop.addEventListener('click', hardStop);

  els.audio.addEventListener('loadedmetadata', () => {
    setTransportVisible(true);
    syncTransport();
  });

  els.audio.addEventListener('timeupdate', syncTransport);

  els.audio.addEventListener('ended', () => {
    els.play.disabled = !els.audio.src;
    setCountdownIdle();
    syncTransport();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && tick !== null) runCountdownStep();
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const t = document.activeElement?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
      e.preventDefault();
      if (!els.audio.paused) return;
      if (!els.play.disabled) void armPlayback();
    }
    if (e.code === 'Escape') hardStop();
  });
}

function init() {
  loadStored();
  syncDelayLabel();
  els.trackName.textContent = 'Файл не выбран';
  els.play.disabled = true;
  setCountdownIdle();
  setTransportVisible(false);
  bindFile();
  bindControls();
}

init();
