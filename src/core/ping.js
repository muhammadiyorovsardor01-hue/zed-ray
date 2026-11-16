const net = require('net');

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

/**
 * Tests latency for a list of servers in parallel.
 */
async function testAllServers(servers) {
  const results = await Promise.all(
    servers.map(async (srv) => {
      const ping = await testTcpLatency(srv.server, srv.server_port);
      return { id: srv.id, ping };
    })
  );
  return results;
}

module.exports = {
  testTcpLatency,
  testAllServers
};
