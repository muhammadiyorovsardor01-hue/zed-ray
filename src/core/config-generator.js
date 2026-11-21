const dns = require('dns').promises;
const net = require('net');

/**
 * Resolves server host to an IP address if it's a domain name.
 */
async function resolveHostToIp(host) {
  if (net.isIP(host)) {
    return host;
  }
  try {
    const lookup = await dns.lookup(host, { family: 4 });
    return lookup.address;
  } catch {
    try {
      const lookup = await dns.lookup(host);
      return lookup.address;
    } catch {
      return null;
    }
  }
}

/**
 * Builds a sing-box 1.14.4 compatible proxy outbound object.
 */
function buildProxyOutbound(server, tag = 'proxy') {
  let tlsConfig = server.tls ? JSON.parse(JSON.stringify(server.tls)) : undefined;
  if (tlsConfig && server.transport && server.transport.type === 'ws' && !tlsConfig.reality && (!tlsConfig.alpn || tlsConfig.alpn.length === 0)) {
    tlsConfig.alpn = ['http/1.1'];
  }

  return {
    type: server.type || 'vless',
    tag,
    server: server.server,
    server_port: server.server_port,
    uuid: server.uuid,
    flow: server.flow || undefined,
    packet_encoding: 'xudp',
    tls: tlsConfig,
    transport: server.transport
  };
}

/**
 * Generates sing-box 1.14.4 compatible configuration.
 */
async function generateSingboxConfig(server, options = {}) {
  const {
    mode = 'tun', // 'tun' or 'system_proxy'
    mtu = 1400,   // Crucial: 1400 avoids fragmentation disconnections
    mixedPort = 20807,
    routingMode = 'rule', // 'rule' (bypass LAN/private), 'global'
    clashApiPort = 0,
    upstreamSocksPort = 0
  } = options;

  const serverIp = await resolveHostToIp(server.server);

  const inbounds = [
    {
      type: 'mixed',
      tag: 'mixed-in',
      listen: '127.0.0.1',
      listen_port: mixedPort
    }
  ];

  if (mode === 'tun') {
    inbounds.push({
      type: 'tun',
      tag: 'tun-in',
      interface_name: 'ZedRayTun',
      address: ['172.19.0.1/30'],
      mtu: mtu,
      auto_route: true,
      strict_route: true,
      stack: 'gvisor'
    });
  }

  // Construct Outbound: route through local Xray SOCKS5 sidecar when enabled
  const proxyOutbound = Number.isInteger(upstreamSocksPort) && upstreamSocksPort > 0
    ? {
        type: 'socks',
        tag: 'proxy',
        server: '127.0.0.1',
        server_port: upstreamSocksPort,
        version: '5'
      }
    : buildProxyOutbound(server, 'proxy');

  const outbounds = [
    proxyOutbound,
    {
      type: 'direct',
      tag: 'direct'
    }
  ];

  // DNS Configuration (sing-box 1.14+ format)
  const dnsConfig = {
    servers: [
      {
        tag: 'dns-remote',
        type: 'https',
        server: '1.1.1.1',
        server_port: 443,
        path: '/dns-query',
        detour: 'proxy'
      },
      {
        tag: 'dns-direct',
        type: 'local'
      }
    ],
    final: 'dns-remote',
    strategy: 'ipv4_only'
  };

  // Route rules (rule actions in sing-box 1.11+)
  const rules = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' }
  ];

  // Anti-looping rule: Direct access for server's own IP or domain
  if (serverIp) {
    const prefix = net.isIPv6(serverIp) ? 128 : 32;
    rules.push({
      ip_cidr: [`${serverIp}/${prefix}`],
      outbound: 'direct'
    });
  } else if (server.server) {
    rules.push({
      domain: [server.server],
      outbound: 'direct'
    });
  }

  if (routingMode === 'rule') {
    rules.push({
      ip_is_private: true,
      outbound: 'direct'
    });
  } else {
    rules.push({
      ip_cidr: ['127.0.0.0/8', '::1/128'],
      outbound: 'direct'
    });
  }

  const routeConfig = {
    rules: rules,
    auto_detect_interface: true,
    default_domain_resolver: 'dns-direct',
    final: 'proxy'
  };

  const config = {
    log: {
      level: 'info',
      timestamp: true
    },
    dns: dnsConfig,
    inbounds: inbounds,
    outbounds: outbounds,
    route: routeConfig
  };

  if (Number.isInteger(clashApiPort) && clashApiPort > 0) {
    config.experimental = {
      clash_api: {
        external_controller: `127.0.0.1:${clashApiPort}`
      }
    };
  }

  return config;
}

module.exports = {
  generateSingboxConfig,
  buildProxyOutbound,
  resolveHostToIp
};
