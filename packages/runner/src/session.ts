/**
 * Returns the trading session label for a given UTC timestamp.
 *
 * Weekend windows (market closed):
 *   - Friday  DOW=5, hour >= 21
 *   - Saturday DOW=6, all hours
 *   - Sunday  DOW=0, hour < 21
 *
 * Weekday hour windows (UTC, per the brief):
 *   overlap_ny_london: 12–15 (takes precedence; hours 12,13,14,15)
 *   london:            07–11 (07–12 exclusive of overlap; hours 7..11)
 *   ny:                16–20 (12–21 minus overlap; hours 16..20)
 *   asia:              22–06 (wraps midnight; hours 22,23,0..6)
 *   off:               hour 21 (gap between NY close and Asia open)
 *
 * The brief specifies:
 *   asia     22–07  → h >= 22 || h < 7
 *   london   07–16  → h >= 7 && h < 12  (overlap takes 12–16)
 *   ny       12–21  → h >= 16 && h < 21 (overlap takes 12–16)
 *   overlap  12–16  → h >= 12 && h < 16
 */
export function sessionForUtc(ms: number): "asia" | "london" | "ny" | "overlap_ny_london" | "off" {
  const dt = new Date(ms);
  const dow = dt.getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const h = dt.getUTCHours();

  // Weekend / market-closed windows
  if (dow === 6) return "off"; // All of Saturday
  if (dow === 5 && h >= 21) return "off"; // Friday from 21:00
  if (dow === 0 && h < 21) return "off"; // Sunday before 21:00

  // Weekday (and Sun >= 21 / Fri < 21) session windows
  // Check overlap first (takes precedence over london/ny in 12–16)
  if (h >= 12 && h < 16) return "overlap_ny_london";
  if (h >= 7 && h < 12) return "london";
  if (h >= 16 && h < 21) return "ny";
  if (h >= 22 || h < 7) return "asia";
  // h === 21: gap between NY close (21) and Asia open (22)
  return "off";
}
