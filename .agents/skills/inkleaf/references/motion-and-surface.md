# Motion, light and surface recipes

## Choose a motion

| Clip | Pose data | Reuse path |
| --- | --- | --- |
| Camera arrival | Translation, depth, pitch, yaw, roll and cover opening | `BOOK_MOTIONS.camera` and `cameraAt(seconds)` from `src/demo/book-motion.ts` |
| Contents riffle | Per-leaf visibility, angle, fold and lift in a known direction | `riffleLeafAt(seconds, index, direction)`, `riffleDuration(count)` and `riffleChangeAt(count)` from the same file |
| Diagram unfold | Normalized lift | `popupAt(progress)` in `src/demo/motion.ts` |
| Optical sweep | Normalized sample point and magnification | `magnifierAt(frame)` and `magnifierZoomAt(frame)` in the same file |
| Apparatus orbit | Absolute camera yaw and pitch | `figureViewAt(frame)` in `src/motion/guided-view.ts` |
| Original experiment | Model pose, readings and explanation | Implement `sample(seconds, setting)` in an `InteractiveLesson` |

The reader uses 60 fps for authored clips. It computes poses from the selected frame, regardless of browser refresh rate. A reusable riffle needs the number of leaves, direction, duration per leaf and stagger. Keep lesson changes at a defined frame. A new camera route should start from a pose, pass through explicit keyframes and end at a stable reading pose.

## Make another visual treatment

Use `createPaperGrain` in `src/demo/plate-finish.ts` for deterministic procedural grain. Give the stock its own seed and color. Keep material color outside the texture so a different paper tint reuses the same grain. The finish helper applies restrained ink edges and bump relief without changing the pickable geometry.

With a figure raised, choose **Inspect elements**. Filter for `Notebook paper and ink` or `Notebook key light`. An apparatus registers its finish and light under stable IDs. Its finish exposes `inkOpacity` and `paperRelief`. The key light exposes `intensity` and `color`. Copy chosen values back into the scene or its configuration for repeatable renders.

## Make a reading lens

`src/motion/magnifier.ts` takes a live canvas source and a button. Request a fresh source frame and sample it immediately after drawing. The lookup in `src/motion/refraction.ts` maps each destination pixel back to the source, with a stronger bend toward the edge and a small difference between red, green and blue. Use `resolveOptics` to keep zoom, refraction and dispersion within supported ranges. The lookup is reused while refraction and dispersion stay fixed. Vary the center and zoom by frame to avoid rebuilding the lookup during a sweep.

Make magnification work with a pointer, a touch target and keyboard controls. Keep definitions available as HTML. Confirm that revisiting the same optical pose yields the same image when the underlying scene is also fixed. With WebGL disabled, render the text and readings as the primary experience.
