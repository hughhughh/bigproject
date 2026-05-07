import { DateTime } from "luxon";

export const SYDNEY_TZ = "Australia/Sydney";

export function currentMondayYmd(): string {
  const now = DateTime.now().setZone(SYDNEY_TZ);
  const monday = now.minus({ days: now.weekday - 1 }).startOf("day");
  return monday.toISODate()!;
}

/** `weekStartYmd` is the calendar Monday in Sydney (yyyy-MM-dd). */
export function weekRangeUtcFromMonday(weekStartYmd: string): { fromUtc: Date; toUtc: Date } {
  const start = DateTime.fromISO(weekStartYmd, { zone: SYDNEY_TZ }).startOf("day");
  const end = start.plus({ days: 7 });
  return { fromUtc: start.toUTC().toJSDate(), toUtc: end.toUTC().toJSDate() };
}
