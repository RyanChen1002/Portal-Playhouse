# Local 3D preview

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.11 | 11/22/2026 | Added Create account to the welcome screen using the existing shared signUp method, with clear errors and sign-in/offline switching. Verified 84 frontend/build tests and a mock-client browser signup flow. Earlier today (0.10): added the static Vercel build, shared browser client, public asset list, CI build checks, and built-site preview. |
| 0.9 | 11/21/2026 | Added local development login, live lobby and Portal Partners frontend integration through the shared client, and separate practice mode for the other games. Recorded simulated-client verification and outstanding hosted checks. Earlier today (0.8): updated scene-first controls and five-level practice progression while preserving original Portal Partners rules. |
| 0.7 | 11/16/2026 | Added five practice games (0.5), direct-entry rooms (0.6), then a circular furnished courtyard, dismissible rules, and Escape/close controls. Consolidated local plans. Online integration remains pending. |
| 0.4 | 11/15/2026 | Recorded the merged backend client, Node 22 requirement, and remaining frontend integration work; demo behavior unchanged. Clarified review instructions; screenshots belong in the PR only. |
| 0.3 | 11/13/2026 | Recorded Ryan's selection of the current original character designs and linked their roster. |
| 0.2 | 11/12/2026 | Created the illustrated draft (0.1), then added welcome/demo login, a Three.js world, 20 procedural characters, walking and collisions, and room information inside the world. Added furnishings and sample nameplates, a following perspective camera and zoom, furnished room interiors, and physical room admission/return. Verified movement and room entry/exit in the browser. Refined character faces, clothing, blinking, tail motion, walk blending, and model-rendered selection portraits. Modernized furniture with padded sofas, slim workstations, swivel chairs, desk accessories, coffee tables, ceramic planters, and a lighter interior palette. Added local oak/fabric textures, material-specific finishes, filmic tone mapping, acoustic slats, linear lights, lounge ottomans, and a planted centerpiece after reviewing interior and Three.js guidance. |

Run `node tools/preview-server.cjs` from the repository root and open http://127.0.0.1:4173. A local HTTP server is required for JavaScript modules. The VS Code task **Preview Portal Playhouse locally** runs the same command.

Choose **Explore the playhouse**, select a character, and enter. Alternatively use the sample login `explorer@example.test` / `playhouse-demo`. No real credentials are needed, sent, or saved.

## Local online integration (in progress)

Choose **Sign in to online play** to use an existing development account. This connects the local UI to the development Supabase project and Cloudflare runtime; it does not deploy the frontend. The original offline practice route remains available. Online credentials are handled by the shared client, with its session stored in browser local storage.

Choose **Create an account** to register with a display name, email, and password through the shared client's `signUp` method. A successful response opens character selection using the returned profile. Duplicate names/emails, password errors and service failures keep the form open; passwords are cleared after each attempt. If signup returns no session, the UI explains that email confirmation may be needed and offers switching to sign-in. The current shared client requires a session for signup success; hosted signup settings and email delivery have not been verified. No real accounts were created during the local checks.

The local preview server bundles the existing shared TypeScript client in memory at `/portal-client.js`, using the pinned esbuild dependency. The static build generates the same client file for deployment. Run `npm ci` with Node 22 first.

Portal Partners uses server room admission, readiness, movement corrections, game state and results. The menu does not pause the online round. Cafe, Rescue, Train and Workshop stay local: entering them releases the online world slot, and leaving reconnects to the lobby. Online history and unsaved practice history are separate.

Verification on 11/21/2026: 71 frontend tests and 191 shared unit tests passed. Browser testing using the existing shared mock verified sign-in, movement seen by a second client, a two-player round, the lever/crystals/exit win, result display, leave confirmation, local-practice return and saved-history rendering. No real hosted accounts were used in these checks. Hosted two-browser acceptance, disconnect/reconnect acceptance and final visual review remain open. The previously recorded local typecheck limitation (missing wrangler; Node 24 instead of required Node 22) has not been resolved.

Keyboard control starts when you enter the lobby and returns after leaving a game. Hold WASD or arrows to walk. Five furnished rooms keep their existing entrances around new lounge and garden floor zones. Press **K** near a doorway to play; **H** opens optional rules. Furniture and walls block movement. Focus loss stops walking.

Portal Partners is the only networked game. Offline practice uses sample lobby characters; online play displays players received from the shared client. Desktop WebGL and keyboard support are required; mobile is layout preview only.

## Play the five practice games

Walk to a doorway and press **K**. Each game opens its own 3D play area with objectives, a timer, pause/help, and an earned result. Leaving returns you to the same lobby position. All five rooms start open. The **Show one locked-room example** switch temporarily locks Power-Up Workshop; turn it off to play that game again.

- **Portal Partners:** hold the plate, cross the bridge, collect crystals, and reach the exit together.
- **Playhouse Cafe:** prepare and serve four matching orders.
- **Room Rescue:** place four furnishings and carry a sofa through the doorway together.
- **Tiny Train Team:** lay six rails before the train reaches each gap.
- **Power-Up Workshop:** match gears and cables, then activate both power stations.

Use **WASD/arrows** to walk, **E** to interact, **Q** to switch teammates, and **R** to rotate the sofa or track. One person controls both roles for local testing. Pause/help explains each game; leaving the browser pauses time. Escape opens the menu; leaving an active round asks for confirmation. Retry restarts the current level; winning unlocks the next level. You can also start again from level one. Practice history lasts only until reload and is never saved to Supabase.

The [five-game plan](../doc/plans/local-playhouse/README.md) describes these prototypes and the pending backend decisions. The rules, scene rendering, and controls are separated in [games](games/); [characters.js](characters.js) shares the original models with the lobby. No additional server or runtime dependency is needed.

Run `node --test frontend/games/rules.test.mjs frontend/games/rooms.test.mjs frontend/games/menu.test.mjs frontend/games/practice.test.mjs` from the repository root for the local game-rule checks. On 11/16/2026, 13 game and doorway tests and the existing 99 backend unit tests passed, along with TypeScript checking. Browser checks completed all five games using keyboard controls and checked missing-track loss, pause, focus loss, restart, and return to the lobby. These checks do not verify networked multiplayer, database persistence, or full-capacity performance.

The 3D scene and characters are procedural original artwork. Three.js 0.180.0 is stored locally in [vendor](vendor/) with its [MIT license](vendor/THREE-LICENSE.txt). No runtime CDN is used. Selection portraits are rendered locally from the same 3D character models used in the world.

The [initial spec](../doc/initial-spec.md), [contract](../doc/component-contract.md), and [governance](../doc/governance.md) remain the project requirements. Online integration uses [shared/client](../shared/client/) with persistent browser storage, rather than direct table access. The [character roster](../doc/plans/2026-11-12-local-3d-preview.md#character-roster) and first-game rules are unchanged.

This work is prepared for review in a task branch targeting dev. No merge or production deployment is included.

## Static build and Vercel

From the repository root:

```sh
npm ci
npm run build:frontend
npm run test:frontend
node tools/preview-server.cjs --built
```

The final command serves only the generated files at http://127.0.0.1:4173. Stop any existing preview on that port first; there is no second server or port to manage. The normal preview command remains available for development.

Vercel uses [vercel.json](vercel.json) inside its existing **frontend** Root Directory. It installs from the repository lockfile, runs [the build script](../tools/build-frontend.cjs), and serves **dist**. Enable **Include source files outside of the Root Directory in the Build Step**, because the shared client and build tools are at the repository root. Use Node **22.x**. The file overrides the previously empty install/build commands and `.` output directory; do not deploy the source folder as the output. See [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json).

The build copies only allowlisted public assets, includes Three.js notices and bundled dependency license comments, and generates `portal-client.js`. It excludes tests, Markdown, credentials and private checklists. Generated output is Git-ignored.

This frontend currently targets the existing **development** Supabase and Cloudflare services. The runtime allows the official Vercel address and local port 4173. A new PR preview address may be rejected for online play until its origin is separately approved by the backend owner; offline practice still works. No runtime allowlist changes are part of this PR.




## Design references

- [Herman Miller collaborative spaces](https://www.hermanmiller.com/en_lac/products/portfolios/oe1-workspace-collection/lookbook/explore-by-room/collaborative-workspace/): seating groupings and coordinated work/lounge areas.
- [Three.js color management](https://threejs.org/manual/pages/color-management.html): explicit sRGB color textures and output.
- [Three.js standard material](https://threejs.org/docs/pages/MeshStandardMaterial.html): separate roughness and metalness for fabric, ceramic, and metal.

References guide the original scene design; no furniture models or textures were copied. Generated surface textures are local canvas artwork.

The same plan records the courtyard and direct-entry design. Browser checks walked to each doorway, opened its matching game with K, returned to the same location, and verified locked rejection and unlocking.

Rules board: **H** opens it; **Esc** or **X** closes it. During a game, **Esc** opens a small menu. From the menu/help, **Esc** resumes play. **Return to lobby** asks for confirmation before cancelling an unfinished round. No win is awarded for leaving.

## Local progression and verification — 11/21/2026

Portal Partners keeps its original single level, timing, interactions, and rule state. The other four games have five local practice levels:

- Cafe: longer order lists, passing dishes between teammates, then alternating servers.
- Rescue: delivery sequences, alternating carriers, then a teammate helping at the destination. Return a wrong pickup to its original position with E.
- Train: four additional connected routes and different track orientations.
- Workshop: new gear combinations and crossed cable connections.

There is no daily attempt limit. The original first-level rules remain in [rules.js](games/rules.js); [practice.js](games/practice.js) adds local progression. No added level data is sent to Cloudflare.

Verification on 11/22/2026: 76 frontend/build tests and 244 shared/tool unit tests passed. TypeScript checking passed after restoring the declared dependencies. A fresh headless Edge check against the built static site at 1440 × 1000 loaded the real browser-client module and verified all five game scenes, keyboard movement, help/Escape, leave confirmation and canvas cleanup, with no script errors. Screenshots use software WebGL and are visual evidence, not a performance benchmark. Tests ran locally with Node 24.21.0; CI and Vercel use the repository's Node 22 setting.

Still open: real hosted two-account acceptance, actual network interruption/reconnect checks, complete manual keyboard playthroughs of all 20 practice levels, and final art/performance review. Previous mock-client checks are not proof of hosted multiplayer. Keep the PR as a draft until the required acceptance checks are complete.
