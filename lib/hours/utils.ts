import type { BusinessHoursEntry } from "./types";

export function formatTime24To12(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12}:00 ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function generatePickupWindows(
  entries: BusinessHoursEntry[],
  weekday: number
): string[] {
  const entry = entries.find((e) => e.weekday === weekday);
  if (!entry) return [];

  const [openH, openM] = entry.opens.split(":").map(Number);
  const [closeH, closeM] = entry.closes.split(":").map(Number);
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;

  if (closeMins <= openMins) return [];

  const windows: string[] = [];
  let start = openMins;
  const WINDOW_SIZE = 120;

  while (start < closeMins) {
    let end = start + WINDOW_SIZE;
    if (end > closeMins) end = closeMins;
    if (end - start < 30) break;

    const fmt = (m: number) => formatTime24To12(
      `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`
    );
    windows.push(`${fmt(start)} – ${fmt(end)}`);
    start = end;
  }

  return windows;
}
