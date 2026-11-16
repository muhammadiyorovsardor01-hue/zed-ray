const dns = require('dns').promises;

/**
 * Resolves server host to an IP address if it's a domain name.
 */
async function resolveHostToIp(host) {
  // If host is already an IPv4 address
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    return host;
  }
  try {
    const lookup = await dns.lookup(host);
    return lookup.address;
  } catch {
    return null;
  }
}

/**
 * Generates production-grade, anti-disconnection sing-box configuration.
 */
async function generateSingboxConfig(server, options = {}) {
  const {
    mode = 'tun', // 'tun' or 'system_proxy'
    mtu = 1400,   // Crucial: 1400 avoids fragmentation disconnections
    mixedPort = 20807,
    routingMode = 'rule' // 'rule' (bypass LAN/private), 'global'
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
      interface_name: 'NexusTun',
      inet4_address: '172.19.0.1/30',
      mtu: mtu,
      auto_route: true,
      strict_route: true,
      stack: 'gvisor', // gvisor user-space stack is resilient against Windows sleep/wake drops
      sniff: true
    });
  }

  // Construct Outbound based on server type
  const proxyOutbound = {
    type: server.type || 'vless',
    tag: 'proxy',
    server: server.server,
    server_port: server.server_port,
    uuid: server.uuid,
    flow: server.flow || undefined,
    network: server.network || 'tcp',
    tls: server.tls,
    transport: server.transport
  };

  const outbounds = [
    proxyOutbound,
    {
      type: 'direct',
      tag: 'direct'
    },
    {
      type: 'block',
      tag: 'block'
    },
    {
      type: 'dns',
      tag: 'dns-out'
    }
  ];

  // DNS Configuration to avoid DNS leaks and Windows Multi-Homed stalls
  const dnsConfig = {
    servers: [
      {
        tag: 'dns-remote',
        address: 'https://1.1.1.1/dns-query',
        detour: 'proxy'
      },
      {
        tag: 'dns-direct',
        address: 'local',
        detour: 'direct'
      }
    ],
    rules: [
      {
        outbound: 'any',
        server: 'dns-direct'
      }
    ],
    strategy: 'ipv4_only'
  };

  // Route rules
  const rules = [
    {
      protocol: 'dns',
      outbound: 'dns-out'
    }
  ];

  // Anti-looping rule: Direct access for server's own IP
  if (serverIp) {
    rules.push({
      ip_cidr: [`${serverIp}/32`],
      outbound: 'direct'
    });
  }

  if (routingMode === 'rule') {
    // Bypass Private / Local LAN
    rules.push({
      ip_is_private: true,
      outbound: 'direct'
    });
  }

  const routeConfig = {
    rules: rules,
    auto_detect_interface: true,
    final: 'proxy'
  };

  return {
    log: {
      level: 'warn',
      timestamp: true
    },
    dns: dnsConfig,
    inbounds: inbounds,
    outbounds: outbounds,
    route: routeConfig
  };
}

module.exports = {
  generateSingboxConfig,
  resolveHostToIp
};
