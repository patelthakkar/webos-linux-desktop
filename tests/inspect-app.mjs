// Requires an SSH forward: 127.0.0.1:19998 -> TV 127.0.0.1:9998.
// Only connects to this project's TV app, never other TV/browser pages.
import { writeFileSync } from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:19998/json/list')).json();
const target = targets.find((page) => /\/applications\/io\.github\.patelthakkar\.linuxdesktop\/index\.html$/.test(page.url));
if (!target) throw new Error('Linux Desktop app is not open');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const timeout = setTimeout(() => { ws.close(); console.error('Inspector timed out'); process.exitCode = 1; }, 20000);
const capture = process.argv[2] === '--capture';
ws.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id !== 1) return;
  clearTimeout(timeout);
  if (message.error) { console.error(message.error); process.exitCode = 1; }
  else if (capture) {
    if (!message.result?.data) throw new Error('TV inspector does not support screenshot capture');
    const path = process.argv[3];
    if (!path) throw new Error('Specify a screenshot output path');
    writeFileSync(path, Buffer.from(message.result.data, 'base64'));
    console.log(path);
  } else console.log(JSON.stringify(message.result, null, 2));
  ws.close();
};
ws.send(JSON.stringify(capture ? { id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } } : {
  id: 1, method: 'Runtime.evaluate', params: {
    expression: process.argv[2] || 'JSON.stringify({status:document.getElementById("status").textContent,screen:!document.getElementById("screen").hidden})',
    returnByValue: true,
    awaitPromise: true,
  },
}));
