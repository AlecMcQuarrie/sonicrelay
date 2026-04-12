export function getProtocol(serverIP: string): 'http' | 'https' {
  return serverIP.includes('localhost') || serverIP.includes('127.0.0.1') ? 'http' : 'https';
}

export function getWsProtocol(serverIP: string): 'ws' | 'wss' {
  return getProtocol(serverIP) === 'https' ? 'wss' : 'ws';
}

/**
 * Build a full URL for an uploaded file, appending the access token as a
 * query param. The server's /uploads/:filename route requires auth; image
 * tags can't send custom headers, so the token travels in the query string.
 */
export function buildUploadUrl(url: string, serverIP: string, accessToken: string): string {
  const protocol = getProtocol(serverIP);
  return `${protocol}://${serverIP}${url}?token=${encodeURIComponent(accessToken)}`;
}
