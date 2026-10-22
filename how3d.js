/* FIELDWRX · How we work: a lit 3D field of the brand's squares, flown through as you scroll.
   Shu: the field rises and a red sphere rolls across it, pressing each column as it reads it.
   Ha: columns split apart. Automated work turns blue and rises, simplified work drops low, stopped work flushes red and sinks away.
   Ri: the field is rebuilt as one rising order, blue at the summit, and the sphere drops onto the top.
   Scroll sets where every column is headed; springs get it there, so things overshoot, settle and react.
   The page calls window.HOW3D.frame(p) with scroll progress p in 0..1, every animation frame. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Pass } from "three/addons/postprocessing/Pass.js";

const stage = document.querySelector(".how-stage");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* a pass that only flips an object's visibility, so the glow stays out of the occlusion pass */
class Show extends Pass {
  constructor(obj, on) { super(); this.obj = obj; this.on = on; this.needsSwap = false; }
  render() { this.obj.visible = this.on && this.obj.userData.want; }
}

function boot() {
  if (!stage || RM) return;
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) return;

  const COLS = 18, ROWS = 11, N = COLS * ROWS, GAP = 1.06, SIZE = .76, R = .58, BEV = .06;
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const span = (p, a, b) => clamp((p - a) / (b - a));
  const eio = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const eo = (t) => 1 - Math.pow(1 - t, 3);
  const mix = (a, b, t) => a + (b - a) * t;

  /* fixed fates, so everyone sees the same film */
  let seed = 29; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const order = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const fate = new Array(N); order.forEach((q, k) => (fate[q] = k < 34 ? "a" : k < 62 ? "s" : k < 88 ? "x" : "k"));
  const noise = Array.from({ length: N }, () => rnd());

  /* renderer */
  const wide = () => stage.clientWidth >= 900;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(wide() ? 1.5 : 2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .82;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cv = renderer.domElement;
  cv.className = "how-gl"; cv.setAttribute("aria-hidden", "true");
  stage.insertBefore(cv, stage.querySelector(".how-cv"));

  const bgCss = getComputedStyle(document.documentElement).getPropertyValue("--ink-bg").trim() || "#0F1013";
  const BG = new THREE.Color(bgCss);
  const scene = new THREE.Scene();
  scene.background = BG.clone();
  scene.fog = new THREE.Fog(BG.clone(), 26, 52);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;

  /* light: a soft key from the upper left, a cool rim behind */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x0b0c10, .12));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.5);
  key.position.set(-12, 15, 5); key.castShadow = true;
  key.shadow.mapSize.set(wide() ? 2048 : 1024, wide() ? 2048 : 1024);
  Object.assign(key.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 });
  key.shadow.bias = -.0004; key.shadow.normalBias = .02; key.shadow.radius = 5;
  scene.add(key); scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xbfd0ff, .7); rim.position.set(12, 5, -12); scene.add(rim);

  /* floor: the page itself, only the shadows show */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x000000, opacity: .55 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  /* the squares, as columns with softened edges that catch the light.
     The bevel is kept a fixed size however tall a column is stretched, and the sides darken where they meet the floor. */
  const geo = new RoundedBoxGeometry(1, 1, 1, 3, BEV); geo.translate(0, .5, 0);
  const VDECL = "varying float vFwxY; varying float vFwxNy; varying float vFwxNb; varying float vFwxTop;\n", DDECL = "varying float vFwxY;\n";
  const keepBevel = (withNormal) => `#include <begin_vertex>
    #ifdef USE_INSTANCING
      float fwxS = max(length(instanceMatrix[1].xyz), 1e-4);
      float fwxE = min(${BEV.toFixed(3)}, .5 * fwxS) / ${BEV.toFixed(3)};
      transformed.y = transformed.y > .5 ? 1. - (1. - transformed.y) * fwxE / fwxS : transformed.y * fwxE / fwxS;
      vFwxY = instanceMatrix[3].y + transformed.y * fwxS;
    #else
      vFwxY = transformed.y;
    #endif
    ${withNormal ? "vFwxNy = objectNormal.y; vFwxNb = aNb; vFwxTop = instanceMatrix[3].y + fwxS;" : ""}`;
  const mat = new THREE.MeshStandardMaterial({ roughness: .36, metalness: 0, envMapIntensity: .28 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aNb;\n" + VDECL).replace("#include <begin_vertex>", keepBevel(true));
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + VDECL).replace("#include <color_fragment>", `#include <color_fragment>
      if (vFwxY < -.002) discard;   /* stopped work sinks through the floor, not under it */
      /* contact shading from the neighbours: sides darken toward the floor, deeper in tall valleys; low tops darken beside tall columns */
      float fwxSide = 1. - smoothstep(.45, .85, abs(vFwxNy));
      float fwxReach = max(.6, .85 * vFwxNb);
      float fwxSideShade = mix(.34, 1., smoothstep(0., fwxReach, vFwxY));
      float fwxTopShade = 1. - .3 * smoothstep(0., 1.8, vFwxNb - vFwxTop);
      diffuseColor.rgb *= mix(fwxTopShade, fwxSideShade, fwxSide);`);
  };
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + DDECL).replace("#include <begin_vertex>", keepBevel(false));
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + DDECL).replace("void main() {", "void main() {\n if (vFwxY < -.002) discard;");
  };
  const nb = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); nb.setUsage(THREE.DynamicDrawUsage); geo.setAttribute("aNb", nb);
  const boxes = new THREE.InstancedMesh(geo, mat, N);
  boxes.customDepthMaterial = depthMat;
  boxes.castShadow = true; boxes.receiveShadow = true;
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(boxes);
  const WHITE = new THREE.Color("#F3F2EF"), BLUE = new THREE.Color("#2F5BFF"), RED = new THREE.Color("#E8392F"), DIM = new THREE.Color("#9da0a8");
  const col = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const home = Array.from({ length: N }, (_, i) => { const c = i % COLS, r = Math.floor(i / COLS); return { c, r, x: (c - (COLS - 1) / 2) * GAP, z: (r - (ROWS - 1) / 2) * GAP }; });

  /* the circle: a glossy sphere that lights what it touches */
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), new THREE.MeshPhysicalMaterial({ color: RED, emissive: RED, emissiveIntensity: .12, roughness: .18, clearcoat: 1, clearcoatRoughness: .06, envMapIntensity: 1.2 }));
  ball.castShadow = true; scene.add(ball);
  const spill = new THREE.PointLight(0xff3b2b, 0, 6.5, 2); scene.add(spill);
  const gc = document.createElement("canvas"); gc.width = gc.height = 128;
  const gx = gc.getContext("2d"), gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gg.addColorStop(0, "rgba(255,90,70,1)"); gg.addColorStop(.25, "rgba(255,60,45,.45)"); gg.addColorStop(.6, "rgba(232,57,47,.1)"); gg.addColorStop(1, "rgba(232,57,47,0)");
  gx.fillStyle = gg; gx.fillRect(0, 0, 128, 128);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .55, fog: false }));
  glow.scale.setScalar(R * 5.2); glow.renderOrder = 2; scene.add(glow);

  /* camera path: [p, azimuth°, elevation°, distance, target y] */
  const KEYS = [[0, -40, 62, 40, 0], [.1, -34, 38, 30, .4], [.3, 4, 32, 27, .5], [.365, 96, 42, 30, .6], [.62, 128, 36, 27, .7], [.69, 214, 54, 33, .9], [.86, 226, 38, 29, 1.5], [1, 234, 33, 28, 1.9]];
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 200);
  const tgt = new THREE.Vector3();
  function camAt(p) {
    let k = 0; while (k < KEYS.length - 2 && p > KEYS[k + 1][0]) k++;
    const A = KEYS[k], B = KEYS[k + 1], u = eio(clamp((p - A[0]) / (B[0] - A[0])));
    return { az: mix(A[1], B[1], u) * Math.PI / 180, el: mix(A[2], B[2], u) * Math.PI / 180, d: mix(A[3], B[3], u), ty: mix(A[4], B[4], u) };
  }

  /* post: lens blur on larger screens (the glow is kept out of its depth pass), and a trail that only shows when the camera whips */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new Show(glow, false));
  const bokeh = new BokehPass(scene, camera, { focus: 16, aperture: .00003, maxblur: .0035 });
  composer.addPass(bokeh);
  composer.addPass(new Show(glow, true));
  const trail = new AfterimagePass(0); composer.addPass(trail);
  composer.addPass(new OutputPass());

  let W = 0, H = 0;
  function resize() {
    W = stage.clientWidth; H = stage.clientHeight;
    if (!wide()) {   /* phones: the scene gets its own band above the copy, so the two never overlap */
      const top0 = stage.getBoundingClientRect().top;
      let b = H;
      stage.querySelectorAll(".how-step").forEach((s) => { b = Math.min(b, s.getBoundingClientRect().top - top0); });
      H = Math.round(Math.max(H * .34, Math.min(H * .62, b - 10)));
    }
    cv.style.height = wide() ? "" : H + "px";
    renderer.setSize(W, H, false); composer.setSize(W, H);
    camera.aspect = W / H;
    camera.clearViewOffset();
    camera.fov = wide() ? 32 : 44;
    camera.updateProjectionMatrix();
    bokeh.enabled = wide();
    lastP = -1;
  }
  const ro = new ResizeObserver(resize); ro.observe(stage); stage.querySelectorAll(".how-step").forEach((s) => ro.observe(s));
  if (document.fonts) document.fonts.ready.then(resize);

  /* where each column is headed (set by scroll), and where it is (springs) */
  const hT = new Float32Array(N), yT = new Float32Array(N), wT = new Float32Array(N);
  const hC = new Float32Array(N), hV = new Float32Array(N), yC = new Float32Array(N), yV = new Float32Array(N);
  const K = Float32Array.from({ length: N }, (_, i) => (150 + 90 * noise[i]) * (fate[i] === "a" ? .62 : 1));
  const Z = .34;   /* damping ratio: under 1 means a column overshoots before it settles */
  const SUMMIT = N - 1;
  let ballX = 0, ballZ = 0, mode = "off";

  function targets(p) {
    const scan = span(p, .12, .31), span0 = (COLS - 1) * GAP / 2 + 2.4, scanX = mix(-span0, span0, scan);
    const rolling = scan > 0 && scan < 1;
    for (let i = 0; i < N; i++) {
      const h0 = home[i], f = fate[i], n = noise[i], d = h0.c + (ROWS - 1 - h0.r);
      /* shu: rise in a wave from the front corner; the sphere presses each column it passes, and read columns stand a little taller */
      const ap = eo(span(p, d * .0045, .07 + d * .0045));
      const read = scan > 0 ? clamp((scanX - h0.x) / 1.6) : 0;
      let h = mix(.02, .18 + .3 * n + .09 * read * (1 - span(p, .33, .4)), ap), w = SIZE, y = 0;
      if (rolling) { const dx = h0.x - scanX, dz = h0.z; h -= .24 * Math.exp(-(dx * dx + dz * dz) / .6); }
      col.copy(WHITE).lerp(DIM, .45 * (1 - read) * ap);
      /* ha */
      if (f === "a") { const t = eio(span(p, .38 + h0.c * .004, .48 + h0.c * .004)); h = mix(h, 1.5 + 1.4 * n, t); col.lerp(BLUE, t); }
      if (f === "s") { const t = eio(span(p, .44 + h0.c * .004, .54 + h0.c * .004)); h = mix(h, .12, t); w = mix(SIZE, SIZE * .62, t); }
      if (f === "x") {
        const flush = span(p, .5 + h0.c * .003, .54 + h0.c * .003); col.lerp(RED, flush);
        const t = eio(span(p, .55 + h0.c * .004, .63 + h0.c * .004)); y = -(h + .05) * t;
      }
      /* ri: everything is rebuilt into one rising order, the stopped gaps refilled with new work */
      const tr = eio(span(p, .7 + d * .0045, .86 + d * .0045));
      if (tr > 0) {
        const g = clamp((h0.c / (COLS - 1)) * .6 + (h0.r / (ROWS - 1)) * .4), step = Math.min(6, Math.floor(g * 7)), hr = .22 + step * .72;   /* terraces climbing away */
        h = mix(h, hr, tr); w = mix(w, SIZE, tr); y = mix(y, 0, tr);
        col.lerp(step >= 5 ? BLUE : WHITE, tr);
      }
      hT[i] = Math.max(.02, h); yT[i] = y; wT[i] = w;
      boxes.setColorAt(i, col);
    }
    boxes.instanceColor.needsUpdate = true;
    if (rolling) { if (mode !== "roll") { by = 0; bvy = 0; } mode = "roll"; ballX = scanX; ballZ = 0; }
    else if (p >= .9) { if (mode !== "drop" && mode !== "rest") startDrop(); }
    else mode = "off";
  }

  /* the sphere: real gravity, resting on whatever columns are under it */
  let by = 0, bvy = 0, sq = 0, sqv = 0, hold = 0, rebound = 0;
  function surfaceAt(x, z) {
    let top = R;
    const c0 = Math.round(x / GAP + (COLS - 1) / 2), r0 = Math.round(z / GAP + (ROWS - 1) / 2);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const c = c0 + dc, r = r0 + dr; if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      const i = r * COLS + c, half = wT[i] / 2;
      const dx = Math.max(0, Math.abs(x - home[i].x) - half), dz = Math.max(0, Math.abs(z - home[i].z) - half), d2 = dx * dx + dz * dz;
      if (d2 < R * R) { const t = yC[i] + hC[i] + Math.sqrt(R * R - d2); if (t > top) top = t; }
    }
    return top;
  }
  function startDrop() { mode = "drop"; ballX = home[SUMMIT].x; ballZ = home[SUMMIT].z; by = hT[SUMMIT] + R + 7.5; bvy = 0; }
  function impact(v) {
    sqv += Math.min(v, 18) * .3;
    for (let i = 0; i < N; i++) {   /* the landing pushes the column down, and the push travels out a little */
      const dx = home[i].x - ballX, dz = home[i].z - ballZ, f = Math.exp(-(dx * dx + dz * dz) / 1.6);
      if (f > .02) hV[i] -= v * .32 * f;
    }
  }

  function step(dt) {
    for (let i = 0; i < N; i++) {
      const k = K[i], c = 2 * Z * Math.sqrt(k);
      hV[i] += (k * (hT[i] - hC[i]) - c * hV[i]) * dt; hC[i] += hV[i] * dt;
      yV[i] += (k * (yT[i] - yC[i]) - c * yV[i]) * dt; yC[i] += yV[i] * dt;
    }
    if (hold > 0) {   /* on the ground while it squashes, then it springs back up */
      hold -= dt; by = surfaceAt(ballX, ballZ);
      if (hold <= 0) bvy = rebound;
    } else if (mode === "roll" || mode === "drop" || mode === "rest") {
      bvy -= 34 * dt; by += bvy * dt;
      const s = surfaceAt(ballX, ballZ);
      if (by < s) {
        const v = -bvy;
        by = s;
        if (mode === "drop" && v > 2.2) { impact(v); bvy = 0; hold = .085; rebound = v * .36; }
        else { bvy = Math.max(0, bvy); if (mode === "drop" && v <= 2.2) mode = "rest"; }
      }
    }
    sqv += (-320 * sq - 2 * .3 * Math.sqrt(320) * sqv) * dt; sq += sqv * dt;
  }

  function snap() {
    hold = 0;
    hC.set(hT); yC.set(yT); hV.fill(0); yV.fill(0); sq = sqv = 0;
    if (mode === "drop" || mode === "rest") { mode = "rest"; by = surfaceAt(ballX, ballZ); bvy = 0; }
    if (mode === "roll") { by = surfaceAt(ballX, ballZ); bvy = 0; }
  }

  function write() {
    for (let i = 0; i < N; i++) {
      pos.set(home[i].x, yC[i], home[i].z); scl.set(wT[i], Math.max(.02, hC[i]), wT[i]);
      m4.compose(pos, q, scl); boxes.setMatrixAt(i, m4);
    }
    boxes.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < N; i++) {   /* mean standing height of the four neighbours, for the contact shading */
      const c = home[i].c, r = home[i].r; let t = 0;
      if (c > 0) t += Math.max(0, yC[i - 1] + hC[i - 1]);
      if (c < COLS - 1) t += Math.max(0, yC[i + 1] + hC[i + 1]);
      if (r > 0) t += Math.max(0, yC[i - COLS] + hC[i - COLS]);
      if (r < ROWS - 1) t += Math.max(0, yC[i + COLS] + hC[i + COLS]);
      nb.array[i] = t / 4;
    }
    nb.needsUpdate = true;
    const on = mode !== "off";
    ball.visible = on; glow.userData.want = on; glow.visible = on;
    spill.intensity = on ? 7 : 0;
    if (on) {
      const s = Math.max(-.12, Math.min(.38, sq));
      ball.scale.set(1 + s * .55, 1 - s, 1 + s * .55);
      ball.position.set(ballX, by - R * s, ballZ);
      if (mode === "roll") ball.rotation.set(0, 0, -ballX / R);
      glow.position.copy(ball.position); spill.position.copy(ball.position).y += .2;
    }
  }

  let lastP = -1, lastCam = null, lastT = 0;
  function frame(p, dtOverride) {
    const now = performance.now();
    let dt = dtOverride !== undefined ? dtOverride : lastT ? (now - lastT) / 1000 : 0;
    lastT = now; dt = Math.min(dt, .05);
    const jump = lastP < 0 || Math.abs(p - lastP) > .06;
    if (p !== lastP) { targets(p); lastP = p; }
    if (jump) snap();
    else { const n = Math.ceil(dt / (1 / 120)); for (let s = 0; s < n; s++) step(dt / n); }
    write();

    const C = camAt(p);
    tgt.set(0, C.ty, 0);
    const d = wide() ? C.d : C.d * 1.02;
    camera.position.set(tgt.x + d * Math.cos(C.el) * Math.sin(C.az), tgt.y + d * Math.sin(C.el), tgt.z + d * Math.cos(C.el) * Math.cos(C.az));
    camera.lookAt(tgt);
    const speed = lastCam ? Math.abs(C.az - lastCam.az) + Math.abs(C.el - lastCam.el) + Math.abs(C.d - lastCam.d) * .05 : 0;
    lastCam = C;
    trail.uniforms.damp.value = Math.min(.86, speed * 9);
    bokeh.uniforms.focus.value = camera.position.distanceTo(tgt);
    composer.render();
  }

  resize();
  targets(0); snap(); write();
  /* _sim advances the springs without drawing; used by the tests to look at a moment in time */
  const sim = (p, sec) => { if (p !== lastP) { targets(p); lastP = p; } for (let s = 0; s < Math.round(sec * 120); s++) step(1 / 120); };
  window.HOW3D = { ok: true, frame, canvas: cv, _sim: sim, _st: () => ({ mode, by: +by.toFixed(3), bvy: +bvy.toFixed(2), sq: +sq.toFixed(3), s: +surfaceAt(ballX, ballZ).toFixed(3) }) };
  document.documentElement.classList.add("how-3d");
}

try { boot(); } catch (e) { console.warn("3D scene unavailable, using the flat version", e); }
