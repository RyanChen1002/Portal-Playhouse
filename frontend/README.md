# Local 3D preview

## Change History

| Version | Date | Change |
| --- | --- | --- |
| 0.4 | 11/15/2026 | Recorded the merged backend client, Node 22 requirement, and remaining frontend integration work; demo behavior unchanged. Clarified review instructions; screenshots belong in the PR only. |
| 0.3 | 11/13/2026 | Recorded Ryan's selection of the current original character designs and linked their roster. |
| 0.2 | 11/12/2026 | Created the illustrated draft (0.1), then added welcome/demo login, a Three.js world, 20 procedural characters, walking and collisions, and room information inside the world. Added furnishings and sample nameplates, a following perspective camera and zoom, furnished room interiors, and physical room admission/return. Verified movement and room entry/exit in the browser. Refined character faces, clothing, blinking, tail motion, walk blending, and model-rendered selection portraits. Modernized furniture with padded sofas, slim workstations, swivel chairs, desk accessories, coffee tables, ceramic planters, and a lighter interior palette. Added local oak/fabric textures, material-specific finishes, filmic tone mapping, acoustic slats, linear lights, lounge ottomans, and a planted centerpiece after reviewing interior and Three.js guidance. |

Run `node tools/preview-server.cjs` from the repository root and open http://127.0.0.1:4173. A local HTTP server is required for JavaScript modules. The VS Code task **Preview Portal Playhouse locally** runs the same command.

Choose **Explore demo**, select a character, and enter. Alternatively use the sample login `explorer@example.test` / `playhouse-demo`. No real credentials are needed, sent, or saved.

Click the world, then hold WASD or arrow keys to walk. Press E near a portal, or click an in-world room board. Room details open over the world. Close the panel to continue exploring. The separate Room board page remains a keyboard-accessible alternative. Furniture and walls block movement. Focus loss stops walking.

The first game remains TBD. Room scores, timers, membership, and other players are samples. No Supabase connection, real login, multiplayer, game logic, or persistence is implemented. Reloading resets the preview. Desktop WebGL and keyboard support are required; mobile is layout preview only.

The 3D scene and characters are procedural original artwork. Three.js 0.180.0 is stored locally in [vendor](vendor/) with its [MIT license](vendor/THREE-LICENSE.txt). No runtime CDN is used. Selection portraits are rendered locally from the same 3D character models used in the world.

The [initial spec](../doc/initial-spec.md), [contract](../doc/component-contract.md), and [governance](../doc/governance.md) remain the project requirements. The [local plan](../doc/plans/2026-11-12-local-3d-preview.md) records this draft. Adam's shared client is now available in [shared/client](../shared/client/), merged through PR #18. This UI still uses sample data until its frontend build and account integration are implemented. Use the shared client rather than direct table access. Browser integration must pass persistent storage and a stable session key. The merged toolchain requires Node 22; use Node 22 for backend checks. Ryan selected the current 20 original character designs on 11/13/2026; see the [character roster](../doc/plans/2026-11-12-local-3d-preview.md#character-roster). Map details, movement, and final production polish remain for review.

Prepared locally for review in a task branch targeting dev. Publishing requires Ryan's approval. No merge or deployment is included.




## Design references

- [Herman Miller collaborative spaces](https://www.hermanmiller.com/en_lac/products/portfolios/oe1-workspace-collection/lookbook/explore-by-room/collaborative-workspace/): seating groupings and coordinated work/lounge areas.
- [Three.js color management](https://threejs.org/manual/pages/color-management.html): explicit sRGB color textures and output.
- [Three.js standard material](https://threejs.org/docs/pages/MeshStandardMaterial.html): separate roughness and metalness for fabric, ceramic, and metal.

References guide the original scene design; no furniture models or textures were copied. Generated surface textures are local canvas artwork.
