import * as T from "../vendor/three.module.js";
import { character, animateCharacter } from "../characters.js";
import { targets, bridgeOpen, getRoute } from "./practice.js";
import { furnishRoom, palettes } from "./environment.js";

export function createStage(host, s, avatar = 0) {
  const route = getRoute(s),
    gearTargets = s.config?.gears || [1, 2, 3];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const palette = palettes[s.id];
  const scene = new T.Scene();
  scene.background = new T.Color(palette.sky);
  scene.fog = new T.Fog(palette.sky, 55, 90);
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.append(renderer.domElement);
  const camera = new T.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 19, 25);
  camera.lookAt(0, 0, -0.7);
  const hemi = new T.HemisphereLight("#fff8e7", "#8d9e93", 1.65);
  scene.add(hemi);
  const sun = new T.DirectionalLight("#fff2d7", 2.2);
  sun.position.set(-9, 18, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -16,
    right: 16,
    top: 16,
    bottom: -16,
  });
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  const mats = new Map(),
    textures = [];
  function mat(color) {
    if (!mats.has(color))
      mats.set(color, new T.MeshStandardMaterial({ color, roughness: 0.7 }));
    return mats.get(color);
  }
  function box(parent, x, y, z, w, h, d, c, round = false) {
    let geo;
    if (round) {
      const sh = new T.Shape(),
        r = Math.min(0.15, w / 3, h / 3);
      sh.moveTo(-w / 2 + r, -h / 2);
      sh.lineTo(w / 2 - r, -h / 2);
      sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      sh.lineTo(w / 2, h / 2 - r);
      sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      sh.lineTo(-w / 2 + r, h / 2);
      sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      sh.lineTo(-w / 2, -h / 2 + r);
      sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      geo = new T.ExtrudeGeometry(sh, {
        depth: Math.max(0.02, d - 0.16),
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.04,
        bevelSegments: 2,
        steps: 1,
      });
      geo.center();
    } else geo = new T.BoxGeometry(w, h, d);
    const m = new T.Mesh(geo, mat(c));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function ball(parent, x, y, z, r, c, sx = 1, sy = 1, sz = 1) {
    const m = new T.Mesh(new T.SphereGeometry(r, 16, 12), mat(c));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(parent, x, y, z, r, h, c) {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 24), mat(c));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function label(text, x, y, z, color = "#294b40", scale = 3) {
    const cv = document.createElement("canvas");
    cv.width = 512;
    cv.height = 112;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fffdf1";
    ctx.beginPath();
    ctx.roundRect(2, 2, 508, 108, 24);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "600 38px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 56, 480);
    const tx = new T.CanvasTexture(cv);
    tx.colorSpace = T.SRGBColorSpace;
    textures.push(tx);
    const sprite = new T.Sprite(
      new T.SpriteMaterial({ map: tx, depthTest: false, toneMapped: false }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale * 0.22, 1);
    scene.add(sprite);
    return sprite;
  }
  function ring(x, z, c, r = 0.8) {
    const m = new T.Mesh(
      new T.RingGeometry(r - 0.07, r, 48),
      new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.035, z);
    scene.add(m);
    return m;
  }
  function plant(x, z) {
    cyl(scene, x, 0.3, z, 0.35, 0.6, "#eee8dc");
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4;
      ball(
        scene,
        x + Math.cos(a) * 0.22,
        0.9 + (i % 2) * 0.25,
        z + Math.sin(a) * 0.22,
        0.3,
        i % 2 ? "#6f9978" : "#3e6c59",
        0.5,
        1.7,
        0.8,
      );
    }
  }
  function sofa(parent, x, z, c = "#9bac9b") {
    const g = new T.Group();
    g.position.set(x, 0, z);
    parent.add(g);
    box(g, 0, 0.6, 0, 3.4, 0.6, 1.3, c, true);
    box(g, 0, 1.15, -0.5, 3.4, 0.8, 0.3, c, true);
    for (const side of [-1, 1]) {
      box(g, side * 1.65, 0.92, 0, 0.3, 0.65, 1.4, c, true);
      box(g, side * 1.25, 0.2, 0.4, 0.13, 0.35, 0.13, "#796049");
      box(g, side * 0.8, 0.99, -0.1, 1.1, 0.22, 0.9, "#d4d8bf", true);
    }
    return g;
  }
  function track(x, z, parent = scene) {
    const g = new T.Group();
    g.position.set(x, 0.07, z);
    parent.add(g);
    for (let i = 0; i < 5; i++)
      box(g, -1.2 + i * 0.6, 0.04, 0, 0.16, 0.13, 1.25, "#917958");
    for (const side of [-1, 1])
      box(g, 0, 0.15, side * 0.44, 2.9, 0.12, 0.08, "#818e8b");
    return g;
  }
  function food(parent, kind) {
    const g = new T.Group();
    parent.add(g);
    cyl(g, 0, 0, 0, 0.35, 0.1, "#faf5e4");
    if (kind.includes("soup")) {
      cyl(g, 0, 0.12, 0, 0.28, 0.2, "#c78453");
      cyl(g, 0, 0.24, 0, 0.24, 0.02, "#e3b84d");
    } else
      for (let i = 0; i < 6; i++)
        ball(
          g,
          Math.cos(i) * 0.2,
          0.15,
          Math.sin(i) * 0.2,
          0.13,
          i % 2 ? "#86a463" : "#d47b59",
        );
    return g;
  }
  const accent = palette.accent;
  furnishRoom(scene, s.id);
  box(scene, 0, -0.32, 0, 21, 0.6, 17, "#d9d1bc", true);
  for (let x = -10; x < 10; x += 2)
    for (let z = -8; z < 8; z += 2)
      box(
        scene,
        x + 1,
        0.002,
        z + 1,
        1.98,
        0.02,
        1.98,
        (x + z) % 4 ? "#f5eee6" : palette.floor,
      );
  box(scene, 0, 0.65, -8.1, 21, 1.3, 0.25, "#cad4c6");
  box(scene, -10.3, 0.35, 0, 0.25, 0.7, 16, "#cad4c6");
  box(scene, 10.3, 0.35, 0, 0.25, 0.7, 16, "#cad4c6");
  for (const x of [-9, 9]) plant(x, -7);
  const actors = s.players.map((p, i) => {
    const a = character(
      p.avatarId
        ? Number(p.avatarId.slice(-2)) - 1
        : i
          ? (avatar + 3) % 20
          : avatar,
    );
    scene.add(a);
    a.scale.setScalar(0.82);
    return a;
  });
  const selectors = s.players.map((p, i) =>
    ring(p.x, p.z, i ? "#ba9166" : "#3d7c67", 0.55),
  );
  const badges = s.players.map((p, i) =>
    label(p.name || "Teammate " + (i + 1), p.x, 2.35, p.z, "#365c48", 2.2),
  );
  const carried = [null, null];
  let bridge, sofaMesh, train, portalGlow;
  const crystals = [],
    itemMeshes = [],
    railMeshes = [],
    gearMeshes = [],
    gearLabels = [],
    socketLights = [],
    steam = [];
  if (s.id === "portal") {
    box(scene, 0, 0.04, 0, 20, 0.1, 2.2, "#526c6b");
    bridge = new T.Group();
    scene.add(bridge);
    for (let z = -1; z <= 1; z += 0.4)
      box(bridge, 0, 0.12, z, 2.3, 0.2, 0.35, "#bda780");
    ring(-5, 3, "#cda84c", 1.2);
    cyl(scene, -5, 0.09, 3, 1, 0.12, "#d1b35f");
    box(scene, 2, 0.6, -4, 0.7, 1.2, 0.7, "#a3b6a7", true);
    const lever = box(scene, 2, 1.4, -4, 0.1, 0.7, 0.1, "#535f56");
    lever.rotation.z = 0.4;
    ball(scene, 2.13, 1.75, -4, 0.16, "#c99d52");
    for (const x of [-6, 6]) {
      const c = new T.Mesh(
        new T.OctahedronGeometry(0.55),
        new T.MeshStandardMaterial({
          color: "#a1d1c1",
          metalness: 0.35,
          roughness: 0.15,
          emissive: "#3c8877",
          emissiveIntensity: 0.3,
        }),
      );
      c.position.set(x, 1, -5);
      scene.add(c);
      crystals.push(c);
    }
    box(scene, -1.3, 1.5, -7, 0.3, 3, 0.5, accent, true);
    box(scene, 1.3, 1.5, -7, 0.3, 3, 0.5, accent, true);
    box(scene, 0, 3, -7, 2.9, 0.3, 0.5, accent, true);
    ring(0, -7, "#79aa8a", 1.6);
  }
  if (s.id === "cafe") {
    for (const x of [-7, -3, 2, 7]) {
      box(scene, x, 0.6, -5, 2.7, 1.2, 1.4, "#c1cdb5", true);
      box(scene, x, 1.24, -5, 2.8, 0.12, 1.5, "#faf5e7");
    }
    for (const x of [-7, -3]) {
      box(scene, x, 1.45, -5, 1.5, 0.4, 0.8, "#b49970", true);
      food(scene, x === -7 ? "salad" : "soup").position.set(x, 1.7, -5);
    }
    box(scene, 2, 1.34, -5, 1.3, 0.08, 0.8, "#b69b72");
    box(scene, 2.4, 1.46, -5, 0.5, 0.1, 0.1, "#a2b5b4");
    cyl(scene, 7, 1.45, -5, 0.5, 0.35, "#5c726a");
    cyl(scene, 7, 1.64, -5, 0.42, 0.02, "#e2b354");
    for (let i = 0; i < 5; i++)
      steam.push(ball(scene, 7, 1.9 + i * 0.2, -5, 0.1, "#f2efe3"));
    box(scene, 6, 0.6, 4, 3, 1.2, 1.1, "#cda27c", true);
    box(scene, 6, 1.25, 4, 3.1, 0.12, 1.2, "#fff5e4");
    cyl(scene, -7, 0.5, 4, 0.5, 1, "#899d90");
    if (s.level >= 3) {
      ring(0, 3, accent, 0.7);
      cyl(scene, 0, 0.12, 3, 0.55, 0.2, "#d6b58c");
      label("PASS HERE", 0, 0.5, 3, accent, 1.5);
    }
  }
  if (s.id === "rescue") {
    box(scene, 0, 0.8, -4.8, 0.3, 1.6, 6.7, "#9faea3");
    box(scene, 0, 0.8, 4.8, 0.3, 1.6, 6.7, "#9faea3");
    for (let i = 0; i < 4; i++) {
      const g = new T.Group();
      scene.add(g);
      g.position.set(-7, 0, i * 3 - 5);
      if (i === 0) {
        cyl(g, 0, 0.35, 0, 0.35, 0.7, "#bd947c");
        ball(g, 0, 1, 0, 0.45, "#699775", 0.7, 1.3, 0.7);
      }
      if (i === 1) {
        box(g, 0, 0.4, 0, 1, 0.8, 0.8, "#bca486", true);
        box(g, 0, 0.87, 0, 1.1, 0.12, 0.9, "#e5d7b9");
      }
      if (i === 2) {
        cyl(g, 0, 0.08, 0, 0.35, 0.12, "#586e64");
        cyl(g, 0, 0.65, 0, 0.04, 1.2, "#586e64");
        cyl(g, 0, 1.3, 0, 0.4, 0.4, "#ebd7a0");
      }
      if (i === 3) {
        box(g, 0, 0.4, 0, 0.9, 0.8, 0.5, "#b99b70", true);
        for (let n = 0; n < 4; n++)
          box(
            g,
            -0.3 + n * 0.2,
            0.6,
            0.28,
            0.12,
            0.5,
            0.2,
            ["#a0b5aa", "#d4aa87", "#a9a3bf", "#d3c18d"][n],
          );
      }
      itemMeshes.push(g);
      ring(7, i * 3 - 5, accent);
    }
    sofaMesh = sofa(scene, -5, 0);
    sofaMesh.rotation.y = Math.PI / 2;
    ring(5, 0, accent, 1.7);
  }
  if (s.id === "train") {
    for (const [i, r] of route.entries()) {
      ring(r.x, r.z, "#b59a62", 0.65);
      const tr = track(r.x, r.z);
      tr.rotation.y = (r.rotation * Math.PI) / 2;
      if (s.level > 1) {
        const previous = route[i - 1] || { x: r.x - 3, z: r.z };
        tr.position.x = (r.x + previous.x) / 2;
        tr.position.z = (r.z + previous.z) / 2;
      }
      tr.visible = false;
      railMeshes.push(tr);
      label(
        String(i + 1) + (r.rotation ? " ↕" : " ↔"),
        r.x,
        0.4,
        r.z,
        "#615236",
        1.1,
      );
    }
    box(scene, -7, 0.6, 6, 3, 1.2, 1.5, "#b89a71", true);
    track(0, 0, scene).position.set(-7, 1.3, 6);
    train = new T.Group();
    scene.add(train);
    box(train, 0, 0.65, 0, 1.6, 0.7, 1, "#659c8c", true);
    cyl(train, 0.7, 0.9, 0, 0.4, 0.8, "#6e9c84");
    box(train, -0.4, 1.3, 0, 0.9, 0.8, 1, "#c8ab68", true);
    box(train, -0.4, 1.8, 0, 1.1, 0.15, 1.2, "#536e62", true);
    for (const side of [-1, 1])
      for (const x of [-0.55, 0.55]) {
        const wh = cyl(train, x, 0.3, side * 0.55, 0.28, 0.12, "#485d56");
        wh.rotation.x = Math.PI / 2;
      }
    const end = route.at(-1);
    box(scene, end.x, 0.2, end.z - 2, 2, 0.4, 2, "#b0b99d");
    box(scene, end.x, 1, end.z - 3, 0.2, 2, 0.2, "#718a76");
    label("STATION", end.x, 2.2, end.z - 3, "#365c48", 2.1);
  }
  if (s.id === "workshop") {
    box(scene, 0, 0.55, -5, 17, 1.1, 1.3, "#b1c4b7", true);
    for (let i = 0; i < 3; i++) {
      const x = -6 + i * 6,
        g = new T.Group();
      g.position.set(x, 1.4, -5);
      scene.add(g);
      cyl(g, 0, 0, 0, 0.6, 0.2, "#c6a76a");
      for (let j = 0; j < 10; j++) {
        const a = (j * Math.PI) / 5,
          m = box(
            g,
            Math.cos(a) * 0.65,
            0,
            Math.sin(a) * 0.65,
            0.22,
            0.25,
            0.25,
            "#c6a76a",
          );
        m.rotation.y = -a;
      }
      gearMeshes.push(g);
      gearLabels.push(label("0 → " + gearTargets[i], x, 2.5, -5, "#365c48", 2));
      box(scene, x, 0.45, -2, 1.2, 0.9, 1, "#8daaa2", true);
      socketLights.push(ball(scene, x, 0.95, -2, 0.24, "#d6b987"));
      label(
        String.fromCharCode(65 + (s.config?.sockets[i] ?? i)),
        x,
        1.5,
        -2,
        "#365c48",
        0.9,
      );
      cyl(scene, x, 0.15, 1, 0.4, 0.3, ["#b97b62", "#8c9bb8", "#a9b77a"][i]);
    }
    for (const x of [-4, 4]) {
      cyl(scene, x, 0.1, 5, 0.85, 0.2, "#c5b58d");
      ring(x, 5, "#79a58b", 1);
    }
    const torus = new T.Mesh(
      new T.TorusGeometry(1.5, 0.2, 12, 48),
      mat("#809e90"),
    );
    torus.position.set(0, 2, 2);
    scene.add(torus);
    portalGlow = new T.Mesh(
      new T.CircleGeometry(1.3, 48),
      new T.MeshBasicMaterial({
        color: "#91d7bd",
        transparent: true,
        opacity: 0.1,
        side: T.DoubleSide,
      }),
    );
    portalGlow.position.set(0, 2, 2);
    scene.add(portalGlow);
  }
  // Persistent, legible world markers; interaction stays proximity-based.
  const markers = targets(s).map((t) => ({
    id: t.id,
    x: t.x,
    z: t.z,
    sprite: label(
      s.id === "cafe" && t.id === "serve" ? "Serve current order" : t.label,
      t.x,
      2.1,
      t.z,
      "#403650",
      3.6,
    ),
  }));
  let lastLabel = "";
  function updateGearLabels() {
    const key = s.gears.join(",");
    if (key === lastLabel) return;
    lastLabel = key;
    gearLabels.forEach((old, i) => {
      scene.remove(old);
      old.material.map.dispose();
      old.material.dispose();
      gearLabels[i] = label(
        s.gears[i] + " → " + gearTargets[i],
        -6 + i * 6,
        2.5,
        -5,
        s.gears[i] === gearTargets[i] ? "#287c51" : "#845b38",
        2,
      );
    });
  }
  function heldModel(held) {
    const g = new T.Group();
    if (held.includes("salad") || held.includes("soup")) food(g, held);
    else if (held === "track") track(0, 0, g).scale.setScalar(0.35);
    else if (held.startsWith("cable")) {
      const m = new T.Mesh(
        new T.TorusGeometry(0.25, 0.045, 8, 20),
        mat(["#b97b62", "#8c9bb8", "#a9b77a"][Number(held.slice(-1))]),
      );
      g.add(m);
    } else box(g, 0, 0, 0, 0.55, 0.55, 0.55, accent, true);
    return g;
  }
  const observer = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (w && h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  });
  observer.observe(host);
  return {
    render(dt, time) {
      if (reduceMotion) time = 0;
      actors.forEach((a, i) => {
        const p = s.players[i],
          moved = Math.hypot(a.position.x - p.x, a.position.z - p.z) > 0.01;
        const dx = p.x - a.position.x,
          dz = p.z - a.position.z;
        if (moved) a.rotation.y = Math.atan2(dx, dz);
        a.position.x = p.x;
        a.position.z = p.z;
        animateCharacter(a, time, moved);
        selectors[i].position.set(p.x, 0.04, p.z);
        selectors[i].visible = s.active === i;
        badges[i].position.set(p.x, 2.35, p.z);
        if (carried[i]?.userData.held !== p.held) {
          if (carried[i]) {
            a.remove(carried[i]);
            carried[i].traverse((o) => o.geometry?.dispose());
            carried[i] = null;
          }
          if (p.held) {
            const item = heldModel(p.held);
            item.userData.held = p.held;
            item.position.set(0, 1, 0.65);
            a.add(item);
            carried[i] = item;
          }
        }
        if (p.held || s.carrySofa) {
          a.userData.limbs[1].rotation.x = -1;
          a.userData.limbs[3].rotation.x = -1;
        }
      });
      actors.forEach((a, i) => {
        a.visible = s.players[i].visible !== false;
        badges[i].visible = a.visible;
        selectors[i].visible = a.visible && s.active === i;
      });
      if (bridge) {
        bridge.scale.z =
          (s.authoritativeBridgeOpen ?? bridgeOpen(s)) ? 1 : 0.02;
        crystals.forEach((c, i) => {
          c.visible = !s.crystals[i];
          c.rotation.y = time * 0.5;
          c.position.y = 1 + Math.sin(time * 2) * 0.08;
        });
      }
      if (sofaMesh) {
        if (s.carrySofa) {
          const p = s.players[s.active];
          sofaMesh.position.set(p.x, 0.35, p.z);
          sofaMesh.rotation.y = (s.rotation * Math.PI) / 2;
        } else if (s.sofaDone) {
          sofaMesh.position.set(5, 0, 0);
          sofaMesh.rotation.y = 0;
        }
        itemMeshes.forEach((m, i) => {
          m.visible = !s.players.some((p) => p.held === "item-" + i);
          m.position.x = s.items[i] ? 7 : -7;
        });
      }
      if (train) {
        railMeshes.forEach((m, i) => (m.visible = s.rails[i]));
        const start = { x: route[0].x - 3, z: route[0].z },
          points = [start, ...route],
          progress = Math.min(6, Math.max(0, (s.elapsed - 25) / 10)),
          index = Math.min(5, Math.floor(progress)),
          from = points[index],
          to = points[index + 1],
          mix = progress - index;
        train.position.set(
          from.x + (to.x - from.x) * mix,
          0,
          from.z + (to.z - from.z) * mix,
        );
        train.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
        train.children.forEach((m, i) => {
          if (i > 3) m.rotation.z = -time * 3;
        });
      }
      if (gearMeshes.length) {
        gearMeshes.forEach(
          (g, i) =>
            (g.rotation.y = T.MathUtils.lerp(
              g.rotation.y,
              (s.gears[i] * Math.PI) / 2,
              Math.min(1, dt * 6),
            )),
        );
        updateGearLabels();
        socketLights.forEach(
          (m, i) => (m.material = mat(s.sockets[i] ? "#83c99b" : "#d6b987")),
        );
        portalGlow.material.opacity = s.status === "won" ? 0.85 : 0.1;
      }
      steam.forEach((p, i) => {
        p.visible = Boolean(s.job?.dish === "soup");
        p.position.y = 1.9 + ((time + i * 0.3) % 1.3);
        p.scale.setScalar(0.6 + ((time + i * 0.3) % 1.3));
      });
      const available = new Set(targets(s).map((t) => t.id));
      markers.forEach(
        (m) =>
          (m.sprite.visible =
            available.has(m.id) &&
            Math.hypot(
              m.x - s.players[s.active].x,
              m.z - s.players[s.active].z,
            ) < 3.1),
      );
      renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          for (const m of [].concat(o.material)) {
            m.map?.dispose();
            m.dispose();
          }
        }
      });
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
