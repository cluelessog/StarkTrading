// NSE holidays for 2026 (source: NSE website)
// Update annually
const NSE_HOLIDAYS_2026: string[] = [
  '2026-01-26', // Republic Day
  '2026-03-10', // Maha Shivaratri
  '2026-03-17', // Holi
  '2026-03-31', // Id-Ul-Fitr (Eid)
  '2026-04-02', // Ram Navami
  '2026-04-03', // Mahavir Jayanti
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-04-18', // Good Friday
  '2026-05-01', // Maharashtra Day
  '2026-06-07', // Bakrid (Eid ul-Adha)
  '2026-07-07', // Muharram
  '2026-08-15', // Independence Day
  '2026-08-16', // Parsi New Year
  '2026-09-05', // Milad-un-Nabi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra (Vijaya Dashami)
  '2026-10-21', // Dussehra holiday
  '2026-11-09', // Diwali (Laxmi Puja)
  '2026-11-10', // Diwali Balipratipada
  '2026-11-30', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
];

function getHolidaySet(customHolidays?: string[]): Set<string> {
  const holidays = customHolidays && customHolidays.length > 0
    ? customHolidays
    : NSE_HOLIDAYS_2026;
  return new Set(holidays);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isTradingDay(date: string, customHolidays?: string[]): boolean {
  const d = new Date(date + 'T00:00:00');
  const day = d.getDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const holidays = getHolidaySet(customHolidays);
  return !holidays.has(date);
}

export function previousTradingDay(date: string, customHolidays?: string[]): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  let candidate = formatDate(d);
  while (!isTradingDay(candidate, customHolidays)) {
    d.setDate(d.getDate() - 1);
    candidate = formatDate(d);
  }
  return candidate;
}

export function nextTradingDay(date: string, customHolidays?: string[]): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  let candidate = formatDate(d);
  while (!isTradingDay(candidate, customHolidays)) {
    d.setDate(d.getDate() + 1);
    candidate = formatDate(d);
  }
  return candidate;
}

export function tradingDaysBetween(from: string, to: string, customHolidays?: string[]): number {
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T00:00:00');
  let count = 0;
  const cursor = new Date(fromDate);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor < toDate) {
    if (isTradingDay(formatDate(cursor), customHolidays)) {
      count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}
