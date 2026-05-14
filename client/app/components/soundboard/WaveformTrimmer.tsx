import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { Button } from "~/components/ui/button";
import { getSoundboardAudioContext } from "~/lib/soundboard";

interface WaveformTrimmerProps {
  buffer: AudioBuffer;
  trimStart: number;
  trimEnd: number;
  onTrimChange: (start: number, end: number) => void;
}

const BARS = 200;
const MIN_TRIM_GAP = 0.05; // seconds — keeps handles from crossing

export default function WaveformTrimmer({
  buffer, trimStart, trimEnd, onTrimChange,
}: WaveformTrimmerProps) {
  const duration = buffer.duration;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartedAtRef = useRef(0); // AudioContext.currentTime at play start
  const rafRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(trimStart);

  // Latest trim values, used inside the rAF tick without re-binding.
  const trimRef = useRef({ start: trimStart, end: trimEnd });
  trimRef.current = { start: trimStart, end: trimEnd };

  // Sample peaks into a fixed-size bar array. Recomputed only when the
  // underlying buffer changes.
  const peaks = useMemo(() => {
    const channel = buffer.getChannelData(0);
    const samplesPerBar = Math.max(1, Math.floor(channel.length / BARS));
    const result = new Array<number>(BARS);
    for (let i = 0; i < BARS; i++) {
      let peak = 0;
      const start = i * samplesPerBar;
      const end = Math.min(start + samplesPerBar, channel.length);
      for (let j = start; j < end; j++) {
        const v = Math.abs(channel[j]);
        if (v > peak) peak = v;
      }
      result[i] = peak;
    }
    // Normalize to [0,1] so quiet clips still show a useful waveform.
    const max = result.reduce((m, v) => (v > m ? v : m), 0) || 1;
    return result.map((v) => v / max);
  }, [buffer]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const stopPlayback = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const s = sourceRef.current;
    if (s) {
      try { s.onended = null; s.stop(); } catch {}
      s.disconnect();
      sourceRef.current = null;
    }
    setPlaying(false);
  };

  const startPlayback = async () => {
    stopPlayback();
    const c = getSoundboardAudioContext();
    if (c.state === "suspended") await c.resume();
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.connect(c.destination);
    const dur = Math.max(0, trimRef.current.end - trimRef.current.start);
    source.onended = () => {
      if (sourceRef.current === source) stopPlayback();
    };
    source.start(0, trimRef.current.start, dur);
    sourceRef.current = source;
    playStartedAtRef.current = c.currentTime;
    setPlaying(true);
    setPlayhead(trimRef.current.start);

    const tick = () => {
      const elapsed = c.currentTime - playStartedAtRef.current;
      const pos = trimRef.current.start + elapsed;
      if (pos >= trimRef.current.end) {
        stopPlayback();
        return;
      }
      setPlayhead(pos);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  // Stop any in-flight playback when the component unmounts.
  useEffect(() => stopPlayback, []);

  // Reset playhead when user adjusts trim while paused.
  useEffect(() => {
    if (!playing) setPlayhead(trimStart);
  }, [trimStart, playing]);

  const timeToX = (t: number) => (width > 0 && duration > 0 ? (t / duration) * width : 0);
  const xToTime = (x: number) =>
    Math.max(0, Math.min(duration, (x / Math.max(1, width)) * duration));

  const startDrag = (side: "left" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: PointerEvent) => {
      const t = xToTime(ev.clientX - rect.left);
      const { start, end } = trimRef.current;
      if (side === "left") {
        onTrimChange(Math.min(t, end - MIN_TRIM_GAP), end);
      } else {
        onTrimChange(start, Math.max(t, start + MIN_TRIM_GAP));
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const barWidth = Math.max(1, width / BARS - 1);
  const barHeightMax = 60;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={playing ? stopPlayback : startPlayback}
          aria-label={playing ? "Stop preview" : "Play trimmed preview"}
        >
          {playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {trimStart.toFixed(2)}s – {trimEnd.toFixed(2)}s
          <span className="ml-2 text-muted-foreground/70">
            ({(trimEnd - trimStart).toFixed(2)}s)
          </span>
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative h-20 select-none touch-none rounded-md border bg-muted/30 overflow-hidden"
      >
        {width > 0 && (
          <>
            <svg width={width} height={80} className="absolute inset-0">
              {peaks.map((p, i) => {
                const x = (i / BARS) * width;
                const t = (i / BARS) * duration;
                const inTrim = t >= trimStart && t <= trimEnd;
                const h = Math.max(2, p * barHeightMax);
                return (
                  <rect
                    key={i}
                    x={x}
                    y={40 - h / 2}
                    width={barWidth}
                    height={h}
                    className={inTrim ? "fill-primary" : "fill-muted-foreground/30"}
                  />
                );
              })}
            </svg>

            {/* Dim regions outside the trim */}
            <div
              className="absolute inset-y-0 left-0 bg-background/60 pointer-events-none"
              style={{ width: timeToX(trimStart) }}
            />
            <div
              className="absolute inset-y-0 bg-background/60 pointer-events-none"
              style={{ left: timeToX(trimEnd), right: 0 }}
            />

            {/* Playhead */}
            {playing && (
              <div
                className="absolute inset-y-0 w-0.5 bg-foreground pointer-events-none"
                style={{ left: timeToX(playhead) }}
              />
            )}

            {/* Left handle */}
            <div
              role="slider"
              aria-label="Trim start"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={trimStart}
              onPointerDown={startDrag("left")}
              className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize flex items-center justify-center"
              style={{ left: timeToX(trimStart) }}
            >
              <div className="h-full w-1 bg-primary rounded-sm shadow" />
            </div>

            {/* Right handle */}
            <div
              role="slider"
              aria-label="Trim end"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={trimEnd}
              onPointerDown={startDrag("right")}
              className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize flex items-center justify-center"
              style={{ left: timeToX(trimEnd) }}
            >
              <div className="h-full w-1 bg-primary rounded-sm shadow" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
