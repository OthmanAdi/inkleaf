import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { Registry } from './registry';
import { tunable } from './tune';

describe('Registry', () => {
  it('registers entities and finds them by id, tag, prefix and query', () => {
    const r = new Registry();
    r.add({ id: 'light.key', label: 'Key light', tags: ['light', 'shadow'], kind: 'spot-light' });
    r.add({ id: 'light.fill', label: 'Fill light', tags: ['light'], kind: 'hemisphere-light' });
    r.add({ id: 'book.turn', label: 'Page turn', tags: ['animation', 'book'], kind: 'animation', describe: 'How a leaf turns' });
    expect(r.get('light.key')?.label).toBe('Key light');
    expect(r.byTag('light').map((e) => e.id)).toEqual(['light.key', 'light.fill']);
    expect(r.byTag('light', 'shadow').map((e) => e.id)).toEqual(['light.key']);
    expect(r.list('light').length).toBe(2);
    expect(r.query('tag:animation leaf').map((e) => e.id)).toEqual(['book.turn']);
    expect(r.query('id:light.*').length).toBe(2);
    expect(r.query('kind:spot-light').length).toBe(1);
  });

  it('rejects bad and duplicate ids', () => {
    const r = new Registry();
    expect(() => r.add({ id: 'Bad Id', label: '', tags: [], kind: 'x' })).toThrow(/kebab-case/);
    r.add({ id: 'a.b', label: '', tags: [], kind: 'x' });
    expect(() => r.add({ id: 'a.b', label: '', tags: [], kind: 'x' })).toThrow(/already/);
  });

  it('names and tags the three.js object it registers', () => {
    const r = new Registry();
    const o = new Object3D();
    r.add({ id: 'desk.top', label: 'Desk', tags: ['desk', 'object'], kind: 'mesh', object: o });
    expect(o.name).toBe('desk.top');
    expect(o.userData.inkleaf).toEqual({ id: 'desk.top', tags: ['desk', 'object'] });
  });

  it('sets parameters live, clamps numbers, checks enums and emits changes', () => {
    const r = new Registry();
    const cfg = tunable(r, {
      id: 'book.turn',
      label: 'Page turn',
      kind: 'animation',
      tags: ['animation'],
      params: { duration: { value: 1.1, min: 0.2, max: 4 }, ease: { value: 'inOutCubic', options: ['linear', 'inOutCubic'] } },
    });
    const seen = vi.fn();
    r.on(seen);
    expect(r.set('book.turn', 'duration', 9)).toBe(true);
    expect(cfg.duration).toBe(4);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(r.set('book.turn', 'ease', 'bounce')).toBe(false);
    expect(cfg.ease).toBe('inOutCubic');
    expect(seen).toHaveBeenCalledWith({ type: 'change', id: 'book.turn', key: 'duration', value: 4 });
  });

  it('keeps overrides for entities that register later', () => {
    const r = new Registry();
    r.apply({ 'post.bloom': { intensity: 3 } });
    const cfg = tunable(r, { id: 'post.bloom', label: 'Bloom', kind: 'post-effect', tags: ['post'], params: { intensity: { value: 2 } } });
    expect(cfg.intensity).toBe(3);
  });

  it('snapshots and describes for agents', () => {
    const r = new Registry();
    tunable(r, { id: 'light.key', label: 'Key', kind: 'spot-light', tags: ['light'], params: { intensity: { value: 2, unit: 'cd' }, color: { value: '#fff4e0' } } });
    expect(r.snapshot()).toEqual({ 'light.key': { intensity: 2, color: '#fff4e0' } });
    const text = r.describe('light');
    expect(text).toContain('light.key  [spot-light]');
    expect(text).toContain('intensity = 2 cd');
    expect(r.get('light.key')?.params.find((p) => p.key === 'color')?.type).toBe('color');
  });

  it('removes a whole subtree', () => {
    const r = new Registry();
    r.add({ id: 'lesson-2', label: '', tags: [], kind: 'lesson' });
    r.add({ id: 'lesson-2.bob', label: '', tags: [], kind: 'ink-object' });
    r.add({ id: 'lesson-20', label: '', tags: [], kind: 'lesson' });
    r.removeTree('lesson-2');
    expect(r.list().map((e) => e.id)).toEqual(['lesson-20']);
  });
});
