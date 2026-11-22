import * as T from "../vendor/three.module.js";

// Visual-only scenery. All architecture sits outside the gameplay bounds.
export const palettes = {
  portal: {
    accent: "#8b65de",
    secondary: "#ef997d",
    wall: "#eee5f8",
    floor: "#e9e0f3",
    sky: "#e4ddf0",
    metal: "#655d84",
  },
  cafe: {
    accent: "#dc8970",
    secondary: "#9cba9e",
    wall: "#f5e7d5",
    floor: "#edddc8",
    sky: "#eee2d3",
    metal: "#77594e",
  },
  rescue: {
    accent: "#b987c7",
    secondary: "#edaa84",
    wall: "#efe4ec",
    floor: "#e8d9e3",
    sky: "#e8dfe9",
    metal: "#80687e",
  },
  train: {
    accent: "#539bb6",
    secondary: "#f1c566",
    wall: "#e2eef0",
    floor: "#dce9e7",
    sky: "#dce8eb",
    metal: "#567780",
  },
  workshop: {
    accent: "#4ba2a6",
    secondary: "#e7aa65",
    wall: "#e1e9e7",
    floor: "#d9e2df",
    sky: "#dae3e1",
    metal: "#415860",
  },
};
export function furnishRoom(scene, id) {
  const palette = palettes[id],
    materials = new Map();
  function material(color, metal = false) {
    const key = color + metal;
    if (!materials.has(key))
      materials.set(
        key,
        new T.MeshStandardMaterial({
          color,
          roughness: metal ? 0.32 : 0.72,
          metalness: metal ? 0.65 : 0,
        }),
      );
    return materials.get(key);
  }
  function cube(x, y, z, w, h, d, color, metal = false) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material(color, metal));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function rounded(x, y, z, w, h, d, color, r = 0.12) {
    const shape = new T.Shape();
    r = Math.min(r, w / 3, h / 3, d / 3);
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2);
    shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r);
    shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r);
    shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const geo = new T.ExtrudeGeometry(shape, {
      depth: d - r * 2,
      bevelEnabled: true,
      bevelSize: r * 0.35,
      bevelThickness: r,
      bevelSegments: 3,
      curveSegments: 10,
      steps: 1,
    });
    geo.center();
    const mesh = new T.Mesh(geo, material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function cylinder(x, y, z, r, h, color) {
    const mesh = new T.Mesh(
      new T.CylinderGeometry(r, r, h, 32),
      material(color),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function sphere(x, y, z, r, color, sx = 1, sy = 1, sz = 1) {
    const mesh = new T.Mesh(new T.SphereGeometry(r, 24, 16), material(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function tube(points, r, color) {
    const mesh = new T.Mesh(
      new T.TubeGeometry(
        new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p))),
        40,
        r,
        8,
        false,
      ),
      material(color, true),
    );
    scene.add(mesh);
    return mesh;
  }
  // Raised architectural plinth and layered trim give the room weight.
  rounded(0, -0.48, 0, 22.4, 0.7, 18.6, "#c6bdcf", 0.2);
  rounded(0, -0.12, 0, 21.7, 0.13, 18, palette.accent, 0.04);
  // Tall rear wall, oak acoustic slats and large framed windows.
  cube(0, 2.15, -8.65, 22, 4.6, 0.25, palette.wall);
  for (const x of [-9.8, -9.45, -9.1, 9.1, 9.45, 9.8])
    cube(x, 2.25, -8.47, 0.14, 4.3, 0.12, "#cbb79b");
  for (const x of [-5.4, 5.4]) {
    rounded(x, 2.6, -8.42, 5.5, 3.2, 0.12, palette.metal, 0.2);
    rounded(x, 2.6, -8.32, 5.23, 2.92, 0.06, "#bcd9df", 0.16);
    cube(x, 2.65, -8.27, 0.055, 2.9, 0.05, "#f9f2df");
    cube(x, 2.35, -8.27, 5.23, 0.055, 0.05, "#f9f2df");
    // Stylized distant scenery behind the window frame.
    sphere(x - 1.3, 2.8, -8.29, 0.65, "#e7edcf", 1, 1, 0.03);
    rounded(x, 1.12, -8.1, 5.7, 0.15, 0.65, "#d4b99a", 0.04);
    for (const offset of [-1.8, 1.8]) {
      cylinder(x + offset, 1.4, -8.1, 0.19, 0.4, "#fcf0d9");
      for (let n = 0; n < 4; n++)
        sphere(
          x + offset + Math.cos(n * 2) * 0.12,
          1.78 + n * 0.04,
          -8.1,
          0.17,
          "#749d80",
          0.65,
          1.4,
          0.6,
        );
    }
  }
  // A sculpted center arch and warm inset strip, beyond the rear boundary.
  const archPoints = [
    [-2, 0, -8.25],
    [-2, 2.5, -8.25],
    [-1.8, 3.8, -8.25],
    [0, 4.35, -8.25],
    [1.8, 3.8, -8.25],
    [2, 2.5, -8.25],
    [2, 0, -8.25],
  ];
  tube(archPoints, 0.16, palette.accent);
  tube(
    archPoints.map(([x, y, z]) => [x * 0.92, y * 0.97, z + 0.07]),
    0.025,
    "#ffe2a2",
  );
  // Slim side walls and continuous handrails keep the view open.
  for (const side of [-1, 1]) {
    cube(side * 10.65, 0.6, 0, 0.2, 1.35, 17.4, palette.wall);
    rounded(side * 10.65, 1.32, 0, 0.24, 0.09, 17.5, palette.accent, 0.02);
    for (const z of [-6, -2, 2, 6])
      cube(side * 10.62, 0.63, z, 0.08, 1.2, 0.08, palette.metal, true);
    // Large planters are outside the walkable area, never invisible obstacles.
    for (const z of [-6.5, 6.5]) {
      cylinder(side * 11.2, 0.4, z, 0.5, 0.8, "#f6eddf");
      cylinder(side * 11.2, 0.82, z, 0.43, 0.04, "#7c6a58");
      for (let n = 0; n < 7; n++) {
        const leaf = sphere(
          side * 11.2 + Math.cos(n * 2.4) * 0.3,
          1.4 + (n % 3) * 0.28,
          z + Math.sin(n * 2.4) * 0.3,
          0.3,
          n % 2 ? "#658d78" : "#8bab81",
          0.55,
          1.7,
          0.8,
        );
        leaf.rotation.z = Math.sin(n) * 0.45;
      }
    }
  }
  // Decorative wall shelves, books, ceramics and architectural lighting.
  for (const side of [-1, 1]) {
    const x = side * 8.1;
    rounded(x, 2.2, -8.15, 1.1, 0.1, 0.65, "#c4a681", 0.02);
    for (let n = 0; n < 4; n++)
      rounded(
        x - 0.36 + n * 0.22,
        2.55,
        -8.18,
        0.15,
        0.58,
        0.3,
        [palette.accent, palette.secondary, "#a3b8ac", "#f2d79c"][n],
        0.02,
      );
    const light = new T.PointLight("#ffdda5", 6, 8, 2);
    light.position.set(side * 7, 3.8, -7);
    scene.add(light);
    cylinder(side * 7, 3.7, -8.1, 0.34, 0.2, "#fff1d0");
    cube(side * 7, 4.2, -8.25, 0.04, 0.8, 0.04, palette.metal, true);
  }
  // Overhead sign reads as architecture, not an instruction popup.
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 144;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.roundRect(0, 0, 768, 144, 28);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 48px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    {
      portal: "PORTAL LAB",
      cafe: "THE PLAYHOUSE CAFE",
      rescue: "ROOM RESCUE",
      train: "LITTLE RAILWAY",
      workshop: "THE WORKSHOP",
    }[id],
    384,
    72,
    720,
  );
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const sign = new T.Mesh(
    new T.PlaneGeometry(5.8, 1.08),
    new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }),
  );
  sign.position.set(0, 4.9, -8.5);
  scene.add(sign);
}
