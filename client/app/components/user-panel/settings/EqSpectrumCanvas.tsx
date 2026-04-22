import { useEffect, useRef } from "react";
import { EQ_BAND_FREQS, EQ_BAND_TYPES, type EqBand } from "~/lib/settings";

interface EqSpectrumCanvasProps {
  deviceId: string;
  bands: EqBand[];
  enabled: boolean;
}

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const MIN_DB = -18;
const MAX_DB = 18;

// Standalone live spectrum + EQ curve visualiser. Runs its own AudioContext +
// getUserMedia + biquad chain so it works whether or not the user is in a
// voice call. Keeping it self-contained means the real mic graph in
// VoiceClient is never re-wired when the user drags a slider.
export default function EqSpectrumCanvas({ deviceId, bands, enabled }: EqSpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandsRef = useRef(bands);
  const enabledRef = useRef(enabled);
  const filtersRef = useRef<BiquadFilterNode[]>([]);

  // Keep the refs current so the long-lived rAF loop always reads fresh values.
  useEffect(() => { bandsRef.current = bands; }, [bands]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Push the current band values into the local biquads whenever they change,
  // so the spectrum you hear-ish matches what the outgoing mic will sound like.
  useEffect(() => {
    filtersRef.current.forEach((filter, i) => {
      if (!bands[i]) return;
      filter.gain.value = enabled ? bands[i].gain : 0;
      filter.Q.value = bands[i].q;
    });
  }, [bands, enabled]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let animId: number | null = null;

    navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId && { deviceId: { exact: deviceId } }),
        autoGainControl: false,
      },
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(s);

      const filters: BiquadFilterNode[] = [];
      for (let i = 0; i < EQ_BAND_FREQS.length; i++) {
        const filter = ctx.createBiquadFilter();
        filter.type = EQ_BAND_TYPES[i];
        filter.frequency.value = EQ_BAND_FREQS[i];
        filter.Q.value = bandsRef.current[i]?.q ?? 1;
        filter.gain.value = enabledRef.current ? (bandsRef.current[i]?.gain ?? 0) : 0;
        filters.push(filter);
      }
      filtersRef.current = filters;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;

      let prev: AudioNode = source;
      for (const f of filters) { prev.connect(f); prev = f; }
      prev.connect(analyser);

      const binCount = analyser.frequencyBinCount;
      const freqData = new Uint8Array(binCount);
      const nyquist = ctx.sampleRate / 2;

      // Log-frequency x-axis. Precompute once.
      const logMin = Math.log(MIN_FREQ);
      const logMax = Math.log(MAX_FREQ);
      const xToFreq = (x: number, w: number) => Math.exp(logMin + (x / w) * (logMax - logMin));
      const dbToY = (db: number, h: number) => ((MAX_DB - db) / (MAX_DB - MIN_DB)) * h;

      const draw = () => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const cssW = canvas.clientWidth;
          const cssH = canvas.clientHeight;
          if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
            canvas.width = cssW * dpr;
            canvas.height = cssH * dpr;
          }
          const g = canvas.getContext('2d');
          if (g) {
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, cssW, cssH);

            // Zero dB baseline
            g.strokeStyle = 'rgba(128,128,128,0.25)';
            g.lineWidth = 1;
            const zeroY = dbToY(0, cssH);
            g.beginPath();
            g.moveTo(0, zeroY);
            g.lineTo(cssW, zeroY);
            g.stroke();

            // Band center frequency markers
            g.strokeStyle = 'rgba(128,128,128,0.15)';
            for (const f of EQ_BAND_FREQS) {
              const x = ((Math.log(f) - logMin) / (logMax - logMin)) * cssW;
              g.beginPath();
              g.moveTo(x, 0);
              g.lineTo(x, cssH);
              g.stroke();
            }

            // Live spectrum bars (post-EQ). Use theme vars via a hidden probe
            // element so we inherit light/dark Tailwind theme colors.
            analyser.getByteFrequencyData(freqData);
            const styles = getComputedStyle(canvas);
            const mutedColor = styles.getPropertyValue('--muted-foreground').trim() || 'rgb(150,150,150)';
            g.fillStyle = mutedColor;
            g.globalAlpha = 0.45;
            const BAR_STEP = 2;
            for (let x = 0; x < cssW; x += BAR_STEP) {
              const freq = xToFreq(x + BAR_STEP / 2, cssW);
              const bin = Math.min(binCount - 1, Math.round((freq / nyquist) * binCount));
              const mag = freqData[bin] / 255; // 0..1
              const barH = mag * cssH;
              g.fillRect(x, cssH - barH, BAR_STEP - 0.5, barH);
            }
            g.globalAlpha = 1;

            // Combined EQ curve on top.
            const primaryColor = styles.getPropertyValue('--primary').trim() || '#8ab4ff';
            g.strokeStyle = primaryColor;
            g.lineWidth = 2;
            g.beginPath();
            const freqArr = new Float32Array(1);
            const magArr = new Float32Array(1);
            const phaseArr = new Float32Array(1);
            for (let x = 0; x <= cssW; x += 1) {
              const freq = xToFreq(x, cssW);
              freqArr[0] = freq;
              let totalDb = 0;
              for (const filter of filters) {
                filter.getFrequencyResponse(freqArr, magArr, phaseArr);
                totalDb += 20 * Math.log10(magArr[0] || 1e-6);
              }
              const y = dbToY(totalDb, cssH);
              if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.stroke();
          }
        }
        animId = requestAnimationFrame(draw);
      };
      animId = requestAnimationFrame(draw);
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (animId !== null) cancelAnimationFrame(animId);
      filtersRef.current.forEach((f) => f.disconnect());
      filtersRef.current = [];
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (ctx) ctx.close().catch(() => {});
    };
  }, [deviceId]);

  return (
    <div className="relative w-full h-[220px] rounded-md border bg-muted/20 overflow-hidden">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
