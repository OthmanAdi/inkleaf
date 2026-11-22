/**
 * Compact parameter tables. Each row is `[default, min, max, unit, help]`; `numDefs` turns a table into `tunable()`
 * definitions and `defaults` into a plain value record, so pure layout and math code can run in tests with the same
 * numbers the registry exposes at runtime.
 */
export type Row = readonly [value: number, min: number, max: number, unit: string, help: string];
export type Table = Readonly<Record<string, Row>>;

export interface NumDef { value: number; min: number; max: number; unit: string; help: string }

export function numDefs<T extends Table>(table: T): { [K in keyof T]: NumDef } {
  const out = {} as Record<string, NumDef>;
  for (const [k, r] of Object.entries(table)) out[k] = { value: r[0], min: r[1], max: r[2], unit: r[3], help: r[4] };
  return out as { [K in keyof T]: NumDef };
}

export type Values<T extends Table> = { [K in keyof T]: number };

export function defaults<T extends Table>(table: T): Values<T> {
  const out = {} as Record<string, number>;
  for (const [k, r] of Object.entries(table)) out[k] = r[0];
  return out as Values<T>;
}
