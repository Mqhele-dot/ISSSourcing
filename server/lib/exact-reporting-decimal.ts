/** Decimal arithmetic for reporting only. Never routes money through IEEE-754. */
export type ExactDecimal = { coefficient: bigint; scale: number };
export function parseReportingDecimal(value: string): ExactDecimal {
  if (typeof value !== "string" || value.length > 128 || !/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("Invalid decimal evidence");
  const [whole, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}
export function addReportingDecimals(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  const scale = Math.max(a.scale, b.scale);
  return { coefficient: a.coefficient * 10n ** BigInt(scale - a.scale) + b.coefficient * 10n ** BigInt(scale - b.scale), scale };
}
export function multiplyReportingDecimals(a: ExactDecimal, b: ExactDecimal): ExactDecimal {
  return { coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale };
}
/** Round half away from zero, including compensating reversals. */
export function formatReportingDecimal(value: ExactDecimal, places: number): string {
  if (!Number.isInteger(places) || places < 0 || places > 128) throw new Error("Invalid decimal precision");
  let coefficient = value.coefficient;
  if (value.scale > places) {
    const divisor = 10n ** BigInt(value.scale - places);
    const sign = coefficient < 0n ? -1n : 1n;
    const absolute = coefficient * sign;
    coefficient = sign * (absolute / divisor + (absolute % divisor * 2n >= divisor ? 1n : 0n));
  } else coefficient *= 10n ** BigInt(places - value.scale);
  const digits = (coefficient < 0n ? -coefficient : coefficient).toString().padStart(places + 1, "0");
  return `${coefficient < 0n ? "-" : ""}${places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits}`;
}
