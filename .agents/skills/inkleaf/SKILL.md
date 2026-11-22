---
name: inkleaf
description: Build or adapt a Three.js pop-up book with interactive lessons, original scenes, editable lights and textures, and seekable camera, page riffle, diagram and magnifier animations.
---

# Inkleaf

Use this skill when a reader should inspect, predict, or change something in an illustrated book. Give the lesson a clear question, a scene that responds to the reader, and observations that explain what changed.

## Start from the project

Use the checkout containing this skill, or the source checkout the user names. Read its project instructions and package scripts. Trace each requested feature from the lesson contract and scene modules to the active app entry point before documenting it.

The checked-in reader has eight experiments. Each chapter supplies settings, a sample function, readings and a figure. The opening camera uses CSS perspective on the paper notebook. The apparatus cameras render in Three.js. The frame panel seeks the opening, page turn, riffle, pop-up, live optical sweep, camera orbit, guided demonstration and active experiment. The live 2D lens samples WebGL pixels with an inverse refraction map and color dispersion. The study desk supplies quiz, glossary, teaching notes, contrast and optional sound.

## Choose a chapter or make a scene

The lesson contract has seven model kinds: `stores`, `catapult`, `bounce`, `heating`, `lifting`, `lamps` and `grid`. With the existing swing, these make the reader's eight experiments. Treat the names as model labels; choose an illustration and interaction that fit the lesson.

For a chapter already connected to the app, author its lesson data and reuse its renderer only when the physical or visual model fits. For a new idea, build a user-specific scene and interaction. `LessonKind` is a closed union, and the contract has no pluggable figure callback. To add a scene to this reader, extend the kind and scene dispatch deliberately, or add a separate renderer when the lesson should remain independent. Map normalized `pose.primary`, `pose.secondary` and `pose.highlight` to the scene's own objects. Give each model a figure suited to its subject. Readings and the note should come from the same sample as the pose so the prose and drawing describe one state.

Use the [authoring guide](references/authoring.md) for lesson data, scene mapping, deterministic seeking and optional term inspection. Use the [Three.js reference index](references/threejs/README.md) when the scene needs a new rendering technique. Use [registry and tags](references/registry-and-tags.md) to make authored entities findable and tunable.

## Author the learning interaction

1. Write the learning objective, a short explanation, one prediction question and its answer choices. Set the correct answer by zero-based index and explain the evidence the reader should observe.
2. Define a small set of named settings with units or clear option labels. Make each setting change a meaningful model input. Keep the model's assumptions visible in the lesson text.
3. Implement `sample(seconds, setting)` as a repeatable mapping from explicit inputs to a scene pose, readings and note. Clamp or validate inputs at the boundary. Keep prior animation frames and pointer history out of the sample.
4. Build the diagram for the lesson's subject. Keep labels, explanations, controls and readouts in accessible HTML where possible; use the canvas or Three.js scene for the visual model.
5. Add a lesson-specific action and reset path. Make pointer, touch and keyboard behavior explicit. Respect reduced-motion settings while keeping the underlying interaction usable.
6. Add optional magnified details only when they help answer the lesson question. A lens can enlarge the rendered scene; a term detail can show the selected term's definition. Keep either feature optional and provide a keyboard path and readable text equivalent.

## Keep motion seekable

Use a clip's frame rate and last frame as its source of duration. Define authored tracks as ordered frame/value pairs; the outgoing keyframe selects the easing to the next value. Frame zero is the initial pose. Keep each track responsible for one value or one tightly related pose channel.

For a self-contained animation, compute the pose directly from the requested frame. For an experiment that depends on prior input, reset to a known initial state and replay recorded settings in fixed steps to the requested time. Seek must stop live playback first, set prerequisite page or scene state, and update every visible output owned by that clip. Test frame zero, a middle frame, the last frame, and the same middle frame after visiting the end.

The mounted demo exposes `window.inkleafDemo.seek('turn' | 'popup' | 'swing', seconds)` for the swing clips and `window.inkleafDemo.seekExperiment(seconds)`, `experimentClip()`, `experimentTerm()` and `movePage(-1 | 1)` for the selected extra experiment and page navigation. The visible motion panel uses those demo hooks to seek the current experiment, and changes its experiment clip as the reader changes chapters. These globals and IDs belong to this app; a different book should define a small bridge around its own state instead of depending on `window.inkleafDemo`.

Use `seekBookMotion('camera' | 'riffle', seconds)` for the paper book. The riffle replays the last eligible jump or its documented default. Keep the destination, starting lesson, leaf count and direction fixed while comparing two seeks. Use the [motion and surface recipes](references/motion-and-surface.md) to adapt the visual system.

## Check the finished chapter

- Run the documented type-check, unit-test and build commands from a clean dependency install.
- Open the actual app and follow the reader route from cover to chapter. Use the setting and action controls, read the values, reset, and repeat with another setting.
- Seek to the start, middle and end of each authored clip, then seek back to the same middle frame. Compare the whole visible state, not only the moving object.
- Test a narrow viewport, keyboard-only operation, swipe page turns, Shift+wheel page turns and reduced motion. Confirm the fallback scene still has readable content and working controls.
- If the magnifier or term detail is enabled, verify the 2× crop, pointer/touch target, arrow-key movement while its button is focused, Escape close, term card and text alternative.
- Record what was exercised and what remains unconnected. Compilation confirms the build; follow the reader flow to confirm its interactions.
