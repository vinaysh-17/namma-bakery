/**
 * Synthesizes a gentle two-tone notification chime using the Web Audio API.
 * Requires no external audio assets, works offline, zero network delay.
 * Safely handles autoplay restrictions.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playNotificationSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {
        // Autoplay policy prevented playback until user interaction
      });
    }

    const now = ctx.currentTime;

    // Master gain for pleasant, non-jarring volume
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.12, now);
    masterGain.connect(ctx.destination);

    // Tone 1: D5 (587.33 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);

    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.8, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc1.connect(gain1);
    gain1.connect(masterGain);

    osc1.start(now);
    osc1.stop(now + 0.25);

    // Tone 2: A5 (880 Hz) - slightly delayed for a cheerful chime
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.1);

    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(1.0, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc2.connect(gain2);
    gain2.connect(masterGain);

    osc2.start(now + 0.1);
    osc2.stop(now + 0.5);
  } catch {
    // Graceful fallback: do nothing if audio is blocked
  }
}

