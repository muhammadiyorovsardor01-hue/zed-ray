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
    const lookup = await dns.lookup(host, { family: 4 });
    return lookup.address;
  } catch {
    return null;
  }
}

/**
 * Generates a sing-box 1.14+ compatible configuration.
 *
 * Migration notes (sing-box 1.10 -> 1.14):
 *  - tun `inet4_address`            -> `address` (array)
 *  - inbound `sniff`                -> route rule `{ action: "sniff" }`
 *  - `dns` / `block` outbounds      -> route rule action `hijack-dns` / `reject`
 *  - legacy DNS servers (`address`) -> typed servers (`type`, `server`)
 *  - dns rule `outbound: any`       -> `route.default_domain_resolver`
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
      interface_name: 'ZedRayTun',
      address: ['172.19.0.1/30'],
      mtu: mtu,
      auto_route: true,
      strict_route: true,
      stack: 'gvisor' // gvisor user-space stack is resilient against Windows sleep/wake drops
    });
  }

  // Outbound `network` only accepts "tcp" / "udp" (the transport type such as
  // ws/grpc lives in `transport`), so never forward values like "ws" here.
  const network = server.network === 'udp' ? 'udp' : undefined;

  const proxyOutbound = {
    type: server.type || 'vless',
    tag: 'proxy',
    server: server.server,
    server_port: server.server_port,
    uuid: server.uuid,
    flow: server.flow || undefined,
    network,
    tls: server.tls,
    transport: server.transport
  };

  const outbounds = [
    proxyOutbound,
    {
      type: 'direct',
      tag: 'direct'
    }
  ];

  // DNS: encrypted DoH through the tunnel, system resolver only for bootstrap
  const dnsConfig = {
    servers: [
      {
        type: 'https',
        tag: 'dns-remote',
        server: '1.1.1.1',
        detour: 'proxy'
      },
      {
        type: 'local',
        tag: 'dns-direct'
      }
    ],
    final: 'dns-remote',
    strategy: 'ipv4_only'
  };

  // Route rules
  const rules = [
    { action: 'sniff' },
    { protocol: 'dns', action: 'hijack-dns' }
  ];

  // Anti-looping rule: Direct access for server's own IP
  if (serverIp) {
    rules.push({
      ip_cidr: [`${serverIp}/32`],
      action: 'route',
      outbound: 'direct'
    });
  }

  if (routingMode === 'rule') {
    // Bypass Private / Local LAN
    rules.push({
      ip_is_private: true,
      action: 'route',
      outbound: 'direct'
    });
  }

  const routeConfig = {
    rules: rules,
    auto_detect_interface: true,
    // Used to resolve the proxy server's own domain name (if it is not an IP)
    default_domain_resolver: 'dns-direct',
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
