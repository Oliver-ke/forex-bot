import { readFile } from "node:fs/promises";
import { type CalendarEvent, CalendarEventSchema } from "@forex-bot/contracts";

/**
 * Load a JSON array of macro calendar events and validate each element
 * through `CalendarEventSchema`. On any validation failure, the error
 * message includes the source file path.
 */
export async function loadCalendar(path: string): Promise<readonly CalendarEvent[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`loadCalendar: failed to read ${path}: ${stringifyError(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`loadCalendar: invalid JSON at ${path}: ${stringifyError(err)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`loadCalendar: expected an array at ${path}`);
  }

  const events: CalendarEvent[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const result = CalendarEventSchema.safeParse(parsed[i]);
    if (!result.success) {
      throw new Error(`loadCalendar: invalid element ${i} in ${path}: ${result.error.message}`);
    }
    events.push(result.data);
  }

  return events;
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
