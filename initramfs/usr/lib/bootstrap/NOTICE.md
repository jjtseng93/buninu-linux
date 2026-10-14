# Bootstrap credits and third-party notices

Original Buninu bootstrap work uses the MIT license in `LICENSE`.
Third-party components retain the terms below.

## ZilchOS bootstrap-from-tcc

- Credit: [ZilchOS/bootstrap-from-tcc](https://github.com/ZilchOS/bootstrap-from-tcc).
- Author/copyright: Copyright (c) 2021 Alexander Sosedkin.
- License: MIT; the complete, unmodified notice is in
  [LICENSES/MIT-ZilchOS-bootstrap-from-tcc.txt](LICENSES/MIT-ZilchOS-bootstrap-from-tcc.txt).
- Reference checkout: `d2f9454b34fef570cfb32cf5b17d85a90dba81bf`.
- Buninu's TinyCC-to-GCC bootstrap route was developed with this project's
  route and recipes as references, particularly GNU Make's no-make bootstrap
  and self-rebuild, Binutils configuration, and the transition to GCC 4.
- Buninu adapts that approach to Bun.cc, bunmsh, musl and native ARM64/x64;
  its JavaScript stages, layout and local compatibility edits differ from the
  original recipes. This credit does not imply upstream verification or endorsement.
- ZilchOS's MIT license covers its own work, not the independent packages
  downloaded or compiled by either project's recipes.

## Sources bundled with Buninu Linux

| Material | License/provenance |
| --- | --- |
| musl 1.2.6 | MIT; original `COPYRIGHT` remains in the source archive and `/bootstrap/src/musl/COPYRIGHT` |
| TinyCC `05f0faf` | Compiler principally LGPL-2.1-or-later; original `COPYING` and individual source notices remain in `/bootstrap/src/tinycc` |
| TinyCC runtime helpers | Per-file terms apply; for example `lib/libtcc1.c` carries GPL-2.0-or-later with an additional linking permission, retained verbatim in the upstream archive |
| Local bootstrap overlay and JS scripts | Buninu Linux's MIT terms for original local work; third-party material keeps its own terms and notices |

- Archives are under `sources/` in the outer package; SHA-256 pins are in
  `lib/seed.js`. Stage 1 extracts them without stripping copyright notices.
- The overlay supplies local configuration, build entry points and smoke tests.
  Compiling or including upstream TinyCC source does not relicense that source.
- The musl ARM64 startup adjustment is a temporary local header override;
  the original musl source and copyright notice are retained.

## Sources fetched by stages 5–12

These archives and their resulting binaries are not prebundled in the npm
package. Fixed URLs and SHA-256 pins are in `downloads.md`. Downloads preserve
upstream license texts and individual file notices in `/bootstrap/src`.

| Stage | Package | Principal code license / upstream notice |
| --- | --- | --- |
| 5 | GNU Make 4.4.1 | GPL-3.0-or-later; `COPYING` |
| 6 | GNU Binutils 2.39 | GPL-3.0-or-later for the main tools; component-specific terms also apply; `COPYING*` and source headers |
| 7 | GMP 4.3.2 | LGPL-3.0-or-later for the library; `COPYING.LIB`, with GPL text in `COPYING` |
| 8 | MPFR 2.4.2 | LGPL-2.1-or-later for the library; `COPYING.LIB` |
| 9 | MPC 0.8.1 | LGPL-2.1-or-later for the library; `COPYING.LIB` |
| 10 | GNU m4 1.4.18 | GPL-3.0-or-later; `COPYING` |
| 11 | Flex 2.6.4 | Upstream BSD-style license; preserve its exact `COPYING` text |
| 12 | GCC 4.7 vendor commit `9d2b63d100ae7c99ee8b128fb41086fd85c8f57d` | Compiler GPL-3.0-or-later; libgcc files carry their own notices and GCC Runtime Library Exception 3.1 where stated; `COPYING3`, `COPYING.RUNTIME`, other `COPYING*` and source headers |

- This table summarizes the principal code licenses; manuals, bundled support
  code and individual files may carry other terms. Their original notices govern.
- Stage 12 preserves the top-level license texts for GCC, Binutils and linked
  numerical libraries under `/bootstrap/result/share/licenses/`, together with
  this bootstrap credit and the ZilchOS MIT license.
- License texts alone are not Corresponding Source. A distributor of compiled
  results must also retain/provide the applicable source and local changes as
  required by the relevant licenses; the pinned downloads and shipped recipes
  document the inputs and modifications.
- Prebuilt Bun, musl, libgcc, libstdc++ and bunmsh remain separately licensed
  seed components; see the outer package's `NOTICE.md` and application notices.
