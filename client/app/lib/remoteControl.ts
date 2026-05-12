// Client-side orchestration for remote control during screenshare.
//
// The server relays signaling (request/grant/revoke) and input events between
// peers. This class holds the local session state and, when we're the sharer
// on Electron, forwards incoming input events into the Electron main process
// via window.electronAPI.remoteControl for OS-level injection.
//
// Web clients never call arm/inject — the UI that kicks this off is gated on
// window.electronAPI being present, so non-Electron peers simply have no way
// to originate or receive a grant.

export type RemoteControlInputEvent =
  | { kind: 'mouse-move'; x: number; y: number }
  | { kind: 'mouse-down'; button: 'left' | 'right' | 'middle' }
  | { kind: 'mouse-up'; button: 'left' | 'right' | 'middle' }
  | { kind: 'wheel'; dx: number; dy: number }
  | { kind: 'key-down'; code: string }
  | { kind: 'key-up'; code: string };

export type RemoteControlSession = {
  sessionId: string;
  role: 'sharer' | 'controller';
  sharerUsername: string;
  controllerUsername: string;
};

export type RemoteControlHandlers = {
  // Fired on the sharer when someone requests control — triggers the grant dialog.
  onIncomingRequest: (requesterUsername: string) => void;
  // Fired on both parties when the active session changes (null on revoke).
  onSessionChange: (session: RemoteControlSession | null) => void;
  // Fired on the requester when the sharer explicitly denies.
  onRequestDenied: (sharerUsername: string) => void;
  // Fired on both parties when the sharer's takeover safeguard pauses or
  // resumes injection mid-session. The session stays alive throughout.
  onPauseChange: (paused: boolean) => void;
  // Fired on controllers when a sharer in their voice channel changes
  // whether they allow remote-control requests. Used to keep the Request
  // Control button's enabled state in sync with the sharer's choice.
  onSharerRcStateChange: (sharerUsername: string, enabled: boolean) => void;
  // Non-fatal errors worth surfacing (e.g. "target offline").
  onError: (message: string) => void;
};

function rcRequest(ws: WebSocket, action: string, data: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) { reject(new Error('WebSocket is not open')); return; }
    const requestId = crypto.randomUUID();
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeEventListener('message', handler);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`request "${action}" timed out`)); }, 10_000);
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.requestId === requestId) {
        cleanup();
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg);
      }
    };
    ws.addEventListener('message', handler);
    try {
      ws.send(JSON.stringify({ requestId, type: 'remote-control', action, ...data }));
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

export class RemoteControlClient {
  private ws: WebSocket;
  private handlers: RemoteControlHandlers;
  private localUsername: string;
  private session: RemoteControlSession | null = null;
  private notificationHandler: (event: MessageEvent) => void;
  private unsubscribeElectron: (() => void) | null = null;
  private unsubscribePause: (() => void) | null = null;
  private unsubscribeResume: (() => void) | null = null;
  private unsubscribeShareAuth: (() => void) | null = null;
  // Tracks each sharer's published "remote control enabled" state, learned
  // from server-broadcast `rc-state-update` notifications. Defaults to true
  // for unknown sharers (graceful fallback if the broadcast was missed).
  private sharerRcAllowed: Map<string, boolean> = new Map();

  constructor(ws: WebSocket, localUsername: string, handlers: RemoteControlHandlers) {
    this.ws = ws;
    this.localUsername = localUsername;
    this.handlers = handlers;

    this.notificationHandler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== 'remote-control-notification') return;
      this.handleNotification(msg);
    };
    ws.addEventListener('message', this.notificationHandler);

    // The Electron main process auto-disarms on screen-share end or app
    // close; when it does, clear our local session so the banner disappears.
    this.unsubscribeElectron = window.electronAPI?.remoteControl.onSessionEnded(() => {
      if (this.session?.role === 'sharer') {
        this.revoke('helper-disarmed').catch(() => {});
      }
    }) ?? null;

    // Takeover pause notifications — fire local handler and relay to the
    // controller via WebSocket so their banner can mirror the state.
    this.unsubscribePause = window.electronAPI?.remoteControl.onInjectionPaused(() => {
      this.handlers.onPauseChange(true);
      this.broadcastPauseState(true);
    }) ?? null;
    this.unsubscribeResume = window.electronAPI?.remoteControl.onInjectionResumed(() => {
      this.handlers.onPauseChange(false);
      this.broadcastPauseState(false);
    }) ?? null;

    // The sharer's source-picker choice arrives once per share. Push it to
    // the server so the channel learns whether requests are even allowed.
    this.unsubscribeShareAuth = window.electronAPI?.onShareAuth?.((allowControl) => {
      this.publishRcAllowed(allowControl);
    }) ?? null;
  }

  // Sharer-side: publish whether others can request control of this share.
  // Server stores per-user and broadcasts to voice channel members.
  publishRcAllowed(enabled: boolean): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'remote-control',
      action: 'set-rc-state',
      enabled,
    }));
  }

  // Controller-side: lookup whether a given sharer currently allows requests.
  // Defaults to true if we haven't received a state update yet — the server
  // will reject the actual request anyway if the sharer has it off.
  sharerAllowsRemoteControl(sharerUsername: string): boolean {
    return this.sharerRcAllowed.get(sharerUsername) ?? true;
  }

  private broadcastPauseState(paused: boolean): void {
    const session = this.session;
    if (!session || session.role !== 'sharer') return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'remote-control', action: 'pause-state',
      sessionId: session.sessionId, paused,
    }));
  }

  private async handleNotification(msg: any) {
    switch (msg.action) {
      case 'control-requested': {
        if (typeof msg.requesterUsername === 'string') {
          this.handlers.onIncomingRequest(msg.requesterUsername);
        }
        return;
      }
      case 'rc-state-update': {
        // Server is telling us a sharer in our voice channel flipped their
        // "allow remote control" toggle. Update the cache so the Request
        // Control button can disable itself for that tile.
        if (typeof msg.sharerUsername !== 'string') return;
        const enabled = !!msg.enabled;
        this.sharerRcAllowed.set(msg.sharerUsername, enabled);
        this.handlers.onSharerRcStateChange(msg.sharerUsername, enabled);
        return;
      }
      case 'control-granted': {
        const session: RemoteControlSession = {
          sessionId: msg.sessionId,
          sharerUsername: msg.sharerUsername,
          controllerUsername: msg.controllerUsername,
          role: msg.sharerUsername === this.localUsername ? 'sharer' : 'controller',
        };
        this.session = session;
        if (session.role === 'sharer' && window.electronAPI) {
          const result = await window.electronAPI.remoteControl.armSession(session.sessionId);
          if (!result.ok) {
            // Couldn't arm — tell the server to revoke so the controller stops trying.
            this.handlers.onError(`Couldn't start remote control: ${result.error ?? 'unknown error'}`);
            await rcRequest(this.ws, 'revoke-control', {
              sessionId: session.sessionId, reason: 'arm-failed',
            }).catch(() => {});
            return;
          }
        }
        this.handlers.onSessionChange(session);
        return;
      }
      case 'control-denied': {
        if (typeof msg.sharerUsername === 'string') {
          this.handlers.onRequestDenied(msg.sharerUsername);
        }
        return;
      }
      case 'control-revoked': {
        const wasSharer = this.session?.role === 'sharer';
        this.session = null;
        if (wasSharer && window.electronAPI) {
          await window.electronAPI.remoteControl.disarmSession().catch(() => {});
        }
        this.handlers.onSessionChange(null);
        return;
      }
      case 'control-input': {
        // Sharer-only path: the main process injects into the OS.
        if (this.session?.role !== 'sharer') return;
        if (msg.sessionId !== this.session.sessionId) return;
        window.electronAPI?.remoteControl.injectInput(msg.sessionId, msg.event);
        return;
      }
      case 'pause-state': {
        // Controller-only path — sharer is telling us their physical mouse
        // activity has paused (or resumed) injection.
        if (this.session?.role !== 'controller') return;
        if (msg.sessionId !== this.session.sessionId) return;
        this.handlers.onPauseChange(!!msg.paused);
        return;
      }
    }
  }

  // Called by the viewer's UI. The server broadcasts a `control-requested`
  // notification to the sharer — we only get an ack that the request was
  // delivered, not an acceptance.
  async requestControl(targetUsername: string): Promise<void> {
    try {
      await rcRequest(this.ws, 'request-control', { targetUsername });
    } catch (err: any) {
      this.handlers.onError(err?.message ?? 'Could not request control');
    }
  }

  // Called by the sharer's UI after the user clicks Allow/Deny.
  async respond(requesterUsername: string, granted: boolean): Promise<void> {
    try {
      await rcRequest(this.ws, 'respond-control', { requesterUsername, granted });
    } catch (err: any) {
      this.handlers.onError(err?.message ?? 'Could not respond to control request');
    }
  }

  async revoke(reason = 'stopped'): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    if (session.role === 'sharer' && window.electronAPI) {
      await window.electronAPI.remoteControl.disarmSession().catch(() => {});
    }
    this.handlers.onSessionChange(null);
    try {
      await rcRequest(this.ws, 'revoke-control', { sessionId: session.sessionId, reason });
    } catch { /* server broadcast will handle it; local state is already cleared */ }
  }

  // Called by the viewer's input capture overlay. Fire-and-forget — the server
  // relays the event to the sharer without a response.
  sendInput(event: RemoteControlInputEvent): void {
    const session = this.session;
    if (!session || session.role !== 'controller') return;
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'remote-control', action: 'input',
      sessionId: session.sessionId, event,
    }));
  }

  // Called by Server.tsx when the sharer stops screen sharing. Clears main-
  // process state so a later arm-session can't inherit stale display bounds,
  // and tells the channel that requests are no longer accepted.
  screenShareStopped(): void {
    if (this.session?.role === 'sharer') {
      this.revoke('share-ended').catch(() => {});
    }
    this.publishRcAllowed(false);
    window.electronAPI?.remoteControl.clearSharedDisplay().catch(() => {});
  }

  getSession(): RemoteControlSession | null {
    return this.session;
  }

  destroy(): void {
    this.ws.removeEventListener('message', this.notificationHandler);
    this.unsubscribeElectron?.();
    this.unsubscribePause?.();
    this.unsubscribeResume?.();
    this.unsubscribeShareAuth?.();
    if (this.session?.role === 'sharer') {
      window.electronAPI?.remoteControl.disarmSession().catch(() => {});
    }
    this.session = null;
  }
}
