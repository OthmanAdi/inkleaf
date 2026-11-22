# Registry and tags

The engine's `Registry` makes scene entities discoverable by ID, tag, kind, label and description. The browser inspector uses the same registry to filter entries, edit declared parameters and copy a `tune` block. The swing demo creates its registry in `src/main.ts` and opens the inspector with its button, `?inspect`, or Shift+I.

## Register entities with useful metadata

Each `EntityInit` has an ID, label, `kind`, tags, optional description, parent ID, Three.js object, parameter specs and source path. IDs use lowercase dotted kebab-case, for example `lesson-2.swing.bob`. Keep IDs stable because tests, tune overrides and parent-child removal can refer to them.

Use plain labels and one or two descriptive sentences. Add `parent` for entities that belong to a lesson, component or object group. Set `source` to the project-relative module or manifest where a maintainer can make a structural change.

Expose live-editable values as `ParamSpec` entries with a key, label, type, `get` and `set`. For numeric values, include units, min/max, step and a short help string where applicable. Bounds are enforced for numeric parameters. Invalid enum choices are rejected. Keep defaults useful for the authored scene.

```ts
registry.add({
  id: 'lesson-2.swing.bob',
  label: 'Pendulum bob',
  kind: 'mesh',
  tags: ['object', 'lesson', 'physics'],
  parent: 'lesson-2.swing',
  source: 'src/demo/figure.ts',
  describe: 'The bob whose height and speed change during the swing.',
  params: [{
    key: 'mass', label: 'Mass', type: 'number', unit: 'kg', min: 0.01, max: 5, step: 0.01,
    help: 'Mass used by the pendulum model.',
    get: () => mass,
    set: value => { mass = Number(value); },
  }],
});
```

## Shared tag vocabulary

`src/engine/core/registry.ts` exports the current vocabulary:

`object light shadow material shader texture animation camera control input ui effect post sound text layout physics data a11y energy ink paper book desk lens lesson figure flow store interaction quality environment`

Tags are extensible. `Registry.byTag(...tags)` returns entities carrying every requested tag, so combine tags to narrow results, such as `registry.byTag('light', 'shadow')`. Use the closest shared terms and add a domain-specific tag only when it makes a real group easier to find.

## Query and tune

The registry API is available to the code that owns the `Registry` instance:

```ts
registry.get('lesson-2.swing.bob');
registry.query('tag:physics lesson');
registry.query('kind:mesh');
registry.query('id:lesson-2.*');
registry.describe('tag:physics lesson');
registry.set('lesson-2.swing.bob', 'mass', 0.3);
registry.snapshot('lesson-2');
```

Words in `query()` are ANDed and match IDs, labels or descriptions. `tag:`, `kind:` and `id:` filters are supported; an `id:` value ending in `*` matches a prefix. `set()` changes a live parameter and can queue an override before the entity registers. `apply()` accepts an object keyed by entity ID and parameter. `snapshot()` returns current values for declared parameters.

Use the browser inspector for visual tuning. Its search field uses the registry query syntax; changed values can be copied as a `tune` block. Keep structural edits in the named source module and update the entity metadata if its role or controls change. Use the `Registry` instance owned by the app or test for queries and tuning. The project provides no command-line registry API.
