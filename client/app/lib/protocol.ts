export function getProtocol(serverIP: string): 'http' | 'https' {
  return serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
}

export function getWsProtocol(serverIP: string): 'ws' | 'wss' {
  return getProtocol(serverIP) === 'https' ? 'wss' : 'ws';
}
