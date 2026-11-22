/**
 * The registry: every object, light, shadow, material, animation, control, effect, sound and UI part of a world
 * is registered here with a stable id, a human label and tags. A coding agent (or a person in the inspector)
 * finds things by id or tag and changes their parameters by name, live.
 *
 *   inkleaf.registry.get('light.key').params           -> what can be changed
 *   inkleaf.set('light.key', 'intensity', 2.4)          -> change it now
 *   inkleaf.registry.byTag('animation', 'book')         -> every book animation
 */
import type { Object3D } from 'three';

/** The shared tag vocabulary. Worlds may add their own tags; these are the ones the engine uses. */
export const TAGS = [
  'object', 'light', 'shadow', 'material', 'shader', 'texture', 'animation', 'camera', 'control', 'input',
  'ui', 'effect', 'post', 'sound', 'text', 'layout', 'physics', 'data', 'a11y', 'energy', 'ink', 'paper',
  'book', 'desk', 'lens', 'lesson', 'figure', 'flow', 'store', 'interaction', 'quality', 'environment',
] as const;
export type KnownTag = (typeof TAGS)[number];
export type Tag = KnownTag | (string & {});

export type ParamType = 'number' | 'color' | 'boolean' | 'enum' | 'string' | 'vector3' | 'vector2';
export type ParamValue = number | string | boolean | readonly number[];

export interface ParamSpec<T extends ParamValue = ParamValue> {
  key: string;
  label: string;
  type: ParamType;
  /** Shown in the inspector and in `describe()`: what the number does, in plain words. */
  help?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  get(): T;
  set(value: T): void;
}

export interface EntityInit {
  /** Stable, dotted, kebab-case id, for example `light.key`, `book.turn`, `lesson-2.pendulum.bob`. */
  id: string;
  label: string;
  tags: readonly Tag[];
  /** What sort of thing this is: `spot-light`, `ink-object`, `animation`, `post-effect`, ... */
  kind: string;
  /** One or two sentences an agent can read to understand the entity. */
  describe?: string;
  parent?: string;
  object?: Object3D;
  params?: readonly ParamSpec[];
  /** Where to change it in source: a manifest path or a module path. */
  source?: string;
}

export interface Entity extends EntityInit {
  readonly tags: readonly Tag[];
  readonly params: readonly ParamSpec[];
}

export type RegistryEvent =
  | { type: 'add'; entity: Entity }
  | { type: 'remove'; id: string }
  | { type: 'change'; id: string; key: string; value: ParamValue };

type Listener = (event: RegistryEvent) => void;

const ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/;

export class Registry {
  private readonly entities = new Map<string, Entity>();
  private readonly listeners = new Set<Listener>();
  /** Overrides from the world manifest or the URL, applied when a matching entity registers. */
  private readonly pending = new Map<string, Map<string, ParamValue>>();

  add(init: EntityInit): Entity {
    if (!ID.test(init.id)) throw new Error(`inkleaf: entity id "${init.id}" must be dotted kebab-case, for example "light.key"`);
    if (this.entities.has(init.id)) throw new Error(`inkleaf: entity id "${init.id}" is already registered`);
    const entity: Entity = { ...init, tags: [...new Set(init.tags)], params: init.params ?? [] };
    this.entities.set(entity.id, entity);
    if (entity.object) {
      entity.object.name ||= entity.id;
      entity.object.userData.inkleaf = { id: entity.id, tags: entity.tags };
    }
    const waiting = this.pending.get(entity.id);
    if (waiting) {
      for (const [key, value] of waiting) this.applyParam(entity, key, value);
      this.pending.delete(entity.id);
    }
    this.emit({ type: 'add', entity });
    return entity;
  }

  remove(id: string): void {
    const e = this.entities.get(id);
    if (!e) return;
    this.entities.delete(id);
    if (e.object?.userData.inkleaf?.id === id) delete e.object.userData.inkleaf;
    this.emit({ type: 'remove', id });
  }

  /** Removes an entity and every entity whose id starts with `${prefix}.`. */
  removeTree(prefix: string): void {
    for (const id of [...this.entities.keys()]) if (id === prefix || id.startsWith(prefix + '.')) this.remove(id);
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  /** Every entity that carries all the given tags. */
  byTag(...tags: Tag[]): Entity[] {
    return this.list().filter((e) => tags.every((t) => e.tags.includes(t)));
  }

  /** All entities, or those whose id starts with a prefix, in registration order. */
  list(prefix?: string): Entity[] {
    const all = [...this.entities.values()];
    return prefix ? all.filter((e) => e.id === prefix || e.id.startsWith(prefix + '.')) : all;
  }

  /**
   * A small query language for agents: words are ANDed. `tag:light`, `kind:spot-light`, `id:book.*`, or a plain
   * word that matches the id, label or description.
   */
  query(q: string): Entity[] {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.list().filter((e) =>
      words.every((w) => {
        if (w.startsWith('tag:')) return e.tags.includes(w.slice(4));
        if (w.startsWith('kind:')) return e.kind === w.slice(5);
        if (w.startsWith('id:')) {
          const pat = w.slice(3);
          return pat.endsWith('*') ? e.id.startsWith(pat.slice(0, -1)) : e.id === pat;
        }
        return e.id.includes(w) || e.label.toLowerCase().includes(w) || (e.describe ?? '').toLowerCase().includes(w);
      }),
    );
  }

  getParam(id: string, key: string): ParamValue | undefined {
    return this.entities.get(id)?.params.find((p) => p.key === key)?.get();
  }

  /** Changes a parameter now. Before the entity exists the value is kept and applied when it registers. */
  set(id: string, key: string, value: ParamValue): boolean {
    const e = this.entities.get(id);
    if (!e) {
      let m = this.pending.get(id);
      if (!m) this.pending.set(id, (m = new Map()));
      m.set(key, value);
      return false;
    }
    return this.applyParam(e, key, value);
  }

  /** Applies many overrides at once: `{ 'light.key': { intensity: 2 }, 'book.turn': { duration: 1.4 } }`. */
  apply(overrides: Readonly<Record<string, Readonly<Record<string, ParamValue>>>>): void {
    for (const [id, params] of Object.entries(overrides)) for (const [k, v] of Object.entries(params)) this.set(id, k, v);
  }

  /** Current values of every parameter, ready to paste back into a world manifest's `tune` block. */
  snapshot(prefix?: string): Record<string, Record<string, ParamValue>> {
    const out: Record<string, Record<string, ParamValue>> = {};
    for (const e of this.list(prefix)) {
      if (!e.params.length) continue;
      out[e.id] = Object.fromEntries(e.params.map((p) => [p.key, p.get()]));
    }
    return out;
  }

  /** Plain-text description of entities for an agent: id, kind, tags, label, params with current values. */
  describe(prefixOrQuery = ''): string {
    const list = prefixOrQuery.includes(':') || prefixOrQuery.includes(' ') ? this.query(prefixOrQuery) : this.list(prefixOrQuery || undefined);
    return list
      .map((e) => {
        const head = `${e.id}  [${e.kind}]  ${e.label}  #${e.tags.join(' #')}`;
        const desc = e.describe ? `\n    ${e.describe}` : '';
        const params = e.params
          .map((p) => `\n    - ${p.key} = ${JSON.stringify(p.get())}${p.unit ? ' ' + p.unit : ''}${p.min !== undefined ? `  (${p.min}..${p.max})` : ''}${p.options ? `  {${p.options.join('|')}}` : ''}${p.help ? `  ${p.help}` : ''}`)
          .join('');
        return head + desc + params + (e.source ? `\n    source: ${e.source}` : '');
      })
      .join('\n');
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private applyParam(e: Entity, key: string, value: ParamValue): boolean {
    const p = e.params.find((q) => q.key === key);
    if (!p) {
      console.warn(`inkleaf: "${e.id}" has no parameter "${key}". It has: ${e.params.map((q) => q.key).join(', ') || 'none'}`);
      return false;
    }
    let v: ParamValue = value;
    if (p.type === 'number' && typeof v === 'number') {
      if (p.min !== undefined) v = Math.max(p.min, v);
      if (p.max !== undefined) v = Math.min(p.max, v);
    }
    if (p.type === 'enum' && p.options && !p.options.includes(String(v))) {
      console.warn(`inkleaf: "${e.id}.${key}" must be one of ${p.options.join(', ')}`);
      return false;
    }
    p.set(v as never);
    this.emit({ type: 'change', id: e.id, key, value: v });
    return true;
  }

  private emit(ev: RegistryEvent): void {
    for (const fn of this.listeners) fn(ev);
  }
}
