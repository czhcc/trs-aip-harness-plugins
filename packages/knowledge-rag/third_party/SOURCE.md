# Source

Vendored from local TsLightRAG 0.1.0 on 2026-10-27. Engine and contracts are adapted for DSH; no standalone HTTP server is included. See the retained LICENSE, NOTICE and upstream notices.

`src/engine/` comes from `apps/server/src/`, `src/contracts/` from `internal/contracts/src/`, and `src/graph-layout.ts` from the original Web client. Host routing, model integration, configuration, session controls and the browser UI are adapted or newly implemented for DSH. Synthetic parser fixtures are copied from `tests/fixtures/documents/`.

`TsLightRAG-NOTICE.md`, `TsLightRAG-UPSTREAM_PROVENANCE.md` and `upstream/` retain the original project's historical notices and resource licenses; their original repository links and validation claims describe that upstream checkout, not this plugin. In this package, the original `third_party/` paths correspond to `upstream/` and the project MIT license is `TsLightRAG-LICENSE`.

`browser-dependencies.json` and `BROWSER_THIRD_PARTY_NOTICES.txt` enumerate the installed versions and retain license text for the dependencies bundled into this plugin's browser factory. Regenerate with `node scripts/browser-licenses.mjs` after changing the lockfile. Host dependencies remain external npm dependencies with their own license files; PDF.js resource terms are also retained in the upstream notices. Native runtime redistribution still requires reviewing the actual target platform binaries, including canvas/Skia.
