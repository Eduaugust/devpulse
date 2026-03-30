import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Get the system's IANA timezone name (e.g., "America/Sao_Paulo").
 */
export function getSystemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Resolve the effective IANA timezone from the setting value.
 * Empty/auto → system timezone.
 */
function resolveTimezone(settingValue: string): string {
  return settingValue || getSystemTimezone();
}

/**
 * Get the UTC offset string (e.g., "-03:00") for a given IANA timezone
 * at a specific point in time (defaults to now).
 */
export function getTimezoneOffset(settingValue: string, date?: Date): string {
  const tz = resolveTimezone(settingValue);
  return ianaToOffset(tz, date ?? new Date());
}

/**
 * Convert an IANA timezone name to a UTC offset string at the given date.
 * Handles DST transitions correctly.
 */
function ianaToOffset(tz: string, date: Date): string {
  // Format with the target timezone to extract offset parts
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(date);

  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // tzPart is like "GMT-03:00" or "GMT+05:30" or "GMT"
  const match = tzPart.match(/GMT([+-]\d{2}:\d{2})/);
  if (match) return match[1];
  // GMT with no offset means +00:00
  if (tzPart === "GMT") return "+00:00";

  // Fallback: compute from local offset
  const offsetMin = date.getTimezoneOffset();
  const sign = offsetMin <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Returns today's date string (YYYY-MM-DD) in the user's configured timezone.
 */
export function toLocalDateString(): string {
  const { getSetting } = useSettingsStore.getState();
  const tz = resolveTimezone(getSetting("timezone", ""));
  return dateInTimezone(new Date(), tz);
}

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone.
 */
function dateInTimezone(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date); // en-CA gives YYYY-MM-DD
}

/**
 * Returns the current configured timezone offset string.
 * Convenience wrapper that reads from settingsStore.
 */
export function getCurrentTimezoneOffset(): string {
  const { getSetting } = useSettingsStore.getState();
  return getTimezoneOffset(getSetting("timezone", ""));
}

/**
 * Get all available IANA timezone names, sorted by offset then name.
 * Returns objects with { value, label, offset } for use in a <select>.
 */
interface TzOption {
  value: string;
  label: string;
  offsetMinutes: number;
}

export function getTimezoneOptions(): { value: string; label: string }[] {
  const now = new Date();
  const zones: string[] = (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone");

  const withOffset: TzOption[] = zones.map((tz: string) => {
    const offset = ianaToOffset(tz, now);
    // "America/Sao_Paulo" → "Sao Paulo"
    const city = tz.split("/").pop()!.replace(/_/g, " ");
    return {
      value: tz,
      label: `(UTC${offset}) ${city}`,
      offsetMinutes: parseOffsetToMinutes(offset),
    };
  });

  // Sort by offset, then city name
  withOffset.sort((a: TzOption, b: TzOption) => a.offsetMinutes - b.offsetMinutes || a.label.localeCompare(b.label));

  return withOffset.map(({ value, label }: TzOption) => ({ value, label }));
}

function parseOffsetToMinutes(offset: string): number {
  const match = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) return 0;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}
