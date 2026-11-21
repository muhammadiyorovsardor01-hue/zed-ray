const { execFileSync } = require('child_process');
const os = require('os');

const VIRTUAL_IFACE_REGEX = /tun|wintun|zedray|sing-tun|vethernet|loopback|tailscale|wireguard/i;

function isVirtualOrInvalidIpv4(ip) {
  if (!ip || ip === '0.0.0.0') return true;
  if (ip.startsWith('127.') || ip.startsWith('172.19.') || ip.startsWith('169.254.')) return true;
  return false;
}

/**
 * Detects the best physical outbound IPv4 address on Windows so xray.exe
 * sends upstream packets out the real NIC rather than an active VPN TUN adapter.
 */
function detectPhysicalIpv4() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('route', ['print', '0.0.0.0'], {
        encoding: 'utf8',
        windowsHide: true
      });
      const candidates = [];
      for (const rawLine of out.split(/\r?\n/)) {
        const line = rawLine.trim();
        const m = line.match(/^0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)$/);
        if (!m) continue;
        const ifaceIp = m[1];
        const metric = parseInt(m[2], 10);
        if (!isVirtualOrInvalidIpv4(ifaceIp) && !Number.isNaN(metric)) {
          candidates.push({ ifaceIp, metric });
        }
      }
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.metric - b.metric);
        return candidates[0].ifaceIp;
      }
    }
  } catch {
    // ignore route print failures and try os.networkInterfaces fallback
  }

  try {
    const ifaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (VIRTUAL_IFACE_REGEX.test(name)) continue;
      for (const addr of addrs || []) {
        if (addr && addr.family === 'IPv4' && !addr.internal && !isVirtualOrInvalidIpv4(addr.address)) {
          return addr.address;
        }
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

function isRealityServer(server) {
  return Boolean(
    server &&
      (server.security === 'reality' || (server.tls && server.tls.reality && server.tls.reality.enabled))
  );
}

/**
 * Builds an Xray-core v26.11.9 compatible VLESS outbound.
 */
function buildXrayVlessOutbound(server, tag = 'proxy', sendThrough = '') {
  const netType = server.network || (server.transport && server.transport.type) || 'tcp';
  const isReality = isRealityServer(server);
  const isTls = !isReality && (server.security === 'tls' || (server.tls && server.tls.enabled));
  const security = isReality ? 'reality' : isTls ? 'tls' : 'none';

  const user = {
    id: server.uuid,
    encryption: 'none'
  };
  if (server.flow) {
    user.flow = server.flow;
  }

  const streamSettings = {
    network: netType,
    security
  };

  if (isReality) {
    streamSettings.realitySettings = {
      serverName: (server.tls && server.tls.server_name) || server.sni || server.server,
      fingerprint: (server.tls && server.tls.utls && server.tls.utls.fingerprint) || server.fingerprint || 'chrome',
      publicKey: (server.tls && server.tls.reality && server.tls.reality.public_key) || server.public_key || '',
      shortId: (server.tls && server.tls.reality && server.tls.reality.short_id) || server.short_id || '',
      spiderX: '/'
    };
  } else if (isTls) {
    let alpn;
    if (server.tls && Array.isArray(server.tls.alpn) && server.tls.alpn.length > 0) {
      alpn = [...server.tls.alpn];
    } else if (typeof server.alpn === 'string' && server.alpn.trim()) {
      alpn = server.alpn.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (netType === 'ws') {
      alpn = ['http/1.1'];
    }

    streamSettings.tlsSettings = {
      serverName: (server.tls && server.tls.server_name) || server.sni || server.server,
      fingerprint: (server.tls && server.tls.utls && server.tls.utls.fingerprint) || server.fingerprint || 'chrome',
      ...(alpn && alpn.length > 0 ? { alpn } : {})
    };
  }

  if (netType === 'ws') {
    let wsPath = (server.transport && server.transport.path) || server.path || '/';
    const maxEd = server.transport && server.transport.max_early_data;
    if (maxEd > 0 && !/[?&]ed=/.test(wsPath)) {
      wsPath += `${wsPath.includes('?') ? '&' : '?'}ed=${maxEd}`;
    }
    const hostHdr =
      (server.transport && server.transport.headers && server.transport.headers.Host) ||
      server.wsHost ||
      (server.tls && server.tls.server_name) ||
      server.sni ||
      '';
    streamSettings.wsSettings = {
      path: wsPath,
      ...(hostHdr ? { host: hostHdr } : {})
    };
  } else if (netType === 'grpc') {
    streamSettings.grpcSettings = {
      serviceName: (server.transport && server.transport.service_name) || server.serviceName || ''
    };
  } else if (netType === 'httpupgrade') {
    const huPath = (server.transport && server.transport.path) || server.path || '/';
    const huHost =
      (server.transport && server.transport.host) ||
      server.wsHost ||
      (server.tls && server.tls.server_name) ||
      server.sni ||
      '';
    streamSettings.httpupgradeSettings = {
      path: huPath,
      ...(huHost ? { host: huHost } : {})
    };
  }

  const outbound = {
    tag,
    protocol: 'vless',
    settings: {
      vnext: [
        {
          address: server.server,
          port: server.server_port,
          users: [user]
        }
      ]
    },
    streamSettings
  };

  if (sendThrough) {
    outbound.sendThrough = sendThrough;
  }

  return outbound;
}

function generateXraySidecarConfig(server, socksPort, sendThrough = '') {
  return {
    log: {
      loglevel: 'warning'
    },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: socksPort,
        protocol: 'socks',
        settings: {
          auth: 'noauth',
          udp: true
        }
      }
    ],
    outbounds: [buildXrayVlessOutbound(server, 'proxy', sendThrough)]
  };
}

function generateXrayPingConfig(entries, sendThrough = '') {
  return {
    log: {
      loglevel: 'error'
    },
    inbounds: entries.map((entry, idx) => ({
      tag: `in_${idx}`,
      listen: '127.0.0.1',
      port: entry.port,
      protocol: 'http'
    })),
    outbounds: entries.map((entry, idx) =>
      buildXrayVlessOutbound(entry.server, `out_${idx}`, sendThrough)
    ),
    routing: {
      rules: entries.map((_, idx) => ({
        type: 'field',
        inboundTag: [`in_${idx}`],
        outboundTag: `out_${idx}`
      }))
    }
  };
}

module.exports = {
  detectPhysicalIpv4,
  isRealityServer,
  buildXrayVlessOutbound,
  generateXraySidecarConfig,
  generateXrayPingConfig
};
