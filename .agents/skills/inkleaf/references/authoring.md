# Author lessons, scenes and motion

## Choose the lesson model

The lesson contract is in `src/demo/lesson-contract.ts`. It declares seven `LessonKind` values: `stores`, `catapult`, `bounce`, `heating`, `lifting`, `lamps` and `grid`. The reader connects one lesson for each kind, plus the separate swing lesson, for eight experiments. Lesson samples are in `src/demo/lessons/index.ts`; their Three.js figure dispatch is in `src/demo/lesson-figures.ts`.

Read the active lesson registry and figure dispatch before editing a chapter. `LessonKind` is a closed union, and `InteractiveLesson` has no figure callback. Add a kind and its scene dispatch, or give a separate lesson its own rendering path. Preserve the lesson's scientific or mathematical assumptions in its settings, sample function and explanation.

Every `InteractiveLesson` supplies:

| Field | Authoring guidance |
|---|---|
| `id` | Stable, unique identifier used by navigation and saved state. |
| `kind` | One declared model kind. Add a kind only when a new model contract is needed. |
| `title`, `description` | A short title and the idea the reader should take away. |
| `prediction` | A question, at least two options, the zero-based correct index, and an evidence-based explanation. |
| `term` | One concise term and definition. The definition can be offered as an optional magnified detail. |
| `settings` | A label and reader-visible options. Map each option index to an explicit model input. |
| `action` | The verb the reader uses to run the experiment. |
| `duration` | Experiment duration in seconds. Keep clip timing derived from this value. |
| `sample(seconds, setting)` | A pure, repeatable sample containing `pose`, `readings` and `note`. |

`LessonPose` has three normalized channels: `primary`, `secondary` and `highlight`. They are not universal physical quantities. Document and implement how the selected lesson's scene maps each channel to its own geometry, materials or annotations. `LessonSample.readings` and `note` should agree with that pose and the selected setting.

## Make a custom scene

When a lesson needs a different renderer, create a scene module for its diagram. Keep lesson-specific coordinates, materials and object relationships there. Let the lesson sampler describe the model state; let the scene renderer turn that state into a drawing. Keep page layout, shared controls and lesson prose outside the scene.

Give each interactive object a meaningful ID and label. Register controls and values that a later author may need to inspect or tune. Include units, ranges and help text for numerical controls. Keep key values and the diagram's purpose readable in HTML so the lesson remains clear if canvas rendering fails.

For a physical process, derive `sample` from explicit input parameters and a known initial state. If numerical integration is needed, use a fixed integration step and derive display values from the same simulated state. Compute time from explicit inputs. Wall-clock frame deltas, previous render calls and hidden user input make seeking and repeated samples disagree.

## Author motion and seeking

Use `src/demo/motion.ts` and `src/motion/frames.ts` for the small demo tracks. A `MotionClip` has a label, frames per second and last frame. Frame zero is the initial state; duration is `lastFrame / fps`. Use `sampleTrack` with strictly increasing keyframe numbers and choose easing on the outgoing keyframe.

For new work, give each clip a stable ID and one responsibility. Keep its metadata and pose function together or reference the same metadata from both playback and seeking. Clamp seeks into the clip's closed frame range. A clip should be computable at any frame without visiting prior frames.

An experiment may have stateful physics. Its seek path should stop live playback, reset the model, apply the selected setting and replay from time zero in fixed steps. A pure sample function can instead compute its state directly from elapsed time and the selected setting. In either case, pose, readings, labels and term target must all match the requested time. The mounted reader exposes `window.inkleafDemo.experimentClip()`, `seekExperiment(seconds)`, `experimentTerm()` and `movePage(-1 | 1)`. The visible motion panel updates the experiment clip when the reader changes chapters. The separate `window.inkleafDemo.seek(id, seconds)` hook samples the swing's page-turn, pop-up and pendulum clips. These APIs belong to this demo; build an appropriate bridge around a new book's own state.

Verify each clip at its first, middle and last frame, then revisit the middle frame after the last. Also test a different setting and the normal reader controls with seeking closed. If gesture input affects the simulation, record the gesture or its resulting model input as part of replay.

## Add magnified detail when useful

The **Magnifier** button shows a live crop with edge refraction and color separation. It starts at 2×. Pointer movement or a tap selects the point. When the button has focus, the arrow keys move the lens and Escape closes it. Choose a normalized point and update the crop after the renderer draws. See [motion and surface recipes](motion-and-surface.md) for the optical samplers and controls.

Expose the lesson term's label and definition in readable text. In this reader a pointer or focus on the printed term can open its figure lens and term card. Make the affordance keyboard-operable, keep focus visible and provide a direct way to close it. Omit term detail when the point has no useful term.

## Keep the reader flow coherent

The demo's Contents page links all eight experiments. Previous/next controls and left/right arrow keys navigate the book. A touch swipe on the paper or Shift+wheel can turn pages without intercepting gestures on controls. Use these as examples from this app; add navigation deliberately to a custom scene. Persist only state that should survive a reload, and validate saved values when the lesson schema changes. The swing buttons belong to that lesson. Define the action sequence for each new lesson.

In this checkout, `src/demo/lesson.ts`, `src/demo/motion.ts` and the pendulum figure module belong to the swing lesson. The seven `InteractiveLesson` models share the lesson contract and have a separate figure dispatch. The broader runtime and engine modules can provide reusable building blocks, but verify that a requested interaction is wired into the app before describing it as available.
