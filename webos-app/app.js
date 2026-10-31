'use strict';

const BASE = '/var/lib/webosbrew/linux-desktop';
const SETUP_URL = 'https://github.com/patelthakkar/webos-linux-desktop#install';
const PROBE = `base=${BASE}; if [ -x "$base/control.sh" ]; then "$base/control.sh" status; else echo missing; fi`;
const PREVIEW = new URLSearchParams(location.search).get('preview');

const $ = (id) => document.getElementById(id);
const appShell = document.querySelector('.app');
const menu = $('menu');
const screen = $('screen');
const logs = $('logs');
const confirmBox = $('confirm');
const log = $('log');
const primary = $('primary');
const secondary = $('secondary');
const logLink = $('log-link');
const rail = $('rail');
const stateText = $('state-text');
const headline = $('headline');
const lede = $('lede');
const hint = $('hint');

let state = { name: PREVIEW || 'checking', detail: '', hint: '' };
let previewState = PREVIEW;
let busy = false;
let opening = false;
let startDeadline = 0;
let startTimer = null;
let screenTimer = null;
let screenMisses = 0;
let lastFocus = null;

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
    hint: 'USB keyboard and mouse recommended. Files persist between sessions.',
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
    hint: 'Closing this app leaves the session running. Use Stop desktop to free memory.',
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

async function command(action) {
  if (PREVIEW) {
    if (action === 'status') return previewState || 'missing';
    if (action === 'logs') return previewLog();
    if (action === 'start') {
      previewState = 'starting';
      setTimeout(() => {
        previewState = 'running';
        if (PREVIEW) probe();
      }, 1400);
      return 'starting';
    }
    if (action === 'stop') {
      previewState = 'stopped';
      return 'stopped';
    }
  }
  const commands = {
    status: PROBE,
    start: `${BASE}/control.sh start`,
    stop: `${BASE}/control.sh stop`,
    logs: `${BASE}/control.sh logs`,
  };
  return bridgeCall('luna://org.webosbrew.hbchannel.service/exec', { command: commands[action] });
}

function stateFromOutput(output) {
  const line = String(output).trim().split('\n').filter(Boolean).pop() || '';
  if (['running', 'starting', 'stopped', 'missing'].includes(line)) return { name: line };
  return { name: 'error', detail: line || 'No status returned.' };
}

function render() {
  const current = config[state.name] || config.error;
  document.body.dataset.state = state.name;
  stateText.textContent = current.line;
  headline.textContent = current.headline;
  lede.textContent = state.detail || current.lede;
  hint.textContent = state.hint || current.hint;

  const action = current.primary || {};
  primary.textContent = action.label || 'Please wait';
  primary.disabled = Boolean(action.disabled);
  primary.hidden = false;
  primary.dataset.action = action.action || '';
  primary.className = 'btn btn-primary';

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

  if (!screen.hidden || !logs.hidden || !confirmBox.hidden) return;
  const active = document.activeElement;
  if (!menu.contains(active) || active.disabled || active.hidden) {
    const target = primary.hidden || primary.disabled ? secondary : primary;
    if (target && !target.hidden && !target.disabled) target.focus();
  }
}

function setState(name, detail = '', hint = '') {
  state = { name, detail, hint };
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
  startDeadline = Date.now() + 60000;
  setState('starting');
  try {
    await command('start');
  } catch (error) {
    opening = false;
    busy = false;
    setState('error', cleanError(error));
    return;
  }
  busy = false;
  watchStart();
}

async function stopDesktop() {
  closeStopConfirm();
  if (busy) return;
  busy = true;
  opening = false;
  stopStartPoll();
  setState('stopping');
  try {
    await command('stop');
    hideScreen();
    setState('stopped');
  } catch (error) {
    setState('error', cleanError(error));
  } finally {
    busy = false;
  }
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
  if (state.name === 'running') setState('running');
}

async function loadLogs() {
  log.textContent = 'Loading…';
  try {
    log.textContent = await command('logs') || 'The session log is empty.';
  } catch (error) {
    log.textContent = cleanError(error);
  }
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
  const target = focusables(menu)[0];
  if (target) target.focus();
}

function openStopConfirm() {
  if (!confirmBox.hidden) return;
  lastFocus = document.activeElement;
  confirmBox.hidden = false;
  appShell.inert = true;
  $('cancel-stop').focus();
}

function closeStopConfirm() {
  if (confirmBox.hidden) return;
  confirmBox.hidden = true;
  appShell.inert = false;
  const target = lastFocus && menu.contains(lastFocus) ? lastFocus : secondary;
  if (target && !target.hidden && !target.disabled) target.focus();
}

async function openSetupGuide() {
  if (PREVIEW) {
    window.open(SETUP_URL, '_blank', 'noopener');
    return;
  }
  try {
    await bridgeCall('luna://com.webos.applicationManager/launch', {
      id: 'com.webos.app.browser',
      params: { target: SETUP_URL },
    }, 8000);
  } catch (_) {
    state.hint = `Open this on a computer: ${SETUP_URL}`;
    render();
  }
}

function focusables(view) {
  return Array.from(view.querySelectorAll('[data-focusable]')).filter((element) => (
    !element.hidden && !element.disabled && element.getClientRects().length > 0
  ));
}

function moveFocus(direction) {
  const scope = !confirmBox.hidden ? confirmBox : !logs.hidden ? logs : !screen.hidden ? screen : menu;
  const items = focusables(scope);
  if (!items.length) return;
  const index = items.indexOf(document.activeElement);
  const next = (index + direction + items.length) % items.length;
  items[next].focus();
}

function back() {
  if (!confirmBox.hidden) { closeStopConfirm(); return; }
  if (!logs.hidden) { closeLogs(); return; }
  if (!screen.hidden) { hideScreen(); return; }
  if (!PREVIEW && window.webOS && window.webOS.platformBack) {
    window.webOS.platformBack();
  }
}

primary.addEventListener('click', () => {
  const action = primary.dataset.action;
  if (action === 'start') startDesktop();
  else if (action === 'open') showDesktop();
  else if (action === 'setup') openSetupGuide();
  else if (action === 'logs') openLogs();
});

secondary.addEventListener('click', () => {
  const action = secondary.dataset.action;
  if (action === 'logs') openLogs();
  else if (action === 'stop') openStopConfirm();
  else if (action === 'check') probe();
  else if (action === 'retry') startDesktop();
});

logLink.addEventListener('click', openLogs);
$('controls').onclick = () => { hideScreen(); probe(); };
$('close-log').onclick = closeLogs;
$('refresh-log').onclick = loadLogs;
$('cancel-stop').onclick = closeStopConfirm;
$('confirm-stop').onclick = stopDesktop;

document.addEventListener('keydown', (event) => {
  if (event.keyCode === 461 || event.key === 'Escape') {
    event.preventDefault();
    back();
    return;
  }
  if (event.key === 'Tab' && !confirmBox.hidden) {
    const items = focusables(confirmBox);
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
  if (!document.hidden && (screen.hidden && logs.hidden && confirmBox.hidden) && !opening) probe();
});

if (PREVIEW) {
  if (state.name === 'error') state.detail = 'The display server exited before it was ready.';
  setState(state.name, state.detail);
} else {
  setState('checking');
  probe();
}

if (!PREVIEW) {
  setInterval(() => {
    if (document.hidden || opening || busy) return;
    if (!confirmBox.hidden || !logs.hidden) return;
    if (!screen.hidden) return;
    probe();
  }, 8000);
}
