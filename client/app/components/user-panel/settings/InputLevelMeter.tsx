import { useEffect, useRef } from "react";

interface InputLevelMeterProps {
  deviceId: string;
  vadMode: 'off' | 'auto';
}

// Standalone live mic level meter — runs its own AudioContext + analyser
// against getUserMedia so it works whether or not the user is currently in
// a voice call. Values are shown as a 0-100 fill bar.
export default function InputLevelMeter({ deviceId, vadMode }: InputLevelMeterProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let animId: number | null = null;

    // Match the primary voice stream's constraints exactly. If the user is
    // in a call on this device, opening a second stream with different
    // flags makes Chromium re-negotiate the device — which flips the OS
    // into "Communications" mode on Windows and overrides the Wave XLR's
    // physical gain. Keeping everything off matches voice.ts.
    navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId && { deviceId: { exact: deviceId } }),
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      let lastUpdate = 0;
      const tick = (time: number) => {
        if (cancelled) return;
        if (time - lastUpdate >= 50) {
          lastUpdate = time;
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          const pct = Math.min(avg, 100);

          if (fillRef.current) {
            fillRef.current.style.width = `${pct}%`;
            fillRef.current.style.background = 'var(--primary)';
          }
          if (valueRef.current) valueRef.current.textContent = String(Math.round(avg));
        }
        animId = requestAnimationFrame(tick);
      };
      animId = requestAnimationFrame(tick);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (animId !== null) cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
    };
  }, [deviceId, vadMode]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div ref={fillRef} className="absolute inset-y-0 left-0 transition-[width,background] duration-75" style={{ width: 0 }} />
      </div>
      <span ref={valueRef} className="text-xs text-muted-foreground tabular-nums w-8 text-right">0</span>
    </div>
  );
}
