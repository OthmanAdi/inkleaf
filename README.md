# Inkleaf

An interactive pop-up field notebook and a coding-agent skill for building original books. Open the cover, unfold a pendulum from the page, and release it to see where the energy goes.

## Try the swing lesson

From this checkout, run:

```sh
npm ci
npm run dev
```

Open the address printed by Vite. Use **Open notebook**, **Raise pop-up** and **Release bob**. Turn on air drag and repeat the experiment to see energy move into the thermal store.

The motion panel lets you step through the cover turn, diagram reveal, swing and magnifier sweep one frame at a time. The magnifier enlarges a region of the live 3D diagram. The inspector lists named parts and the parameters they expose.

## Build another spread

Start with the [Inkleaf skill](.agents/skills/inkleaf/SKILL.md) and its [authoring guide](.agents/skills/inkleaf/references/authoring.md). The example keeps the [lesson data](src/demo/lesson.ts), [motion definitions](src/demo/motion.ts) and [visual theme](src/demo/style.css) in separate files.

This checkout includes one playable lesson. The other lesson scenes, full navigation and release media are pending. The engine's unit tests cover many reusable components. Run `npm run check` for type checking, unit tests and a production build.

The project code is licensed under [Apache-2.0](LICENSE). The install includes separately licensed dependencies and fonts.
