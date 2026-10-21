// Início do dia no calendário de São Paulo, como instante UTC. O servidor
// (Vercel) roda em UTC, então setHours(0,0,0,0) virava o dia às 21h de Brasília.
// O offset vem do próprio fuso (Intl), nunca de um valor fixo.

const TIME_ZONE = "America/Sao_Paulo";

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(instant: Date) {
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Offset do fuso no instante dado, em ms (São Paulo hoje: -3 h).
function offsetAt(instant: Date) {
  const p = zonedParts(instant);
  const wallClockAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export function saoPauloDayStart(now: Date = new Date()): Date {
  const { year, month, day } = zonedParts(now);
  const midnightAsUtc = Date.UTC(year, month - 1, day);
  // 1ª estimativa com o offset de agora; a 2ª usa o offset da própria meia-noite
  // (cobre uma eventual mudança de horário entre a meia-noite e agora).
  const guess = midnightAsUtc - offsetAt(now);
  return new Date(midnightAsUtc - offsetAt(new Date(guess)));
}
