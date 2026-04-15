import { useEffect, useRef } from "react";

interface InputLevelMeterProps {
  deviceId: string;
  vadMode: 'off' | 'auto' | 'manual';
  vadThreshold: number;
}

// Standalone live mic level meter — runs its own AudioContext + analyser
// against getUserMedia so it works whether or not the user is currently in
// a voice call. Values are scaled to 0-100 to match the VAD threshold UI.
export default function InputLevelMeter({ deviceId, vadMode, vadThreshold }: InputLevelMeterProps) {
  const fillRef = useRef<HTMLDivElement>(null);
  const thresholdRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const noiseFloorRef = useRef(10);
  const autoThresholdRef = useRef(25);

  useEffect(() => {
    noiseFloorRef.current = 10;
    autoThresholdRef.current = 25;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let animId: number | null = null;

    navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
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

          let threshold: number;
          if (vadMode === 'manual') {
            threshold = vadThreshold;
          } else if (vadMode === 'auto') {
            if (avg < autoThresholdRef.current) {
              noiseFloorRef.current = noiseFloorRef.current * 0.94 + avg * 0.06;
            }
            autoThresholdRef.current = Math.min(Math.max(noiseFloorRef.current * 2.5 + 8, 8), 60);
            threshold = autoThresholdRef.current;
          } else {
            threshold = 0;
          }

          if (fillRef.current) {
            fillRef.current.style.width = `${pct}%`;
            fillRef.current.style.background = avg > threshold
              ? 'var(--primary)'
              : 'var(--muted-foreground)';
          }
          if (thresholdRef.current) {
            thresholdRef.current.style.left = `${Math.min(threshold, 100)}%`;
            thresholdRef.current.style.display = vadMode === 'off' ? 'none' : 'block';
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
  }, [deviceId, vadMode, vadThreshold]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div ref={fillRef} className="absolute inset-y-0 left-0 transition-[width,background] duration-75" style={{ width: 0 }} />
        <div
          ref={thresholdRef}
          className="absolute inset-y-0 w-0.5 bg-foreground"
          style={{ left: 0 }}
        />
      </div>
      <span ref={valueRef} className="text-xs text-muted-foreground tabular-nums w-8 text-right">0</span>
    </div>
  );
}
