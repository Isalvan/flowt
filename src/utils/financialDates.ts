export const toUtcCalendarDay = (date: Date): number =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

export const getObservedCalendarDays = (
  dates: Date[],
  now = new Date(),
): number => {
  if (dates.length < 2) return 0;

  const firstDay = Math.min(...dates.map(toUtcCalendarDay));
  const latestObservedDay = Math.max(...dates.map(toUtcCalendarDay));
  const lastDay = Math.min(toUtcCalendarDay(now), latestObservedDay);

  return Math.max(0, Math.round((lastDay - firstDay) / 86_400_000));
};
