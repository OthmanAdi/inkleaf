# Finding and changing anything by name

Every part of an inkleaf world is registered while it is built: objects, lights, shadow settings, materials, shaders, textures, animations, camera poses, controls, post effects, sounds and UI parts. Each entry has:

| Field | Example | Meaning |
|---|---|---|
| `id` | `light.key`, `book.turn`, `lesson-2.swing.bob` | Stable, dotted, kebab-case. The first part is the owner: `stage`, `light`, `post`, `book`, `page`, `ink`, `energy`, `physics`, `camera`, `input`, `lens`, `ui`, `sound`, `nav`, `runtime`, `lesson-N`. |
| `label` | `Key light` | Human words. |
| `tags` | `light`, `shadow` | From the shared vocabulary below; a world may add its own. |
| `kind` | `spot-light`, `animation`, `ink-object`, `post-effect` | What sort of thing it is. |
| `params` | `intensity`, `angle`, `penumbra`, `shadowBias` | Live parameters with type, unit, range and a one-line help. |
| `describe` | one or two sentences | What it does, for an agent reading the list. |
| `source` | `src/engine/stage/lights.ts` | Where to change it in code. |

## Tag vocabulary

`object light shadow material shader texture animation camera control input ui effect post sound text layout physics data a11y energy ink paper book desk lens lesson figure flow store interaction quality environment`

Combine tags to narrow: `animation` + `book` is every book animation; `light` + `shadow` is every shadow-casting light; `energy` + `lesson` is every glowing store of the current lessons.

## Three ways to look

1. **In the browser:** open the world with `?inspect` (or press Shift+I). Filter with words or `tag:light`, `kind:spot-light`, `id:book.*`. Open an entry to see its description and drag its parameters live. "Copy tune" copies every value you changed as a `tune` block.
2. **From the browser console or a test:** `inkleaf.describe('light')`, `inkleaf.describe('tag:animation book')`, `inkleaf.registry.byTag('sound')`, `inkleaf.registry.get('book.turn').params`.
3. **From the agent's shell:** run the world and print the list: `node <skill>/scripts/inkleaf.mjs describe <world> [query]` (prints the same text as `describe()`).

## Three ways to change

1. **A tune block in the world manifest** (preferred for looks and timings; survives rebuilds, reviewable in a diff):
   ```ts
   tune: {
     'light.key': { intensity: 3.6, penumbra: 0.5 },
     'book.turn': { duration: 1.4, ease: 'inOutQuart' },
     'post.bloom': { intensity: 1.4 },
     'lesson-2.swing.bob': { mass: 0.3 },
   }
   ```
   Values are clamped to each parameter's range; an unknown key prints the parameters that do exist.
2. **Live, at runtime:** `inkleaf.set('post.vignette', 'darkness', 0.3)`. Useful in tests and while tuning by eye.
3. **In code**, when the change is structural (a new object, a new kind of motion): open the `source` file the entry names. Keep new numbers as `tunable()` parameters so they stay editable by name.

## Rules for new things you add

- Register every object, light, animation and effect you create with an id under your lesson or package prefix, a label, tags and a `describe` sentence. An unregistered thing cannot be found by the next person or agent.
- Make every number that shapes look or motion a `tunable()` parameter with a unit, a range and a help line. Defaults should be the values that look right, not zero.
- Do not reuse an id. Ids are how worlds, tests and tune blocks refer to things; renaming one breaks them.

## Example: "make the shadows softer and the page turn slower"

```text
inkleaf.describe('tag:shadow')      -> light.key ... shadowRadius = 2.4 (0..8)
inkleaf.describe('id:book.turn')    -> book.turn ... duration = 1.15 s (0.3..4)
```
Then add to the manifest: `tune: { 'light.key': { shadowRadius: 4 }, 'book.turn': { duration: 1.6 } }`, reload, screenshot, compare.
