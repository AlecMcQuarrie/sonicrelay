import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";

interface PttKeyCaptureProps {
  value: string;
  onChange: (key: string) => void;
}

// Single-key capture. Click to record, the next keydown becomes the bind.
// Escape clears the binding. Keeps things simple — no modifier chords.
export default function PttKeyCapture({ value, onChange }: PttKeyCaptureProps) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        onChange('');
      } else {
        onChange(e.key);
      }
      setRecording(false);
    };
    // Defer attach by one tick so the click that started recording doesn't
    // immediately get captured as a keydown.
    const timer = setTimeout(() => {
      window.addEventListener('keydown', handler, { capture: true });
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handler, { capture: true });
    };
  }, [recording, onChange]);

  const display = recording
    ? 'Press a key…'
    : value
      ? (value === ' ' ? 'Space' : value.length === 1 ? value.toUpperCase() : value)
      : 'Not set';

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="flex-1 justify-center font-mono"
        onClick={() => setRecording(true)}
      >
        {display}
      </Button>
      {value && !recording && (
        <Button variant="ghost" size="sm" onClick={() => onChange('')}>Clear</Button>
      )}
    </div>
  );
}
