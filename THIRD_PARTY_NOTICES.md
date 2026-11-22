# Third-party notices

Inkleaf is licensed under Apache-2.0. The following direct dependencies are pinned in `package-lock.json`. License names and attributions below were checked against the installed packages and their included license files.

## Application dependencies

| Package | Pinned version | License and notice |
|---|---:|---|
| `three` | 0.187.0 | MIT, `LICENSE`, copyright three.js authors. |
| `postprocessing` | 6.39.6 | Zlib, `LICENSE.md`, copyright Raoul van Rüschen. |
| `n8ao` | 2.1.0 | The installed `LICENSE` and upstream README identify CC0 1.0 Universal. The package metadata says ISC. The build includes the shipped CC0 text. [Upstream README](https://github.com/N8python/n8ao#license) |
| `@fontsource-variable/caveat` | 5.3.0 | SIL Open Font License 1.1, `LICENSE`, copyright Caveat Project Authors. |
| `@fontsource-variable/source-serif-4` | 5.3.1 | SIL Open Font License 1.1, `LICENSE`, copyright Google Inc. |

The font files are distributed under OFL 1.1. Keep their license with redistributed font software, and follow the OFL conditions for modified fonts, including the Reserved Font Name requirement. Documents made with the fonts are not subject to the font license.

## Development dependencies

| Package | Pinned version | License and notice |
|---|---:|---|
| `@playwright/test` | 1.65.0 | Apache-2.0, `LICENSE`; its `NOTICE` identifies code derived from Puppeteer, also under Apache-2.0. |
| `@types/three` | 0.187.0 | MIT, `LICENSE`, copyright Microsoft Corporation. |
| `happy-dom` | 21.0.4 | MIT, `LICENSE`, copyright David Ortner. |
| `typescript` | 7.0.2 | Apache-2.0, `LICENSE`; the distribution also includes `NOTICE.txt` for third-party material. |
| `vite` | 8.3.7 | MIT, `LICENSE.md`. |
| `vitest` | 5.1.0 | MIT, `LICENSE.md`. |

The package lockfile includes the complete transitive dependency tree. For transitive packages, consult each installed package's license and notice files. The n8ao labels above are recorded as found in the installed distribution.

The production build includes the project license, its notice, this document and the license texts for Three.js, postprocessing, n8ao, and the core Vite helper under `licenses/`.
