/**
 * `tunable()` turns a block of defaults into a live config object and registers it, so any number an animation,
 * light or effect reads is also an editable, named parameter.
 *
 *   const turn = tunable(registry, {
 *     id: 'book.turn', label: 'Page turn', kind: 'animation', tags: ['animation', 'book'],
 *     params: {
 *       duration: { value: 1.1, min: 0.2, max: 4, unit: 's', help: 'Seconds for one leaf to turn' },
 *       ease: { value: 'inOutCubic', options: EASE_NAMES },
 *     },
 *   });
 *   turn.duration  // read every frame; inkleaf.set('book.turn', 'duration', 1.6) changes it live
 */
import type { Color } from 'three';
import type { EntityInit, ParamSpec, ParamType, ParamValue, Registry, Tag } from './registry';

interface NumberDef { value: number; min?: number; max?: number; step?: number; unit?: string; help?: string; label?: string }
interface BoolDef { value: boolean; help?: string; label?: string }
interface EnumDef { value: string; options: readonly string[]; help?: string; label?: string }
interface StringDef { value: string; help?: string; label?: string; color?: boolean }
interface VecDef { value: readonly number[]; help?: string; label?: string; unit?: string }

export type Def = NumberDef | BoolDef | EnumDef | StringDef | VecDef;

type ValueOf<D> = D extends NumberDef ? number : D extends BoolDef ? boolean : D extends EnumDef ? string : D extends StringDef ? string : D extends VecDef ? number[] : never;

export type Tuned<P extends Record<string, Def>> = { [K in keyof P]: ValueOf<P[K]> };

export interface TunableInit<P extends Record<string, Def>> extends Omit<EntityInit, 'params'> {
  params: P;
  /** Called after any parameter changes, with the key that changed. */
  onChange?: (key: keyof P & string) => void;
}

const human = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function typeOf(d: Def): ParamType {
  if ('options' in d) return 'enum';
  if (typeof d.value === 'number') return 'number';
  if (typeof d.value === 'boolean') return 'boolean';
  if (Array.isArray(d.value)) return d.value.length === 2 ? 'vector2' : 'vector3';
  if ('color' in d && d.color) return 'color';
  if (typeof d.value === 'string' && /^#[0-9a-f]{6}$/i.test(d.value)) return 'color';
  return 'string';
}

export function tunable<P extends Record<string, Def>>(registry: Registry, init: TunableInit<P>): Tuned<P> {
  const values = {} as Record<string, ParamValue>;
  const params: ParamSpec[] = [];
  for (const [key, d] of Object.entries(init.params)) {
    values[key] = Array.isArray(d.value) ? [...d.value] : d.value;
    const t = typeOf(d);
    params.push({
      key,
      label: d.label ?? human(key),
      type: t,
      help: d.help,
      unit: 'unit' in d ? d.unit : undefined,
      min: 'min' in d ? d.min : undefined,
      max: 'max' in d ? d.max : undefined,
      step: 'step' in d ? d.step : undefined,
      options: 'options' in d ? d.options : undefined,
      get: () => values[key] as ParamValue,
      set: (v: ParamValue) => {
        values[key] = Array.isArray(v) ? [...v] : v;
        init.onChange?.(key as keyof P & string);
      },
    });
  }
  const { params: _p, onChange: _o, ...rest } = init;
  registry.add({ ...rest, params });
  return values as Tuned<P>;
}

/** Registers a three.js Color as an editable hex parameter list entry. */
export function colorParam(key: string, label: string, color: Color, help?: string): ParamSpec<string> {
  return { key, label, type: 'color', help, get: () => '#' + color.getHexString(), set: (v) => void color.set(v) };
}

/** Registers a numeric property of any object as a parameter. */
export function numberParam<T extends object>(obj: T, prop: keyof T & string, label: string, opts: Omit<NumberDef, 'value' | 'label'> = {}): ParamSpec<number> {
  return {
    key: prop,
    label,
    type: 'number',
    ...opts,
    get: () => obj[prop] as unknown as number,
    set: (v) => {
      (obj as Record<string, unknown>)[prop] = v;
    },
  };
}

export function boolParam<T extends object>(obj: T, prop: keyof T & string, label: string, help?: string): ParamSpec<boolean> {
  return {
    key: prop,
    label,
    type: 'boolean',
    help,
    get: () => obj[prop] as unknown as boolean,
    set: (v) => {
      (obj as Record<string, unknown>)[prop] = v;
    },
  };
}

export type { Tag };
