const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

export function saoPauloDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function offsetSaoPauloDateKey(offsetDays = 0, date = new Date()): string {
  const [year, month, day] = saoPauloDateKey(date).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}
