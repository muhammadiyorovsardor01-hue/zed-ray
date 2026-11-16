const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const serverScript = path.join(__dirname, 'src/server.js');
console.log('[ZedVPN] Starting backend daemon...');

// Start the server
const serverProcess = spawn('node', [serverScript], {
  stdio: 'inherit',
  windowsHide: false
});

// Wait 1 second for the server to bind, then open App window
setTimeout(() => {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const url = 'http://127.0.0.1:4040';

  if (fs.existsSync(edgePath)) {
    console.log('[ZedVPN] Opening Desktop Application Window...');
    spawn(edgePath, [
      `--app=${url}`,
      '--window-size=450,840',
      '--app-id=zed-vpn-desktop'
    ], { detached: true, stdio: 'ignore' });
  } else {
    exec(`start ${url}`);
  }
}, 1200);

process.on('SIGINT', () => {
  serverProcess.kill();
  process.exit();
});
