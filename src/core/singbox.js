const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { generateSingboxConfig } = require('./config-generator');

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
    this.currentOptions = null;
  }

  getSingboxExecutable() {
    if (fs.existsSync(this.singboxPath)) {
      return this.singboxPath;
    }
    // Fallback to PATH
    return 'sing-box.exe';
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

      // Spawn sing-box
      this.process = spawn(exe, ['run', '-c', this.configPath], {
        cwd: this.binDir,
        windowsHide: true
      });

      this.process.stdout.on('data', (data) => {
        const text = data.toString();
        console.log(`[SingBox stdout]: ${text}`);
      });

      this.process.stderr.on('data', (data) => {
        const text = data.toString();
        console.warn(`[SingBox stderr]: ${text}`);
        if (text.toLowerCase().includes('fatal') || text.toLowerCase().includes('error')) {
          this.lastError = text;
        }
      });

      this.process.on('close', (code) => {
        console.log(`[SingBox] Process exited with code ${code}`);
        this.process = null;
        if (this.status === 'connected' || this.status === 'connecting') {
          if (!this.isReconnecting) {
            this.handleUnexpectedExit();
          }
        }
      });

      this.status = 'connected';
      this.connectionStartTime = Date.now();
      this.startWatchdog();

      // If System Proxy mode is selected, set Windows system proxy
      if (options.mode === 'system_proxy') {
        this.enableSystemProxy(options.mixedPort || 20807);
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

    if (this.process) {
      try {
        this.process.kill();
      } catch (err) {
        console.warn('Error killing sing-box process:', err.message);
      }
      this.process = null;
    }

    this.status = 'disconnected';
    this.activeServer = null;
    this.connectionStartTime = null;
    return { success: true };
  }

  startWatchdog() {
    this.stopWatchdog();
    this.watchdogFailCount = 0;

    // Check health every 6 seconds
    this.watchdogInterval = setInterval(async () => {
      if (this.status !== 'connected' || !this.process) return;

      const isHealthy = await this.checkTunnelHealth();
      if (!isHealthy) {
        this.watchdogFailCount++;
        console.warn(`[Watchdog] Health check failed (${this.watchdogFailCount}/2)`);
        if (this.watchdogFailCount >= 2) {
          console.warn('[Watchdog] Tunnel stalled or disconnected. Triggering auto-reconnect...');
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

  checkTunnelHealth() {
    return new Promise((resolve) => {
      const req = https.get('https://cp.cloudflare.com/generate_204', { timeout: 3500 }, (res) => {
        resolve(res.statusCode === 204 || res.statusCode === 200);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => {
        resolve(false);
      });
    });
  }

  async autoReconnect() {
    if (this.isReconnecting) return;
    this.isReconnecting = true;
    console.log('[Auto-Reconnect] Restarting sing-box core...');

    try {
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      await new Promise(r => setTimeout(r, 1000));
      if (this.activeServer) {
        await this.start(this.activeServer, this.currentOptions);
      }
    } catch (err) {
      console.error('[Auto-Reconnect Error]:', err.message);
    } finally {
      this.isReconnecting = false;
    }
  }

  handleUnexpectedExit() {
    console.warn('[SingBox] Unexpected exit detected.');
    this.status = 'error';
    if (!this.lastError) {
      this.lastError = 'Core process terminated unexpectedly (Check Admin rights or Antivirus).';
    }
    // Attempt auto-recovery
    setTimeout(() => {
      if (this.activeServer) {
        this.autoReconnect();
      }
    }, 2000);
  }

  enableSystemProxy(port = 20807) {
    const proxyServer = `127.0.0.1:${port}`;
    const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f && reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyServer}" /f`;
    exec(cmd, (err) => {
      if (err) console.error('[Proxy] Failed to enable system proxy:', err.message);
      else console.log(`[Proxy] System proxy enabled on ${proxyServer}`);
    });
  }

  disableSystemProxy() {
    const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`;
    exec(cmd, (err) => {
      if (err) console.error('[Proxy] Failed to disable system proxy:', err.message);
      else console.log('[Proxy] System proxy disabled.');
    });
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
