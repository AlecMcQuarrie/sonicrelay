import { useEffect, useRef } from "react";

interface CameraPreviewProps {
  deviceId: string;
}

// Standalone 16:9 live camera preview. Uses its own getUserMedia so it
// works outside a voice call, and releases the stream on unmount.
export default function CameraPreview({ deviceId }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    navigator.mediaDevices.getUserMedia({
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: 640, height: 360, frameRate: 15 }
        : { width: 640, height: 360, frameRate: 15 },
      audio: false,
    }).then((s) => {
      if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (videoRef.current) videoRef.current.srcObject = s;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [deviceId]);

  return (
    <div className="aspect-video w-full rounded-md bg-muted overflow-hidden">
      <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
    </div>
  );
}
