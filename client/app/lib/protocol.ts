export function getProtocol(serverIP: string): 'http' | 'https' {
  return serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
}

export function getWsProtocol(serverIP: string): 'ws' | 'wss' {
  return getProtocol(serverIP) === 'https' ? 'wss' : 'ws';
}

/**
 * Build a full URL for an uploaded file, appending a short-lived upload
 * token as a query param. The server's /uploads/:filename route accepts
 * only upload-scoped tokens (type: 'upload') on the query path — never
 * the long-lived session JWT — so a URL leaking into an access log has
 * a ≤10 min blast radius and can't be used against any other endpoint.
 */
export function buildUploadUrl(url: string, serverIP: string, uploadToken: string): string {
  const protocol = getProtocol(serverIP);
  return `${protocol}://${serverIP}${url}?token=${encodeURIComponent(uploadToken)}`;
}
