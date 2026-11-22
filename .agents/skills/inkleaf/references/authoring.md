# Author a spread and its animations

## Change a swing lesson

Use `src/demo/lesson.ts` as the editable example. Choose a new stable `id`, a short book title and lesson title, a description and a prediction with three choices. Set `correct` to the zero-based index. Explain the prediction in one paragraph.

The swing settings use kilograms, metres and degrees. The physical model in `src/engine/physics/pendulum.ts` uses radians internally. If the model settings change, recalculate the worked numbers in the text. The initial height above the bottom is `L × (1 − cos(angle))` and the initial gravitational energy is `mass × g × height`. Describe what air drag changes. A different concept may need a different figure and simulation module.

Edit the theme and paper composition in `src/demo/style.css`. Keep text visible and controls operable when the renderer falls back to the HTML/CSS figure.

## Expose a motion by ID

Use a short stable clip ID. Declare its label, frame rate and last frame in `src/demo/motion.ts`. Frame zero is the initial pose. For a 0.9 s motion at 60 fps, the last frame is 54. Change the motion duration in one place and use that value for both playback and seeking.

An authored track is an ordered list of frame/value pairs. The outgoing keyframe chooses its easing.

```ts
import { sampleTrack, type Keyframe } from '../motion/frames';

const hinge: readonly [Keyframe, Keyframe, Keyframe] = [
  { frame: 0, value: 0, easeToNext: 'inQuad' },
  { frame: 12, value: 20, easeToNext: 'outCubic' },
  { frame: 48, value: 90 },
];

const hingeAngle = (frame: number) => sampleTrack(hinge, frame);
```

For another figure, map sampled values onto its own transforms. Give each track one responsibility, such as angle, elevation, opacity, light intensity or a material parameter. Keep coordinates and materials in scene code. All keyframe frame numbers must be finite and strictly increasing.

Give the frame panel the clip metadata and a function that applies the selected state. A seek must stop ongoing playback for the clip, establish any prerequisite state, and compute the pose from the requested time. If a clip depends on prior input, record the input and replay it from a known initial state in fixed steps. For a new drag gesture, specify pointer start, move, release, cancellation and the keyboard equivalent separately from the motion's visual treatment.

## Reuse the optical detail

The magnifier in `src/motion/magnifier.ts` crops the current figure canvas after it renders. Use its point input in normalized canvas coordinates. The crop zoom lives in that module and the viewport treatment lives in `src/motion/tools.css`. The sample sweep in `src/demo/motion.ts` defines an independent X and Y track. `src/motion/setup.ts` binds the sweep to the visible lens. On a new renderer, provide a frame notification directly after drawing, while the WebGL drawing buffer is still available. Protect the readable HTML and controls if the canvas falls back.

## Check an adaptation

1. Copy or branch the example. Change the content and a visual choice.
2. Use the running frame panel to compare initial, middle and final frames.
3. Try returning from the last frame to the middle. Confirm that it matches the first time through.
4. Try the actual launch, movement and reset controls with no frame panel open.
5. Record what is verified, including the environment and any untested motion families.
