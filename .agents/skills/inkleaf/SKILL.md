---
name: inkleaf
description: Build, extend, or restyle an interactive Three.js pop-up field book with independently reusable page, reveal, simulation, and magnifier effects. Use when a user wants a physical book interface, diagrams that unfold from a page, frame-by-frame animation controls, or an original interactive lesson.
---

# Inkleaf

Build a real spread with original content and artwork. Keep motion, appearance, controls and lesson data independent so an agent can change one without rebuilding the others.

## Start from a checkout

Use the checkout that contains this skill when available. In a copied skill, use the source checkout the user supplies. Confirm its `package.json` is named `inkleaf` and it contains `src/demo/lesson.ts`, `src/demo/motion.ts` and `src/motion/frames.ts`. Record the source commit and read local repository instructions.

This checkout demonstrates a cover, one pendulum lesson, separate frame controls and a magnified detail of the diagram. The engine also contains reusable prototypes for other simulations and effects. Check the normal entry point and the relevant module before describing any additional feature as shipped.

## Choose the smallest applicable workflow

| Request | Start here |
| --- | --- |
| Change a lesson with the same mechanism | [Author a spread](references/authoring.md), `src/demo/lesson.ts` |
| Make a motion slower, adjust the pose, or rebuild it as a variant | [Author a spread](references/authoring.md), `src/demo/motion.ts` and `src/motion/frames.ts` |
| Invent a new interactive figure | [Three.js reference index](references/threejs/README.md), then the relevant engine and demo source |
| Change a light, object or control by name | [Registry and tags](references/registry-and-tags.md) and the live inspector |

## Build an original book

1. Write the learning objective and one action the reader can perform. Decide what changes on the scene and what evidence the reader sees.
2. Keep visible prose, simulation settings and visual theme in replaceable data or styles. Reuse the frame sampler and existing engine primitives for their actual contracts. Use a stable ID, human label and tags for each new controllable entity.
3. Define each animation separately in frames. Model its starting value, keyframes, ending value, easing and trigger. Use the same pose function for playback and the frame editor. Use fixed-step replay from explicit inputs for physical or gesture-driven motion.
4. Keep the magnifier tied to live rendered pixels. Give pointer, touch and keyboard users a way to pick the detail. Keep measurements and explanations in readable HTML.
5. Run `npm ci` on a fresh checkout, then `npm run check` and `npm run dev`. Open the actual app and run the checks below.

## Verify it

- Open and close the book and make the diagram unfold. Release the simulation with its controls and confirm the visible state and readouts change. Verify reset.
- For each new clip, seek to frame zero, a middle frame, the final frame and the same middle frame again. The repeated pose should agree. Check all visible outputs that the clip owns.
- Verify the reader can complete the interaction on a narrow touchscreen viewport and with the keyboard. In reduced-motion mode, keep direct controls and skip decorative movement.
- Verify the magnifier shows an enlarged crop of the live scene and still works with keyboard controls.
- For a reusable system, ask another agent to make a second lesson using only this skill and the checkout. Record the actual steps and results. A successful build alone only proves the files compile.

Keep requirements for unimplemented interactions explicit. A robust scene can be inspired by familiar interaction patterns while using its own composition, typography, materials and artwork.
