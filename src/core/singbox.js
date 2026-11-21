const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateSingboxConfig } = require('./config-generator');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const MAX_RECONNECT_ATTEMPTS = 5;
const STARTUP_GRACE_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class SingboxManager {
  constructor(options = {}) {
    this.binDir = options.binDir || path.resolve(__dirname, '../../bin');
    this.singboxPath = path.join(this.binDir, 'sing-box.exe');
    this.configPath = path.resolve(__dirname, '../../data/runtime_config.json');

    this.process = null;
    this.status = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'error'
    this.activeServer = null;
    this.connectionStartTime = null;
    this.lastError = null;

    // Anti-disconnect watchdog
    this.watchdogInterval = null;
    this.watchdogFailCount = 0;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.currentOptions = null;
  }

  getSingboxExecutable() {
    if (fs.existsSync(this.singboxPath)) {
      return this.singboxPath;
    }
    // Fallback to PATH
    return 'sing-box.exe';
  }

  get mixedPort() {
    return (this.currentOptions && this.currentOptions.mixedPort) || 20807;
  }

  get autoReconnectEnabled() {
    return !this.currentOptions || this.currentOptions.autoReconnect !== false;
  }

  async start(server, options = {}) {
    if (this.process) {
      await this.stop();
    }

    this.activeServer = server;
    this.currentOptions = options;
    this.status = 'connecting';
    this.lastError = null;

    try {
      const configObj = await generateSingboxConfig(server, options);

      // Ensure directory exists
      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Write config without UTF-8 BOM
      fs.writeFileSync(this.configPath, JSON.stringify(configObj, null, 2), 'utf-8');

      const exe = this.getSingboxExecutable();
      console.log(`[SingBox] Launching ${exe} with config ${this.configPath}`);

      const proc = spawn(exe, ['run', '-c', this.configPath], {
        cwd: this.binDir,
        windowsHide: true
      });
      this.process = proc;

      let exited = false;
      let exitCode = null;

      // Without this listener a missing sing-box.exe throws an unhandled 'error'
      // event and takes the whole Node server down.
      proc.on('error', (err) => {
        exited = true;
        this.lastError = `sing-box ishga tushmadi: ${err.message}`;
        console.error(`[SingBox] ${this.lastError}`);
      });

      proc.stdout.on('data', (data) => {
        console.log(`[SingBox stdout]: ${data.toString()}`);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        console.warn(`[SingBox stderr]: ${text}`);
        const lower = text.toLowerCase();
        if (lower.includes('fatal') || lower.includes('error')) {
          this.lastError = text.trim();
        }
      });

      proc.on('close', (code) => {
        console.log(`[SingBox] Process exited with code ${code}`);
        exited = true;
        exitCode = code;

        // An old process closing must never clobber a newer one (auto-reconnect race).
        if (this.process !== proc) return;
        this.process = null;

        // While starting, start() itself reports the failure.
        if (this.status === 'connected' && !this.isReconnecting) {
          this.handleUnexpectedExit();
        }
      });

      // Give the core a moment: if it dies immediately (bad config, missing wintun.dll,
      // no admin rights, port in use) report the real error instead of a fake "connected".
      await sleep(STARTUP_GRACE_MS);
      if (exited) {
        if (this.process === proc) this.process = null;
        this.status = 'error';
        if (!this.lastError) {
          this.lastError = `sing-box exited with code ${exitCode}. TUN rejimi uchun Administrator huquqi kerak bo'lishi mumkin.`;
        }
        return { success: false, error: this.lastError };
      }

      // stop() may have been called while we were waiting
      if (this.process !== proc) {
        return { success: false, error: 'Connection cancelled' };
      }

      this.status = 'connected';
      this.connectionStartTime = Date.now();
      this.startWatchdog();

      // If System Proxy mode is selected, set Windows system proxy
      if (options.mode === 'system_proxy') {
        this.enableSystemProxy(this.mixedPort);
      }

      return { success: true };
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      return { success: false, error: err.message };
    }
  }

  async stop() {
    this.stopWatchdog();
    this.disableSystemProxy();

    const proc = this.process;
    this.process = null; // detach first so the 'close' handler ignores it
    if (proc) {
      try {
        proc.kill();
      } catch (err) {
        console.warn('Error killing sing-box process:', err.message);
      }
    }

    this.status = 'disconnected';
    this.activeServer = null;
    this.connectionStartTime = null;
    this.reconnectAttempts = 0;
    return { success: true };
  }

  startWatchdog() {
    this.stopWatchdog();
    this.watchdogFailCount = 0;

    // Check health every 6 seconds
    this.watchdogInterval = setInterval(async () => {
      if (this.status !== 'connected' || !this.process || this.isReconnecting) return;
      if (!this.autoReconnectEnabled) return;

      const isHealthy = await this.checkTunnelHealth();
      if (!isHealthy) {
        this.watchdogFailCount++;
        console.warn(`[Watchdog] Health check failed (${this.watchdogFailCount}/2)`);
        if (this.watchdogFailCount >= 2) {
          console.warn('[Watchdog] Tunnel stalled or disconnected. Triggering auto-reconnect...');
          this.watchdogFailCount = 0;
          this.autoReconnect();
        }
      } else {
        this.watchdogFailCount = 0;
      }
    }, 6000);
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * End-to-end tunnel check: an HTTP request that goes THROUGH sing-box's local
   * mixed inbound. This works in both TUN and System Proxy modes (a plain Node
   * request would bypass the proxy in System Proxy mode and prove nothing).
   */
  checkTunnelHealth() {
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: this.mixedPort,
        method: 'GET',
        path: 'http://cp.cloudflare.com/generate_204',
        headers: { Host: 'cp.cloudflare.com' },
        timeout: 4000
      }, (res) => {
        res.resume();
        resolve(res.statusCode === 204 || res.statusCode === 200);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
      req.end();
    });
  }

  async autoReconnect() {
    if (this.isReconnecting) return;
    const server = this.activeServer;
    const options = this.currentOptions;
    if (!server) return;

    this.isReconnecting = true;
    console.log('[Auto-Reconnect] Restarting sing-box core...');

    try {
      const old = this.process;
      this.process = null;
      if (old) {
        try { old.kill(); } catch { /* already dead */ }
      }
      await sleep(1000);

      // User pressed "disconnect" while we were waiting
      if (this.activeServer !== server) return;

      const result = await this.start(server, options);
      if (result.success) {
        this.reconnectAttempts = 0;
      } else {
        this.scheduleReconnectRetry();
      }
    } catch (err) {
      console.error('[Auto-Reconnect Error]:', err.message);
      this.scheduleReconnectRetry();
    } finally {
      this.isReconnecting = false;
    }
  }

  scheduleReconnectRetry() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('[Auto-Reconnect] Giving up after repeated failures.');
      this.status = 'error';
      return;
    }
    const delay = Math.min(2000 * this.reconnectAttempts, 10000);
    setTimeout(() => {
      if (this.activeServer && this.status === 'error') {
        this.autoReconnect();
      }
    }, delay);
  }

  handleUnexpectedExit() {
    console.warn('[SingBox] Unexpected exit detected.');
    this.status = 'error';
    if (!this.lastError) {
      this.lastError = 'Core process terminated unexpectedly (Check Admin rights or Antivirus).';
    }
    if (!this.autoReconnectEnabled) return;

    // Attempt auto-recovery
    setTimeout(() => {
      if (this.activeServer) {
        this.autoReconnect();
      }
    }, 2000);
  }

  // Synchronous + argument array: no shell quoting issues and no enable/disable race
  setRegistryValue(args) {
    try {
      execFileSync('reg', ['add', REG_KEY, ...args, '/f'], { stdio: 'ignore', windowsHide: true });
      return true;
    } catch (err) {
      console.error('[Proxy] Registry update failed:', err.message);
      return false;
    }
  }

  refreshWinInetProxy() {
    if (process.platform !== 'win32') return;
    const psScript = "Add-Type -MemberDefinition '[DllImport(\"wininet.dll\")] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);' -Name WinInet -Namespace Native; [Native.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0) | Out-Null; [Native.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0) | Out-Null";
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true }, () => {});
  }

  enableSystemProxy(port = 20807) {
    if (process.platform !== 'win32') return;
    const proxyServer = `127.0.0.1:${port}`;
    const proxyOverride = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>';
    const ok =
      this.setRegistryValue(['/v', 'ProxyServer', '/t', 'REG_SZ', '/d', proxyServer]) &&
      this.setRegistryValue(['/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', proxyOverride]) &&
      this.setRegistryValue(['/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1']);
    if (ok) {
      console.log(`[Proxy] System proxy enabled on ${proxyServer}`);
      this.refreshWinInetProxy();
    }
  }

  disableSystemProxy() {
    if (process.platform !== 'win32') return;
    if (this.setRegistryValue(['/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0'])) {
      console.log('[Proxy] System proxy disabled.');
      this.refreshWinInetProxy();
    }
  }

  getStatus() {
    let durationSeconds = 0;
    if (this.connectionStartTime && this.status === 'connected') {
      durationSeconds = Math.floor((Date.now() - this.connectionStartTime) / 1000);
    }

    return {
      status: this.status,
      activeServer: this.activeServer,
      duration: durationSeconds,
      error: this.lastError
    };
  }
}

module.exports = SingboxManager;
