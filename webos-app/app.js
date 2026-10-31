'use strict';

const BASE = '/var/lib/webosbrew/linux-desktop';
const GITHUB_SOURCE = 'https://github.com/patelthakkar/webos-linux-desktop';
const SETUP_URL = `${GITHUB_SOURCE}#install`;
const PROBE = `base=${BASE}; if [ -x "$base/control.sh" ]; then "$base/control.sh" status; else echo missing; fi`;
const PREVIEW = new URLSearchParams(location.search).get('preview');
const PREVIEW_INCOGNITO = new URLSearchParams(location.search).get('incognito') === '1';
const PREVIEW_FRESH = new URLSearchParams(location.search).get('fresh') === '1';
const PREVIEW_SETTINGS = new URLSearchParams(location.search).get('settings') === '1';
const APP_VERSION = '1.1.0';
const SETTINGS_KEY = 'linuxdesktop.settings.v2';
const STATS_MS = 6000;
const DEFAULT_SETTINGS = { stats: true, incognito: false, freshStart: false };

const $ = (id) => document.getElementById(id);
const appShell = document.querySelector('.app');
const menu = $('menu');
const screen = $('screen');
const logs = $('logs');
const confirmBox = $('confirm');
const settingsPanel = $('settings');
const settingsScrim = $('settings-scrim');
const settingsOpen = $('settings-open');
const screenSettings = $('screen-settings');
const settingsClose = $('settings-close');
const log = $('log');
const primary = $('primary');
const secondary = $('secondary');
const logLink = $('log-link');
const rail = $('rail');
const stateText = $('state-text');
const headline = $('headline');
const lede = $('lede');
const hint = $('hint');
const modeBadge = $('mode-badge');
const freshBadge = $('fresh-badge');
const screenMode = $('screen-mode');
const factMode = $('fact-mode');
const persistNote = $('persist-note');
const deviceHint = $('device-hint');
const aboutRuntime = $('about-runtime');
const confirmTitle = $('confirm-title');
const confirmCopy = $('confirm-copy');
const confirmExtra = $('confirm-extra');
const confirmStop = $('confirm-stop');
const cancelStop = $('cancel-stop');

let state = { name: PREVIEW || 'checking', detail: '', hint: '' };
let previewState = PREVIEW;
let previewMode = PREVIEW_INCOGNITO ? 'incognito' : 'persistent';
let busy = false;
let opening = false;
let startDeadline = 0;
let startTimer = null;
let screenTimer = null;
let screenMisses = 0;
let lastFocus = null;
let lastSettingsFocus = null;
let pendingConfirm = 'stop';
let stats = null;
let inputs = null;
let statsInFlight = false;
let inputsInFlight = false;
let settings = loadSettings();

const config = {
  checking: {
    line: 'Checking session',
    headline: 'Checking\nsession.',
    lede: 'Looking for the Linux runtime on this TV.',
    hint: 'Checking for the Linux runtime and session state.',
    primary: { label: 'Please wait', disabled: true },
    secondary: null,
  },
  stopped: {
    line: 'Session stopped',
    headline: 'Desktop\nstopped.',
    lede: 'Start the session to open XFCE on this TV.',
    hint: 'USB and Bluetooth keyboards work best. Files persist between sessions.',
    primary: { label: 'Start desktop', action: 'start' },
    secondary: { label: 'Session log', action: 'logs' },
  },
  starting: {
    line: 'Session starting',
    headline: 'Starting\nLinux.',
    lede: 'The display server is coming up. This can take 10 to 20 seconds.',
    hint: 'The desktop opens when the display server is ready.',
    primary: { label: 'Starting…', disabled: true },
    secondary: { label: 'Session log', action: 'logs' },
  },
  running: {
    line: 'Session running',
    headline: 'Desktop\nrunning.',
    lede: 'Open the session, or stop it to release memory.',
    hint: 'Closing this app leaves the session running until you stop it.',
    primary: { label: 'Open desktop', action: 'open' },
    secondary: { label: 'Stop desktop', action: 'stop', danger: true },
    link: true,
  },
  stopping: {
    line: 'Session stopping',
    headline: 'Stopping\nLinux.',
    lede: 'Closing the session and releasing memory.',
    hint: 'The session stops when the display server exits.',
    primary: { label: 'Stopping…', disabled: true },
    secondary: null,
  },
  missing: {
    line: 'Runtime missing',
    headline: 'Setup\nrequired.',
    lede: 'The Linux runtime is not installed yet. Install it once over SSH, then check again.',
    hint: 'Setup does not add a boot service or change TV settings.',
    primary: { label: 'Setup guide', action: 'setup' },
    secondary: { label: 'Check again', action: 'check' },
  },
  error: {
    line: 'Session error',
    headline: 'Desktop\ndidn\'t start.',
    lede: 'The session did not start. The log has the details.',
    hint: 'Check the session log, then try again.',
    primary: { label: 'View session log', action: 'logs' },
    secondary: { label: 'Try again', action: 'retry' },
  },
};

function loadSettings() {
  const next = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof stored[key] === 'boolean') next[key] = stored[key];
      }
    }
  } catch (_) {}
  if (PREVIEW_FRESH) next.freshStart = true;
  return next;
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_) {}
}

function bridgeCall(uri, parameters, timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!window.PalmServiceBridge) {
      reject(new Error('Open this app on the TV. Homebrew Channel is required.'));
      return;
    }
    const bridge = new PalmServiceBridge();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { bridge.cancel(); } catch (_) {}
      reject(new Error('The TV service did not answer. Check Homebrew Channel.'));
    }, timeout);
    bridge.onservicecallback = (raw) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const result = JSON.parse(raw);
        if (!result.returnValue) {
          reject(new Error(result.stderrString || result.errorText || 'The command failed.'));
        } else {
          resolve((result.stdoutString || '').trim());
        }
      } catch (error) {
        reject(error);
      }
    };
    bridge.call(uri, JSON.stringify(parameters));
  });
}

function previewLog() {
  return [
    'Sat Oct 31 09:12:41 2026',
    ' vncext:      VNC extension running!',
    ' vncext:      Listening for VNC connections on local interface(s), port 5907',
    ' vncext:      Created VNC server for screen 0',
    'dbus-daemon[111]: Successfully activated service \'org.xfce.Xfconf\'',
    'xfce4-session: Starting session',
    'websockify: proxying from 127.0.0.1:6080 to 127.0.0.1:5907',
  ].join('\n');
}

function previewStats() {
  return JSON.stringify({
    runtimeVersion: APP_VERSION,
    load: '0.42',
    memTotal: 1745840,
    memUsed: 1120000,
    varFree: 198348,
    uptime: 40320,
    mode: previewState === 'running' ? previewMode : 'persistent',
  });
}

function previewInputs() {
  return [
    'usb_keyboard=1',
    'usb_keyboard_name=Logitech USB Keyboard',
    'usb_pointer=1',
    'usb_pointer_name=Logitech USB Optical Mouse',
    'bt_keyboard=0',
    'bt_keyboard_name=',
    'bt_pointer=0',
    'bt_pointer_name=',
  ].join('\n');
}

async function command(action) {
  if (PREVIEW) {
    if (action === 'status') return previewState || 'missing';
    if (action === 'logs') return previewLog();
    if (action === 'stats') return previewStats();
    if (action === 'inputs') return previewInputs();
    if (action === 'start') {
      previewMode = settings.incognito ? 'incognito' : 'persistent';
      previewState = 'starting';
      setTimeout(() => {
        previewState = 'running';
        if (PREVIEW) {
          probe();
          loadDashboard();
        }
      }, 1400);
      return 'starting';
    }
    if (action === 'stop') {
      previewState = 'stopped';
      previewMode = 'persistent';
      return 'stopped';
    }
  }
  const commands = {
    status: PROBE,
    start: settings.incognito
      ? `INCOGNITO=1 ${BASE}/control.sh start`
      : `${BASE}/control.sh start`,
    stop: `${BASE}/control.sh stop`,
    stats: `${BASE}/control.sh stats`,
    inputs: `${BASE}/control.sh inputs`,
    logs: `${BASE}/control.sh logs`,
  };
  return bridgeCall('luna://org.webosbrew.hbchannel.service/exec', { command: commands[action] });
}

function stateFromOutput(output) {
  const line = String(output).trim().split('\n').filter(Boolean).pop() || '';
  if (['running', 'starting', 'stopped', 'missing'].includes(line)) return { name: line };
  return { name: 'error', detail: line || 'No status returned.' };
}

function formatKbShort(value) {
  const kb = Number(value);
  if (!Number.isFinite(kb) || kb <= 0) return '—';
  const mb = kb / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  return `${Math.round(mb)}M`;
}

function formatUptime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function setStat(name, value, title) {
  for (const element of document.querySelectorAll(`[data-stat="${name}"]`)) {
    element.textContent = value;
    element.title = title;
  }
}

function applyStats(data) {
  const used = data ? formatKbShort(data.memUsed) : '';
  const total = data ? formatKbShort(data.memTotal) : '';
  const ram = data
    ? (used.endsWith('G') && total.endsWith('G') ? `${used.slice(0, -1)}/${total}` : `${used}/${total}`)
    : '—';
  const varFree = data ? formatKbShort(data.varFree) : '—';
  const load = data ? String(data.load || '—') : '—';
  const uptime = data ? formatUptime(data.uptime) : '—';
  setStat('load', load, data ? '1-minute load average on the TV.' : 'Statistics unavailable');
  setStat('ram', ram, data ? `RAM used: ${formatKbShort(data.memUsed)} of ${formatKbShort(data.memTotal)}.` : 'Statistics unavailable');
  setStat('var', varFree, data ? `/var free space: ${formatKbShort(data.varFree)}.` : 'Statistics unavailable');
  setStat('uptime', uptime, data ? 'TV uptime.' : 'Statistics unavailable');
  aboutRuntime.textContent = data && data.runtimeVersion ? `Runtime ${data.runtimeVersion}` : 'Runtime unavailable';
  updateModeUI();
  updateFreshUI();
}

function parseInputs(text) {
  const data = {};
  for (const line of String(text).split('\n')) {
    const split = line.indexOf('=');
    if (split < 1) continue;
    data[line.slice(0, split).trim()] = line.slice(split + 1);
  }
  return data;
}

function applyInputs(data) {
  const rows = {
    'usb-keyboard': ['usb_keyboard', 'usb_keyboard_name'],
    'usb-pointer': ['usb_pointer', 'usb_pointer_name'],
    'bt-keyboard': ['bt_keyboard', 'bt_keyboard_name'],
    'bt-pointer': ['bt_pointer', 'bt_pointer_name'],
  };
  let any = false;
  for (const [rowName, [flag, nameKey]] of Object.entries(rows)) {
    const row = document.querySelector(`[data-device="${rowName}"]`);
    if (!row) continue;
    const element = row.querySelector('.device-state');
    if (!data) {
      row.dataset.state = 'unknown';
      element.textContent = 'Unknown';
      element.title = '';
      continue;
    }
    const on = data[flag] === '1';
    const deviceName = String(data[nameKey] || '').trim();
    row.dataset.state = on ? 'on' : 'off';
    if (on) {
      element.textContent = deviceName ? `Detected · ${deviceName}` : 'Detected';
      element.title = deviceName;
      any = true;
    } else {
      element.textContent = 'Not connected';
      element.title = '';
    }
  }
  deviceHint.hidden = any || !data;
}

function updateIncognitoHint() {
  const incognitoHint = $('incognito-hint');
  if (!settings.incognito) {
    incognitoHint.hidden = true;
    return;
  }
  const active = ['running', 'starting'].includes(state.name);
  const current = active && stats && stats.mode === 'incognito';
  incognitoHint.hidden = false;
  if (active && current) {
    incognitoHint.textContent = 'This session is in RAM. Stop ends it and erases its files.';
  } else if (active) {
    incognitoHint.textContent = 'Applies the next time the desktop starts. Stop the current session first.';
  } else {
    incognitoHint.textContent = 'The next session runs in RAM and is erased when you stop it.';
  }
}

function updateFreshUI() {
  freshBadge.hidden = !settings.freshStart;
  const freshHint = $('fresh-hint');
  if (!settings.freshStart) {
    freshHint.hidden = true;
    return;
  }
  freshHint.hidden = false;
  if (state.name === 'running') {
    freshHint.textContent = 'Opening the desktop closes this session and starts clean.';
  } else if (state.name === 'starting') {
    freshHint.textContent = 'The next open starts clean.';
  } else {
    freshHint.textContent = 'The next start is clean.';
  }
}

function updateModeUI() {
  const active = ['running', 'starting'].includes(state.name);
  const incognito = active && stats && stats.mode === 'incognito';
  modeBadge.hidden = !incognito;
  screenMode.hidden = !incognito;
  factMode.textContent = incognito ? 'Incognito' : 'Persistent';
  factMode.classList.toggle('is-incognito', Boolean(incognito));
  persistNote.textContent = incognito ? 'Incognito · RAM only' : 'Files persist';
  persistNote.classList.toggle('is-incognito', Boolean(incognito));
  updateIncognitoHint();
}

function render() {
  const current = config[state.name] || config.error;
  document.body.dataset.state = state.name;
  stateText.textContent = current.line;
  headline.textContent = current.headline;
  lede.textContent = state.detail || current.lede;
  let hintText = state.hint || current.hint;
  if (state.name === 'running' && stats && stats.mode === 'incognito') {
    hintText = 'Closing this app leaves the incognito session running in RAM until you stop it.';
  }
  hint.textContent = hintText;

  const action = current.primary || {};
  primary.textContent = action.label || 'Please wait';
  primary.disabled = Boolean(action.disabled);
  primary.hidden = false;
  primary.dataset.action = action.action || '';
  primary.className = 'btn btn-primary';
  if (state.name === 'running' && settings.freshStart) {
    primary.textContent = 'Start fresh';
    primary.disabled = false;
    primary.dataset.action = 'fresh';
  }

  if (current.secondary) {
    secondary.hidden = false;
    secondary.textContent = current.secondary.label;
    secondary.disabled = false;
    secondary.dataset.action = current.secondary.action;
    secondary.className = `btn ${current.secondary.danger ? 'btn-danger' : 'btn-secondary'}`;
  } else {
    secondary.hidden = true;
    secondary.disabled = true;
    secondary.dataset.action = '';
  }

  logLink.hidden = !current.link;

  for (const step of rail.querySelectorAll('.rail-step')) {
    if (['stopped', 'starting', 'running'].includes(state.name) && step.dataset.step === state.name) {
      step.setAttribute('aria-current', 'step');
    } else {
      step.removeAttribute('aria-current');
    }
  }

  updateModeUI();
  updateFreshUI();

  if (!screen.hidden || !logs.hidden || !confirmBox.hidden || !settingsPanel.hidden) return;
  const active = document.activeElement;
  if (!(menu.contains(active) || active === settingsOpen) || active.disabled || active.hidden) {
    const target = primary.hidden || primary.disabled ? secondary : primary;
    if (target && !target.hidden && !target.disabled) target.focus();
  }
}

function setState(name, detail = '', hintText = '') {
  state = { name, detail, hint: hintText };
  render();
}

async function probe() {
  if (PREVIEW) {
    if (state.name === 'error') setState('error', state.detail);
    else setState(previewState || 'missing');
    return;
  }
  if (busy || opening) return;
  busy = true;
  try {
    const output = await command('status');
    const next = stateFromOutput(output);
    if (next.name === 'missing') {
      setState('missing');
      return;
    }
    if (next.name === 'error') {
      setState('error', next.detail);
      return;
    }
    if (next.name === 'running') {
      setState('running');
      return;
    }
    if (next.name === 'starting') {
      setState('starting');
      return;
    }
    setState('stopped');
  } catch (error) {
    setState('error', cleanError(error));
  } finally {
    busy = false;
  }
}

function cleanError(error) {
  const message = String(error && error.message ? error.message : error).split('\n')[0];
  return message.slice(0, 180);
}

function stopStartPoll() {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
}

function watchStart() {
  stopStartPoll();
  if (!opening) return;
  if (Date.now() > startDeadline) {
    opening = false;
    setState('error', 'The display server did not become ready in time.');
    return;
  }
  startTimer = setTimeout(async () => {
    try {
      const output = await command('status');
      const next = stateFromOutput(output);
      if (next.name === 'running') {
        opening = false;
        startTimer = null;
        setState('running');
        loadDashboard();
        showDesktop();
        return;
      }
      if (next.name === 'missing' || next.name === 'error') {
        opening = false;
        startTimer = null;
        setState(next.name, next.detail);
        return;
      }
    } catch (error) {
      opening = false;
      setState('error', cleanError(error));
      return;
    }
    watchStart();
  }, 1400);
}

async function startDesktop() {
  if (busy) return;
  busy = true;
  opening = true;
  setState('starting', '', settings.incognito ? 'Starting an incognito session in RAM.' : '');
  startDeadline = Date.now() + 60000;
  try {
    await command('start');
  } catch (error) {
    opening = false;
    busy = false;
    setState('error', cleanError(error));
    return;
  }
  busy = false;
  loadDashboard();
  watchStart();
}

function showDesktop() {
  if (state.name !== 'running') return;
  screen.hidden = false;
  menu.hidden = true;
  logs.hidden = true;
  const frame = $('desktop');
  if (!frame.getAttribute('src')) {
    frame.src = 'http://127.0.0.1:6080/vnc_tv.html?autoconnect=true&resize=scale&show_dot=true';
  }
  $('controls').focus();
  screenMisses = 0;
  loadStats();
  updateModeUI();
  clearInterval(screenTimer);
  screenTimer = setInterval(async () => {
    if (screen.hidden) return;
    try {
      const next = stateFromOutput(await command('status'));
      if (next.name === 'running') {
        screenMisses = 0;
        return;
      }
      screenMisses += 1;
      if (screenMisses >= 2) {
        hideScreen();
        setState('stopped', 'The desktop session ended. Start it again when you are ready.');
        loadDashboard();
      }
    } catch (_) {
      screenMisses += 1;
    }
  }, 12000);
}

function hideScreen() {
  screen.hidden = true;
  menu.hidden = false;
  $('desktop').removeAttribute('src');
  clearInterval(screenTimer);
  screenTimer = null;
  updateModeUI();
  loadDashboard();
  if (state.name === 'running') setState('running');
}

async function stopDesktop() {
  closeStopConfirm();
  if (busy) return false;
  busy = true;
  opening = false;
  stopStartPoll();
  setState('stopping');
  try {
    await command('stop');
    if (stats) stats.mode = 'persistent';
    hideScreen();
    setState('stopped');
    loadDashboard();
    return true;
  } catch (error) {
    setState('error', cleanError(error));
    return false;
  } finally {
    busy = false;
  }
}

async function loadLogs() {
  log.textContent = 'Loading…';
  try {
    log.textContent = await command('logs') || 'The session log is empty.';
  } catch (error) {
    log.textContent = cleanError(error);
  }
}

async function openExternal(url) {
  if (PREVIEW) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  try {
    await bridgeCall('luna://com.webos.applicationManager/launch', {
      id: 'com.webos.app.browser',
      params: { target: url },
    }, 8000);
  } catch (_) {}
}

function focusables(view) {
  const items = Array.from(view.querySelectorAll('[data-focusable]'));
  if (view === menu) {
    const trigger = $('settings-open');
    if (trigger && !trigger.hidden && !trigger.disabled) items.push(trigger);
  }
  return items.filter((element) => (
    !element.hidden && !element.disabled && element.getClientRects().length > 0
  ));
}

function moveFocus(direction) {
  const scope = !settingsPanel.hidden ? settingsPanel
    : !confirmBox.hidden ? confirmBox
      : !logs.hidden ? logs
        : !screen.hidden ? screen : menu;
  const items = focusables(scope);
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  const next = (index + direction + items.length) % items.length;
  items[next].focus();
}

async function openLogs() {
  if (!logs.hidden) return;
  logs.hidden = false;
  menu.hidden = true;
  $('close-log').focus();
  await loadLogs();
}

function closeLogs() {
  logs.hidden = true;
  menu.hidden = false;
  probe();
  loadDashboard();
  const target = focusables(menu)[0];
  if (target) target.focus();
}

function openStopConfirm(reason = 'stop') {
  if (!confirmBox.hidden || !settingsPanel.hidden) return;
  pendingConfirm = reason;
  const fresh = reason === 'fresh';
  const incognito = Boolean(stats && stats.mode === 'incognito' && ['running', 'starting'].includes(state.name));
  confirmTitle.textContent = fresh ? 'Start fresh?' : 'Stop the desktop?';
  confirmCopy.textContent = fresh
    ? 'The running desktop will close, then a clean session will start. Open applications will lose unsaved work.'
    : 'Open applications will close. Save your work before continuing.';
  const extra = [];
  if (fresh) extra.push('A clean session starts after the current one closes.');
  if (incognito) extra.push('This session is in RAM. Stopping it erases its files and changes.');
  confirmExtra.textContent = extra.join(' ');
  confirmExtra.hidden = !extra.length;
  confirmStop.textContent = fresh ? 'Start fresh' : 'Stop desktop';
  confirmStop.className = fresh ? 'btn btn-primary' : 'btn btn-danger';
  cancelStop.className = fresh ? 'btn btn-secondary' : 'btn btn-primary';
  lastFocus = document.activeElement;
  confirmBox.hidden = false;
  appShell.inert = true;
  cancelStop.focus();
}

function closeStopConfirm() {
  if (confirmBox.hidden) return;
  confirmBox.hidden = true;
  appShell.inert = false;
  pendingConfirm = 'stop';
  const target = lastFocus && menu.contains(lastFocus) ? lastFocus : secondary;
  if (target && !target.hidden && !target.disabled) target.focus();
}

async function confirmStopAction() {
  const reason = pendingConfirm;
  closeStopConfirm();
  if (reason === 'fresh') {
    const stopped = await stopDesktop();
    if (stopped && state.name === 'stopped') startDesktop();
    return;
  }
  stopDesktop();
}

function openSettings() {
  if (!settingsPanel.hidden) return;
  lastSettingsFocus = document.activeElement;
  appShell.inert = true;
  if (!screen.hidden) screen.inert = true;
  if (!logs.hidden) logs.inert = true;
  settingsOpen.setAttribute('aria-expanded', 'true');
  screenSettings.setAttribute('aria-expanded', 'true');
  settingsPanel.hidden = false;
  settingsScrim.hidden = false;
  if (!stats) loadStats();
  if (!inputs) loadInputs();
  updateIncognitoHint();
  updateFreshUI();
  const first = settingsPanel.querySelector('[data-setting]') || focusables(settingsPanel)[0];
  if (first) first.focus();
}

function closeSettings() {
  if (settingsPanel.hidden) return;
  settingsPanel.hidden = true;
  settingsScrim.hidden = true;
  appShell.inert = false;
  screen.inert = false;
  logs.inert = false;
  settingsOpen.setAttribute('aria-expanded', 'false');
  screenSettings.setAttribute('aria-expanded', 'false');
  const target = lastSettingsFocus && !lastSettingsFocus.hidden
    && !lastSettingsFocus.disabled
    && lastSettingsFocus.getClientRects().length > 0
    ? lastSettingsFocus
    : (!screen.hidden ? screenSettings : settingsOpen);
  if (target) target.focus();
  loadDashboard();
}

function toggleSetting(button) {
  const key = button.dataset.setting;
  if (!(key in DEFAULT_SETTINGS)) return;
  settings[key] = !settings[key];
  saveSettings();
  applySettings();
  render();
}

function applySettings() {
  document.body.classList.toggle('stats-hidden', !settings.stats);
  for (const button of document.querySelectorAll('[data-setting]')) {
    const key = button.dataset.setting;
    button.setAttribute('aria-checked', String(Boolean(settings[key])));
  }
  updateModeUI();
  updateFreshUI();
}

function back() {
  if (!settingsPanel.hidden) { closeSettings(); return; }
  if (!confirmBox.hidden) { closeStopConfirm(); return; }
  if (!logs.hidden) { closeLogs(); return; }
  if (!screen.hidden) { hideScreen(); return; }
  if (!PREVIEW && window.webOS && window.webOS.platformBack) window.webOS.platformBack();
}

async function loadStats() {
  if (statsInFlight) return;
  statsInFlight = true;
  try {
    const raw = await command('stats');
    stats = JSON.parse(raw);
    applyStats(stats);
  } catch (_) {
    stats = null;
    applyStats(null);
  } finally {
    statsInFlight = false;
  }
}

async function loadInputs() {
  if (inputsInFlight) return;
  inputsInFlight = true;
  try {
    inputs = parseInputs(await command('inputs'));
    applyInputs(inputs);
  } catch (_) {
    inputs = null;
    applyInputs(null);
  } finally {
    inputsInFlight = false;
  }
}

function loadDashboard() {
  loadStats();
  loadInputs();
}

function menuFocused() {
  return !menu.hidden && screen.hidden && logs.hidden && confirmBox.hidden && settingsPanel.hidden;
}

primary.addEventListener('click', () => {
  const action = primary.dataset.action;
  if (action === 'start') startDesktop();
  else if (action === 'open') showDesktop();
  else if (action === 'fresh') openStopConfirm('fresh');
  else if (action === 'setup') openExternal(SETUP_URL);
  else if (action === 'logs') openLogs();
});

secondary.addEventListener('click', () => {
  const action = secondary.dataset.action;
  if (action === 'logs') openLogs();
  else if (action === 'stop') openStopConfirm('stop');
  else if (action === 'check') probe();
  else if (action === 'retry') startDesktop();
});

logLink.addEventListener('click', openLogs);
$('controls').onclick = () => { hideScreen(); probe(); };
$('close-log').onclick = closeLogs;
$('refresh-log').onclick = loadLogs;
cancelStop.onclick = closeStopConfirm;
confirmStop.onclick = confirmStopAction;
$('devices-refresh').onclick = loadDashboard;
settingsOpen.addEventListener('click', openSettings);
screenSettings.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsScrim.addEventListener('click', closeSettings);
$('about-source').addEventListener('click', () => openExternal(GITHUB_SOURCE));
for (const button of document.querySelectorAll('[data-setting]')) {
  button.addEventListener('click', () => toggleSetting(button));
}

document.addEventListener('keydown', (event) => {
  if (event.keyCode === 461 || event.key === 'Escape') {
    event.preventDefault();
    back();
    return;
  }
  if (event.key === 'Tab' && (!settingsPanel.hidden || !confirmBox.hidden)) {
    const scope = !settingsPanel.hidden ? settingsPanel : confirmBox;
    const items = focusables(scope);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    const next = (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
    items[next].focus();
    event.preventDefault();
    return;
  }
  const arrowByKeyCode = { 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown' };
  const arrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    ? event.key
    : arrowByKeyCode[event.keyCode];
  if (!arrow) return;
  if (event.target && event.target.closest && event.target.closest('pre')) return;
  if (document.activeElement && document.activeElement.tagName === 'IFRAME') return;
  event.preventDefault();
  moveFocus(['ArrowLeft', 'ArrowUp'].includes(arrow) ? -1 : 1);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (menuFocused()) {
    loadDashboard();
    if (!opening) probe();
  } else if (!screen.hidden) {
    loadStats();
  }
});

applySettings();
$('about-launcher').textContent = `Launcher ${APP_VERSION}`;

if (PREVIEW) {
  if (state.name === 'error') state.detail = 'The display server exited before it was ready.';
  setState(state.name, state.detail);
  loadDashboard();
  if (PREVIEW_SETTINGS) openSettings();
} else {
  setState('checking');
  probe();
  loadDashboard();
}

setInterval(() => {
  if (document.hidden || !menuFocused()) return;
  loadDashboard();
}, STATS_MS);

if (!PREVIEW) {
  setInterval(() => {
    if (document.hidden || opening || busy) return;
    if (!menuFocused()) return;
    probe();
  }, 8000);
}
