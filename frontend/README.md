# Local 3D preview

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.7 | 11/16/2026 | Added five practice games (0.5), direct-entry rooms (0.6), then a circular furnished courtyard, dismissible rules, and Escape/close controls. Consolidated local plans. Online integration remains pending. |
| 0.4 | 11/15/2026 | Recorded the merged backend client, Node 22 requirement, and remaining frontend integration work; demo behavior unchanged. Clarified review instructions; screenshots belong in the PR only. |
| 0.3 | 11/13/2026 | Recorded Ryan's selection of the current original character designs and linked their roster. |
| 0.2 | 11/12/2026 | Created the illustrated draft (0.1), then added welcome/demo login, a Three.js world, 20 procedural characters, walking and collisions, and room information inside the world. Added furnishings and sample nameplates, a following perspective camera and zoom, furnished room interiors, and physical room admission/return. Verified movement and room entry/exit in the browser. Refined character faces, clothing, blinking, tail motion, walk blending, and model-rendered selection portraits. Modernized furniture with padded sofas, slim workstations, swivel chairs, desk accessories, coffee tables, ceramic planters, and a lighter interior palette. Added local oak/fabric textures, material-specific finishes, filmic tone mapping, acoustic slats, linear lights, lounge ottomans, and a planted centerpiece after reviewing interior and Three.js guidance. |

Run `node tools/preview-server.cjs` from the repository root and open http://127.0.0.1:4173. A local HTTP server is required for JavaScript modules. The VS Code task **Preview Portal Playhouse locally** runs the same command.

Choose **Explore the playhouse**, select a character, and enter. Alternatively use the sample login `explorer@example.test` / `playhouse-demo`. No real credentials are needed, sent, or saved.

Click the world, then hold WASD or arrow keys to walk. Five furnished rooms surround the central courtyard. Approach a doorway to read its rules board, then press **K** to play directly. Furniture and walls block movement. Focus loss stops walking.

The first production game remains TBD. Room-board scores, membership, and other lobby players are samples. No Supabase connection, real login, or live multiplayer is implemented. Desktop WebGL and keyboard support are required; mobile is layout preview only.

## Play the five practice games

Walk to a doorway and press **K**. Each game opens its own 3D play area with objectives, a timer, pause/help, and an earned result. Leaving returns you to the same lobby position. All five rooms start open. The **Show one locked-room example** switch temporarily locks Power-Up Workshop; turn it off to play that game again.

- **Portal Partners:** hold the plate, cross the bridge, collect crystals, and reach the exit together.
- **Playhouse Cafe:** prepare and serve four matching orders.
- **Room Rescue:** place four furnishings and carry a sofa through the doorway together.
- **Tiny Train Team:** lay six rails before the train reaches each gap.
- **Power-Up Workshop:** match gears and cables, then activate both power stations.

Use **WASD/arrows** to walk, **E** to interact, **Q** to switch teammates, and **R** to rotate the sofa or track. One person controls both roles for local testing. Pause/help explains each game; leaving the browser pauses time. Restart starts a fresh round. Practice history lasts only until reload and is never saved to Supabase.

The [five-game plan](../doc/plans/local-playhouse/README.md) describes these prototypes and the pending backend decisions. The rules, scene rendering, and controls are separated in [games](games/); [characters.js](characters.js) shares the original models with the lobby. No additional server or runtime dependency is needed.

Run `node --test frontend/games/rules.test.mjs frontend/games/rooms.test.mjs` from the repository root for the local game-rule checks. On 11/16/2026, 13 game and doorway tests and the existing 99 backend unit tests passed, along with TypeScript checking. Browser checks completed all five games using keyboard controls and checked missing-track loss, pause, focus loss, restart, and return to the lobby. These checks do not verify networked multiplayer, database persistence, or full-capacity performance.

The 3D scene and characters are procedural original artwork. Three.js 0.180.0 is stored locally in [vendor](vendor/) with its [MIT license](vendor/THREE-LICENSE.txt). No runtime CDN is used. Selection portraits are rendered locally from the same 3D character models used in the world.

The [initial spec](../doc/initial-spec.md), [contract](../doc/component-contract.md), and [governance](../doc/governance.md) remain the project requirements. The [local plan](../doc/plans/2026-11-12-local-3d-preview.md) records this draft. Adam's shared client is now available in [shared/client](../shared/client/), merged through PR #18. This UI still uses sample data until its frontend build and account integration are implemented. Use the shared client rather than direct table access. Browser integration must pass persistent storage and a stable session key. The merged toolchain requires Node 22; use Node 22 for backend checks. Ryan selected the current 20 original character designs on 11/13/2026; see the [character roster](../doc/plans/2026-11-12-local-3d-preview.md#character-roster). Map details, movement, and final production polish remain for review.

Prepared locally for review in a task branch targeting dev. Publishing requires Ryan's approval. No merge or deployment is included.




## Design references

- [Herman Miller collaborative spaces](https://www.hermanmiller.com/en_lac/products/portfolios/oe1-workspace-collection/lookbook/explore-by-room/collaborative-workspace/): seating groupings and coordinated work/lounge areas.
- [Three.js color management](https://threejs.org/manual/pages/color-management.html): explicit sRGB color textures and output.
- [Three.js standard material](https://threejs.org/docs/pages/MeshStandardMaterial.html): separate roughness and metalness for fabric, ceramic, and metal.

References guide the original scene design; no furniture models or textures were copied. Generated surface textures are local canvas artwork.

The same plan records the courtyard and direct-entry design. Browser checks walked to each doorway, opened its matching game with K, returned to the same location, and verified locked rejection and unlocking.

Rules board: **Esc** or **X** closes it; **H** reopens it. During a game, **Esc** exits to the courtyard. From pause/help, **Esc** resumes play; **Close game** exits. Unfinished rounds are cancelled, with no win awarded.
