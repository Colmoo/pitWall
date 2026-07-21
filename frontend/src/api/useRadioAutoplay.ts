import { useEffect, useRef, useState } from "react";
import type { SessionState, TeamRadioClip } from "../types";

export function useRadioAutoplay(
  state: SessionState | null,
  selectedDriver: string | null,
  autoplayEnabled: boolean,
  followedDrivers: string[],
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<TeamRadioClip[]>([]);
  const playingRef = useRef(false);
  const [nowPlaying, setNowPlaying] = useState<TeamRadioClip | null>(null);

  function playNext() {
    const clip = queueRef.current.shift();
    if (!clip) {
      playingRef.current = false;
      setNowPlaying(null);
      return;
    }
    playingRef.current = true;
    setNowPlaying(clip);
    const audio = audioRef.current;
    if (audio) {
      audio.src = clip.url;
      audio.play()?.catch(() => {});
    }
  }

  useEffect(() => {
    const clips = state?.team_radio ?? [];
    const fresh = clips.filter((c) => !seenRef.current.has(`${c.timestamp}-${c.driver_number}`));
    fresh.forEach((c) => seenRef.current.add(`${c.timestamp}-${c.driver_number}`));
    if (fresh.length === 0) return;

    // selected driver always plays, regardless of the autoplay switch
    const eligible = fresh.filter(
      (c) => c.driver_number === selectedDriver || (autoplayEnabled && followedDrivers.includes(c.driver_number)),
    );
    if (eligible.length === 0) return;

    const positionOf = (driverNumber: string) =>
      state?.drivers.find((d) => d.driver_number === driverNumber)?.position ?? Infinity;
    eligible.sort((a, b) => positionOf(a.driver_number) - positionOf(b.driver_number));

    queueRef.current.push(...eligible);
    if (!playingRef.current) playNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selectedDriver, autoplayEnabled, followedDrivers]);

  return { audioRef, nowPlaying, onEnded: playNext };
}
