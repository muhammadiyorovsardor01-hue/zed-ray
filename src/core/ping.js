const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { buildProxyOutbound } = require('./config-generator');
const { detectPhysicalIpv4, generateXrayPingConfig } = require('./xray-config');

/**
 * Measures TCP handshake latency to server:port in milliseconds.
 */
function testTcpLatency(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    let resolved = false;

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      if (!resolved) {
        resolved = true;
        const latency = Date.now() - start;
        socket.destroy();
        resolve(latency);
      }
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(-1);
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(-1);
      }
    });
  });
}

async function testServersTcpFallback(servers) {
  return Promise.all(
    servers.map(async (srv) => {
      if (!srv || !srv.server || !srv.server_port) {
        return { id: srv && srv.id, ping: -1 };
      }
      const ping = await testTcpLatency(srv.server, srv.server_port);
      return { id: srv.id, ping };
    })
  );
}

function findFreePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const tryListen = (port, allowFallback) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', (err) => {
        if (allowFallback && port !== 0) {
          tryListen(0, false);
        } else {
          reject(err);
        }
      });
      srv.listen(port, '127.0.0.1', () => {
        const addr = srv.address();
        const chosen = addr && typeof addr === 'object' ? addr.port : port;
        srv.close(() => resolve(chosen));
      });
    };
    tryListen(preferredPort, true);
  });
}

function isLocalPortOpen(port, timeoutMs = 150) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, '127.0.0.1');
  });
}

async function waitForPortReady(port, timeoutMs, isExitedFn) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isExitedFn()) return false;
    if (await isLocalPortOpen(port, 120)) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}

function httpGetJson(port, reqPath, timeoutMs = 5500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path: reqPath,
        timeout: timeoutMs
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let data = {};
          try {
            data = body ? JSON.parse(body) : {};
          } catch {
            data = {};
          }
          resolve({ statusCode: res.statusCode || 0, data });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, data: {} });
    });
    req.on('error', () => resolve({ statusCode: 0, data: {} }));
  });
}

function httpProxyDelayCheck(proxyPort, timeoutMs = 4500) {
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const done = (ms) => {
      if (settled) return;
      settled = true;
      resolve(ms);
    };

    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: 'http://cp.cloudflare.com/generate_204',
        headers: { Host: 'cp.cloudflare.com' },
        timeout: timeoutMs
      },
      (res) => {
        res.resume();
        if (res.statusCode === 204 || res.statusCode === 200) {
          done(Math.max(1, Date.now() - start));
        } else {
          done(-1);
        }
      }
    );

    req.on('timeout', () => {
      req.destroy();
      done(-1);
    });
    req.on('error', () => done(-1));
    req.end();
  });
}

async function waitForClashApi(apiPort, timeoutMs, isExitedFn) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isExitedFn()) return false;
    const res = await httpGetJson(apiPort, '/version', 400);
    if (res.statusCode === 200) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Tests end-to-end tunnel delay through Xray-core v26.11.9 (supporting
 * X25519MLKEM768 REALITY as well as WS+TLS). Returns null if xray.exe
 * is unavailable or fails to start.
 */
async function testServersXrayDelay(servers, options = {}) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return [];
  }

  const xrayExe = options.xrayPath || path.resolve(__dirname, '../../bin/xray.exe');
  if (!fs.existsSync(xrayExe)) {
    return null;
  }

  const validRaw = servers.filter((srv) => srv && srv.server && srv.server_port && srv.uuid);
  if (validRaw.length === 0) {
    return servers.map((srv) => ({ id: srv && srv.id, ping: -1 }));
  }

  const dataDir = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const tempConfigPath = path.join(dataDir, `xray_ping_${process.pid}_${Date.now()}.json`);
  const delayTimeoutMs = Number(options.delayTimeoutMs) || 4500;
  let proc = null;

  try {
    const ports = await Promise.all(validRaw.map(() => findFreePort(0)));
    const entries = validRaw.map((server, idx) => ({
      id: server.id,
      port: ports[idx],
      server
    }));

    const sendThrough = detectPhysicalIpv4();
    const xrayCfg = generateXrayPingConfig(entries, sendThrough);
    fs.writeFileSync(tempConfigPath, JSON.stringify(xrayCfg, null, 2), 'utf-8');

    let exited = false;
    proc = spawn(xrayExe, ['run', '-c', tempConfigPath], {
      cwd: path.dirname(xrayExe),
      windowsHide: true
    });
    proc.on('error', () => {
      exited = true;
    });
    proc.on('close', () => {
      exited = true;
    });
    proc.stdout.resume();
    proc.stderr.resume();

    const ready = await waitForPortReady(entries[0].port, 2500, () => exited);
    if (!ready) {
      return null;
    }

    const pingById = new Map();
    const batchSize = 10;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const batchRes = await Promise.all(
        batch.map(async (entry) => ({
          id: entry.id,
          ping: await httpProxyDelayCheck(entry.port, delayTimeoutMs)
        }))
      );
      batchRes.forEach((item) => pingById.set(item.id, item.ping));
    }

    return servers.map((srv) => ({
      id: srv.id,
      ping: pingById.has(srv.id) ? pingById.get(srv.id) : -1
    }));
  } catch {
    return null;
  } finally {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
    try {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    } catch {}
  }
}

/**
 * Tests end-to-end proxy tunnel delay through a short-lived sing-box core
 * via its Clash API /proxies/{tag}/delay endpoint.
 */
async function testServersRealDelay(servers, options = {}) {
  if (!Array.isArray(servers) || servers.length === 0) {
    return [];
  }

  const singboxExe = options.singboxPath || path.resolve(__dirname, '../../bin/sing-box.exe');
  if (!fs.existsSync(singboxExe)) {
    return testServersTcpFallback(servers);
  }

  const validEntries = [];
  servers.forEach((srv, idx) => {
    if (srv && srv.server && srv.server_port && srv.uuid) {
      const tag = `p_${idx}`;
      validEntries.push({
        id: srv.id,
        tag,
        outbound: buildProxyOutbound(srv, tag)
      });
    }
  });

  if (validEntries.length === 0) {
    return servers.map((srv) => ({ id: srv && srv.id, ping: -1 }));
  }

  const dataDir = path.resolve(__dirname, '../../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const tempConfigPath = path.join(dataDir, `ping_config_${process.pid}_${Date.now()}.json`);
  const delayTimeoutMs = Number(options.delayTimeoutMs) || 4500;
  let proc = null;

  try {
    const apiPort = await findFreePort(0);
    const pingConfig = {
      log: { level: 'error' },
      dns: {
        servers: [{ tag: 'dns-direct', type: 'local' }],
        final: 'dns-direct',
        strategy: 'ipv4_only'
      },
      inbounds: [],
      outbounds: [
        ...validEntries.map((e) => e.outbound),
        { type: 'direct', tag: 'direct' }
      ],
      route: {
        auto_detect_interface: true,
        default_domain_resolver: 'dns-direct',
        final: 'direct'
      },
      experimental: {
        clash_api: {
          external_controller: `127.0.0.1:${apiPort}`
        }
      }
    };

    fs.writeFileSync(tempConfigPath, JSON.stringify(pingConfig, null, 2), 'utf-8');

    let exited = false;
    proc = spawn(singboxExe, ['run', '-c', tempConfigPath], {
      cwd: path.dirname(singboxExe),
      windowsHide: true
    });
    proc.on('error', () => {
      exited = true;
    });
    proc.on('close', () => {
      exited = true;
    });
    proc.stdout.resume();
    proc.stderr.resume();

    const ready = await waitForClashApi(apiPort, 3000, () => exited);
    if (!ready) {
      return testServersTcpFallback(servers);
    }

    const pingById = new Map();
    const batchSize = 10;
    const testUrl = encodeURIComponent('http://cp.cloudflare.com/generate_204');

    for (let i = 0; i < validEntries.length; i += batchSize) {
      const batch = validEntries.slice(i, i + batchSize);
      const batchRes = await Promise.all(
        batch.map(async (entry) => {
          const reqPath = `/proxies/${encodeURIComponent(entry.tag)}/delay?timeout=${delayTimeoutMs}&url=${testUrl}`;
          const resp = await httpGetJson(apiPort, reqPath, delayTimeoutMs + 1000);
          const delay = resp.statusCode === 200 && typeof resp.data.delay === 'number' && resp.data.delay > 0
            ? Math.round(resp.data.delay)
            : -1;
          return { id: entry.id, ping: delay };
        })
      );
      batchRes.forEach((item) => pingById.set(item.id, item.ping));
    }

    return servers.map((srv) => ({
      id: srv.id,
      ping: pingById.has(srv.id) ? pingById.get(srv.id) : -1
    }));
  } catch {
    return testServersTcpFallback(servers);
  } finally {
    if (proc) {
      try {
        proc.kill();
      } catch {}
    }
    try {
      if (fs.existsSync(tempConfigPath)) {
        fs.unlinkSync(tempConfigPath);
      }
    } catch {}
  }
}

/**
 * Tests latency for a list of servers using Xray-core first (X25519MLKEM768
 * REALITY + WS/TLS support), falling back to sing-box / TCP if unavailable.
 */
async function testAllServers(servers) {
  const xrayResults = await testServersXrayDelay(servers);
  if (Array.isArray(xrayResults)) {
    return xrayResults;
  }
  return testServersRealDelay(servers);
}

module.exports = {
  testTcpLatency,
  testServersXrayDelay,
  testServersRealDelay,
  testAllServers,
  findFreePort
};
