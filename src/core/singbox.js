const { spawn, execFile, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { generateSingboxConfig } = require('./config-generator');
const { findFreePort } = require('./ping');

const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const MAX_RECONNECT_ATTEMPTS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isPortOpen(port, timeoutMs = 200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function waitForLocalPort(port, timeoutMs, isExitedFn) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isExitedFn()) return false;
    if (await isPortOpen(port, 150)) return true;
    await sleep(120);
  }
  return false;
}

function sanitizeRawReason(rawError) {
  if (!rawError) return '';
  const lines = String(rawError)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';
  return lastLine.length > 140 ? lastLine.slice(0, 140) + '...' : lastLine;
}

function formatFriendlyError(serverName, rawError) {
  const label = serverName || 'Server';
  const text = String(rawError || '');
  const lower = text.toLowerCase();

  if (lower.includes('reality verification failed')) {
    return `${label}: REALITY autentifikatsiyasi rad etildi (server ishlamayapti)`;
  }
  if (lower.includes('i/o timeout') || lower.includes('timed out') || lower.includes('timeout')) {
    return `${label}: server javob bermadi (timeout)`;
  }
  if (lower.includes('connection refused') || lower.includes('reset by peer') || lower.includes('econnreset')) {
    return `${label}: server ulanishni rad etdi`;
  }
  if (lower.includes('permission denied') || lower.includes('access is denied') || lower.includes('wintun')) {
    return 'TUN rejimi uchun Administrator huquqi kerak';
  }

  const sanitized = sanitizeRawReason(text);
  if (sanitized && sanitized !== 'aborted' && !sanitized.startsWith('http_')) {
    return `${label}: tunnel orqali internet o'tmadi (${sanitized})`;
  }
  return `${label}: tunnel orqali internet o'tmadi`;
}

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

    // Clash API throughput monitoring
    this.dlBps = 0;
    this.ulBps = 0;
    this.trafficReq = null;
    this.trafficRetryTimer = null;
    this.clashApiPort = null;

    // Anti-disconnect watchdog & failover callback
    this.watchdogInterval = null;
    this.watchdogFailCount = 0;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.currentOptions = null;
    this.manualDisconnect = false;
    this.onFailover = typeof options.onFailover === 'function' ? options.onFailover : null;
  }

  getSingboxExecutable() {
    if (fs.existsSync(this.singboxPath)) {
      return this.singboxPath;
    }
    return 'sing-box.exe';
  }

  get mixedPort() {
    return (this.currentOptions && this.currentOptions.mixedPort) || 20807;
  }

  get autoReconnectEnabled() {
    return !this.currentOptions || this.currentOptions.autoReconnect !== false;
  }

  async terminateProcess(proc) {
    if (!proc) return;
    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      proc.once('close', done);
      setTimeout(done, 700);
      try {
        proc.kill();
      } catch {
        done();
      }
    });
  }

  async start(server, options = {}) {
    if (this.process) {
      await this.stop();
    } else {
      this.stopTrafficMonitor();
      this.disableSystemProxy();
    }

    this.manualDisconnect = false;
    this.activeServer = server;
    this.currentOptions = options;
    this.status = 'connecting';
    this.lastError = null;
    this.dlBps = 0;
    this.ulBps = 0;

    let proc = null;

    try {
      const clashApiPort = await findFreePort(9091);
      const configObj = await generateSingboxConfig(server, {
        ...options,
        clashApiPort
      });

      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(configObj, null, 2), 'utf-8');

      const exe = this.getSingboxExecutable();
      console.log(`[SingBox] Launching ${exe} with config ${this.configPath}`);

      proc = spawn(exe, ['run', '-c', this.configPath], {
        cwd: this.binDir,
        windowsHide: true
      });
      this.process = proc;

      let exited = false;
      let exitCode = null;
      let rawStartError = '';

      proc.on('error', (err) => {
        exited = true;
        rawStartError = `sing-box ishga tushmadi: ${err.message}`;
        this.lastError = rawStartError;
        console.error(`[SingBox] ${rawStartError}`);
      });

      proc.stdout.on('data', (data) => {
        console.log(`[SingBox stdout]: ${data.toString()}`);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        console.warn(`[SingBox stderr]: ${text}`);
        const lower = text.toLowerCase();
        if (
          lower.includes('fatal') ||
          lower.includes('error') ||
          lower.includes('reality verification failed') ||
          lower.includes('i/o timeout') ||
          lower.includes('connection refused') ||
          lower.includes('reset by peer')
        ) {
          rawStartError = text.trim();
          this.lastError = rawStartError;
        }
      });

      proc.on('close', (code) => {
        console.log(`[SingBox] Process exited with code ${code}`);
        exited = true;
        exitCode = code;

        if (this.process !== proc) return;
        this.process = null;

        if (this.status === 'connected' && !this.isReconnecting) {
          this.handleUnexpectedExit();
        }
      });

      await waitForLocalPort(this.mixedPort, 2500, () => exited);
      await sleep(200);

      if (exited) {
        if (this.process === proc) this.process = null;
        this.disableSystemProxy();
        this.stopTrafficMonitor();
        this.status = 'error';
        this.activeServer = null;
        const raw = rawStartError || this.lastError || `sing-box exited with code ${exitCode}`;
        const errMsg = formatFriendlyError(server.name, raw);
        this.lastError = errMsg;
        return { success: false, error: errMsg };
      }

      if (this.process !== proc) {
        return { success: false, error: 'Ulanish bekor qilindi' };
      }

      let latencyMs = 0;
      if (options.verifyTunnel !== false) {
        let health = await this.checkTunnelHealth(4500);
        if (!health.ok && !exited && this.process === proc && health.reason === 'ECONNREFUSED') {
          await sleep(300);
          health = await this.checkTunnelHealth(4500);
        }

        if (!health.ok || exited || this.process !== proc) {
          const errMsg = formatFriendlyError(server.name, rawStartError || this.lastError || health.reason);
          if (this.process === proc) this.process = null;
          await this.terminateProcess(proc);
          this.stopTrafficMonitor();
          this.disableSystemProxy();
          this.status = 'disconnected';
          this.activeServer = null;
          this.connectionStartTime = null;
          this.lastError = errMsg;
          return { success: false, error: errMsg };
        }
        latencyMs = health.latencyMs;
      }

      this.status = 'connected';
      this.connectionStartTime = Date.now();
      this.lastError = null;
      this.clashApiPort = clashApiPort;

      if (options.mode === 'system_proxy') {
        this.enableSystemProxy(this.mixedPort);
      }

      this.startTrafficMonitor(clashApiPort);
      this.startWatchdog();

      return { success: true, latencyMs };
    } catch (err) {
      if (proc && this.process === proc) {
        this.process = null;
        await this.terminateProcess(proc);
      }
      this.stopTrafficMonitor();
      this.disableSystemProxy();
      this.status = 'error';
      this.activeServer = null;
      const errMsg = formatFriendlyError(server && server.name, err.message);
      this.lastError = errMsg;
      return { success: false, error: errMsg };
    }
  }

  async stop() {
    this.manualDisconnect = true;
    this.stopWatchdog();
    this.stopTrafficMonitor();
    this.disableSystemProxy();

    const proc = this.process;
    this.process = null; // detach first so the 'close' handler ignores it
    await this.terminateProcess(proc);

    this.status = 'disconnected';
    this.activeServer = null;
    this.connectionStartTime = null;
    this.reconnectAttempts = 0;
    this.clashApiPort = null;
    this.dlBps = 0;
    this.ulBps = 0;
    return { success: true };
  }

  startTrafficMonitor(port) {
    this.stopTrafficMonitor();
    if (!port) return;

    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/traffic',
        headers: { Connection: 'keep-alive' }
      },
      (res) => {
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (this.trafficReq !== req) return;
          buffer += chunk;
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const obj = JSON.parse(trimmed);
              if (typeof obj.up === 'number') this.ulBps = Math.max(0, obj.up);
              if (typeof obj.down === 'number') this.dlBps = Math.max(0, obj.down);
            } catch {
              // ignore non-JSON chunk
            }
          }
        });
        res.on('end', () => {
          if (this.trafficReq !== req) return;
          this.trafficReq = null;
          this.dlBps = 0;
          this.ulBps = 0;
          if (this.status === 'connected' && this.clashApiPort === port) {
            this.trafficRetryTimer = setTimeout(() => {
              this.trafficRetryTimer = null;
              if (this.status === 'connected' && this.clashApiPort === port && !this.trafficReq) {
                this.startTrafficMonitor(port);
              }
            }, 2000);
          }
        });
        res.on('error', () => {
          if (this.trafficReq !== req) return;
          this.dlBps = 0;
          this.ulBps = 0;
        });
      }
    );

    req.setTimeout(0);
    req.on('error', () => {
      if (this.trafficReq !== req) return;
      this.trafficReq = null;
      this.dlBps = 0;
      this.ulBps = 0;
    });
    this.trafficReq = req;
  }

  stopTrafficMonitor() {
    if (this.trafficRetryTimer) {
      clearTimeout(this.trafficRetryTimer);
      this.trafficRetryTimer = null;
    }
    const req = this.trafficReq;
    this.trafficReq = null;
    if (req) {
      try {
        req.destroy();
      } catch {}
    }
    this.dlBps = 0;
    this.ulBps = 0;
  }

  startWatchdog() {
    this.stopWatchdog();
    this.watchdogFailCount = 0;

    const timer = setInterval(async () => {
      if (this.watchdogInterval !== timer || this.status !== 'connected' || !this.process || this.isReconnecting || this.manualDisconnect) return;
      if (!this.autoReconnectEnabled) return;

      const health = await this.checkTunnelHealth(4000);
      if (this.watchdogInterval !== timer || this.status !== 'connected' || !this.process || this.isReconnecting || this.manualDisconnect) return;
      if (!health.ok) {
        this.watchdogFailCount++;
        console.warn(`[Watchdog] Health check failed (${this.watchdogFailCount}/2): ${health.reason || 'unknown'}`);
        if (this.watchdogFailCount >= 2) {
          console.warn('[Watchdog] Tunnel stalled or disconnected. Triggering auto-reconnect...');
          this.watchdogFailCount = 0;
          this.autoReconnect();
        }
      } else {
        this.watchdogFailCount = 0;
      }
    }, 6000);
    this.watchdogInterval = timer;
  }

  stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /**
   * End-to-end tunnel check: an HTTP request that goes THROUGH sing-box's local
   * mixed inbound.
   */
  checkTunnelHealth(timeoutMs = 4500) {
    return new Promise((resolve) => {
      const start = Date.now();
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.mixedPort,
          method: 'GET',
          path: 'http://cp.cloudflare.com/generate_204',
          headers: { Host: 'cp.cloudflare.com' },
          timeout: timeoutMs
        },
        (res) => {
          res.resume();
          if (res.statusCode === 204 || res.statusCode === 200) {
            done({ ok: true, latencyMs: Math.max(1, Date.now() - start) });
          } else {
            done({ ok: false, latencyMs: -1, reason: `http_${res.statusCode}` });
          }
        }
      );

      req.on('timeout', () => {
        req.destroy();
        done({ ok: false, latencyMs: -1, reason: 'timeout' });
      });

      req.on('error', (err) => {
        const code = err && (err.code || err.message) ? String(err.code || err.message) : 'error';
        done({ ok: false, latencyMs: -1, reason: code });
      });

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
      this.stopTrafficMonitor();
      this.disableSystemProxy();

      const old = this.process;
      this.process = null;
      await this.terminateProcess(old);
      await sleep(500);

      // User pressed "disconnect" while we were waiting
      if (this.manualDisconnect) return;

      const result = await this.start(server, { ...options, verifyTunnel: true });
      if (this.manualDisconnect) {
        await this.stop();
        return;
      }
      if (result.success) {
        this.reconnectAttempts = 0;
        return;
      }

      if (typeof this.onFailover === 'function') {
        const recovered = await this.onFailover(server, options);
        if (this.manualDisconnect) {
          await this.stop();
          return;
        }
        if (recovered) {
          this.reconnectAttempts = 0;
          return;
        }
      }

      this.disableSystemProxy();
      this.stopTrafficMonitor();
      this.activeServer = server;
      this.scheduleReconnectRetry();
    } catch (err) {
      console.error('[Auto-Reconnect Error]:', err.message);
      this.disableSystemProxy();
      this.stopTrafficMonitor();
      if (!this.manualDisconnect) {
        this.activeServer = server;
        this.scheduleReconnectRetry();
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  scheduleReconnectRetry() {
    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error('[Auto-Reconnect] Giving up after repeated failures.');
      this.disableSystemProxy();
      this.stopTrafficMonitor();
      this.status = 'error';
      this.activeServer = null;
      return;
    }
    const delay = Math.min(2000 * this.reconnectAttempts, 10000);
    setTimeout(() => {
      if (!this.manualDisconnect && this.activeServer && this.status !== 'disconnected') {
        this.autoReconnect();
      }
    }, delay);
  }

  handleUnexpectedExit() {
    console.warn('[SingBox] Unexpected exit detected.');
    this.stopTrafficMonitor();
    this.disableSystemProxy();
    this.status = 'error';
    if (!this.lastError) {
      this.lastError = 'Core process terminated unexpectedly (Check Admin rights or Antivirus).';
    }
    if (!this.autoReconnectEnabled || this.manualDisconnect) return;

    setTimeout(() => {
      if (!this.manualDisconnect && this.activeServer && this.status === 'error') {
        this.autoReconnect();
      }
    }, 2000);
  }

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
    const isConnected = this.status === 'connected';
    let durationSeconds = 0;
    if (this.connectionStartTime && isConnected) {
      durationSeconds = Math.floor((Date.now() - this.connectionStartTime) / 1000);
    }

    const dlBps = isConnected ? this.dlBps : 0;
    const ulBps = isConnected ? this.ulBps : 0;

    return {
      status: this.status,
      activeServer: this.activeServer,
      duration: durationSeconds,
      dlBps,
      ulBps,
      dlMBps: Number((dlBps / (1024 * 1024)).toFixed(2)),
      ulMBps: Number((ulBps / (1024 * 1024)).toFixed(2)),
      error: this.lastError
    };
  }
}

module.exports = SingboxManager;
