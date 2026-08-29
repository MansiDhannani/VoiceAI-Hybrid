import React, { useEffect, useRef } from "react";

interface Props {
  audioChunks: string[]; // base64 WAV chunks
}

export default function AudioPlayer({ audioChunks }: Props) {
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<AudioBuffer[]>([]);
  const playingRef = useRef(false);

  const drain = () => {
    if (!ctxRef.current || queueRef.current.length === 0) {
      playingRef.current = false;
      return;
    }
    playingRef.current = true;
    const buf = queueRef.current.shift()!;
    const src = ctxRef.current.createBufferSource();
    src.buffer = buf;
    src.connect(ctxRef.current.destination);
    src.onended = drain;
    src.start();
  };

  useEffect(() => {
    const last = audioChunks[audioChunks.length - 1];
    if (!last) return;

    (async () => {
      if (!ctxRef.current) ctxRef.current = new AudioContext();
      const raw = atob(last);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const buf = await ctxRef.current.decodeAudioData(bytes.buffer.slice(0));
      queueRef.current.push(buf);
      if (!playingRef.current) drain();
    })();
  }, [audioChunks]);

  return null; // audio plays automatically, no UI needed
}
