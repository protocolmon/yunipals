const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "long" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short"
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "March 31, 2021", or with the time: "April 1, 2021 at 1:53 AM". */
export function formatAbsolute(timestamp: number, withTime = false) {
  return (withTime ? DATE_TIME : DATE).format(new Date(timestamp * 1000));
}

function plural(count: number, unit: string) {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** The same moment `count` calendar months later, clamped to the month's end. */
function addMonths(date: Date, count: number) {
  const target = new Date(date);
  target.setDate(1);
  target.setMonth(target.getMonth() + count);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/**
 * Relative time spelled out: years, months and days ("5 years 7 months 10 days
 * ago"); within the last two days, hours and minutes too ("1 day 2 hours 14
 * minutes ago"). Weeks are never used.
 */
export function formatRelative(timestamp: number, now = Date.now()) {
  const from = new Date(Math.min(timestamp * 1000, now));
  const to = new Date(now);
  const elapsed = to.getTime() - from.getTime();
  if (elapsed < MINUTE) return "just now";

  const parts: string[] = [];
  if (elapsed < 2 * DAY) {
    const days = Math.floor(elapsed / DAY);
    const hours = Math.floor(elapsed / HOUR) % 24;
    const minutes = Math.floor(elapsed / MINUTE) % 60;
    if (days) parts.push(plural(days, "day"));
    if (hours) parts.push(plural(hours, "hour"));
    if (minutes) parts.push(plural(minutes, "minute"));
  } else {
    // Whole calendar months first (a month-end date is clamped to the
    // shorter month, so January 31 plus one month is February 28), then the
    // days that remain. The remainder can never be negative.
    let total =
      (to.getFullYear() - from.getFullYear()) * 12 +
      to.getMonth() -
      from.getMonth();
    let anchor = addMonths(from, total);
    if (anchor > to) {
      total -= 1;
      anchor = addMonths(from, total);
    }
    const years = Math.floor(total / 12);
    const months = total % 12;
    const days = Math.floor((to.getTime() - anchor.getTime()) / DAY);
    if (years) parts.push(plural(years, "year"));
    if (months) parts.push(plural(months, "month"));
    if (days) parts.push(plural(days, "day"));
  }
  return `${parts.join(" ")} ago`;
}
