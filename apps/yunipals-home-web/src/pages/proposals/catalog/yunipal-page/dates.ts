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
    let years = to.getFullYear() - from.getFullYear();
    let months = to.getMonth() - from.getMonth();
    let days = to.getDate() - from.getDate();
    if (days < 0) {
      months -= 1;
      days += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years) parts.push(plural(years, "year"));
    if (months) parts.push(plural(months, "month"));
    if (days) parts.push(plural(days, "day"));
  }
  return `${parts.join(" ")} ago`;
}
