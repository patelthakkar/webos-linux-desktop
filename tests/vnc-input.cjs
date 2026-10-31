// TV ONLY: run with ./tv.sh 'node -' < linux-desktop/tests/vnc-input.cjs
// Requires a focused terminal inside the virtual desktop. Never injects TV keys.
const net = require('net');
const socket = net.connect(5907, '127.0.0.1');
let buffer = Buffer.alloc(0);
let state = 'version';
socket.setTimeout(5000, () => { console.error('VNC input timeout'); socket.destroy(); process.exitCode = 1; });
socket.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
socket.on('data', (data) => {
  buffer = Buffer.concat([buffer, data]);
  while (true) {
    if (state === 'version') {
      if (buffer.length < 12) return;
      if (!buffer.subarray(0, 12).toString().startsWith('RFB 003.')) throw new Error('Not a VNC server');
      buffer = buffer.subarray(12);
      socket.write('RFB 003.008\n');
      state = 'security';
    } else if (state === 'security') {
      if (!buffer.length || buffer.length < 1 + buffer[0]) return;
      const count = buffer[0];
      if (!buffer.subarray(1, 1 + count).includes(1)) throw new Error('Expected loopback-only None security');
      buffer = buffer.subarray(1 + count);
      socket.write(Buffer.from([1]));
      state = 'authentication';
    } else if (state === 'authentication') {
      if (buffer.length < 4) return;
      if (buffer.readUInt32BE(0) !== 0) throw new Error('VNC authentication failed');
      buffer = buffer.subarray(4);
      socket.write(Buffer.from([1])); // shared: do not disconnect the TV viewer
      state = 'initialization';
    } else if (state === 'initialization') {
      if (buffer.length < 24 || buffer.length < 24 + buffer.readUInt32BE(20)) return;
      if (process.argv[2] === '--click') {
        const x = Number(process.argv[3]);
        const y = Number(process.argv[4]);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= buffer.readUInt16BE(0) || y >= buffer.readUInt16BE(2)) throw new Error('Pointer outside virtual desktop');
        const packets = [0, 1, 0].map((buttons) => {
          const packet = Buffer.alloc(6);
          packet[0] = 5;
          packet[1] = buttons;
          packet.writeUInt16BE(x, 2);
          packet.writeUInt16BE(y, 4);
          return packet;
        });
        socket.write(Buffer.concat(packets), () => socket.end());
        state = 'done';
        return;
      }
      let text = 'printf input-ok > /home/desk/.desktop-input-check';
      let pressEnter = true;
      let replace = false;
      if (process.argv[2] === '--demo') {
        text = "printf '\\nNative Linux on your LG TV\\n\\n'; uname -m; cat /etc/alpine-release; id; pwd";
      } else if (process.argv[2] === '--text') {
        text = process.argv[3] || '';
        pressEnter = process.argv[4] === '--enter';
      } else if (process.argv[2] === '--replace-text') {
        text = process.argv[3] || '';
        pressEnter = process.argv[4] === '--enter';
        replace = true;
      }
      const keys = [];
      if (replace) {
        keys.push([0xffe3, 1], [0x61, 1], [0x61, 0], [0xffe3, 0], [0xff08, 1], [0xff08, 0]);
      }
      for (const char of text) keys.push([char.charCodeAt(0), 1], [char.charCodeAt(0), 0]);
      if (pressEnter) keys.push([0xff0d, 1], [0xff0d, 0]);
      const packets = [];
      for (const [key, down] of keys) {
        const packet = Buffer.alloc(8);
        packet[0] = 4;
        packet[1] = down;
        packet.writeUInt32BE(key, 4);
        packets.push(packet);
      }
      socket.write(Buffer.concat(packets), () => {
        console.log('Sent VNC input to the virtual desktop');
        socket.end();
      });
      state = 'done';
      return;
    } else return;
  }
});
