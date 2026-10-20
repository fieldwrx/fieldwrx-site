/* FIELDWRX · How we work: a lit 3D field of the brand's squares, flown through as you scroll.
   Shu: the field rises and a red sphere rolls across it, lifting each column as it reads it.
   Ha: columns split apart. Automated work turns blue and rises, simplified work drops low, stopped work flushes red and sinks away.
   Ri: the field is rebuilt as one rising order, blue at the summit, and the sphere lands on top.
   The page calls window.HOW3D.frame(p) with scroll progress p in 0..1. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const stage = document.querySelector(".how-stage");
const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

function boot() {
  if (!stage || RM) return;
  const test = document.createElement("canvas");
  if (!(test.getContext("webgl2") || test.getContext("webgl"))) return;

  const COLS = 18, ROWS = 11, N = COLS * ROWS, GAP = 1.06, SIZE = .76, R = .58;
  const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const span = (p, a, b) => clamp((p - a) / (b - a));
  const eio = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const eo = (t) => 1 - Math.pow(1 - t, 3);
  const mix = (a, b, t) => a + (b - a) * t;
  const bounce = (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; };

  /* fixed fates, so everyone sees the same film */
  let seed = 29; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const order = [...Array(N).keys()];
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const fate = new Array(N); order.forEach((q, k) => (fate[q] = k < 34 ? "a" : k < 62 ? "s" : k < 88 ? "x" : "k"));
  const noise = Array.from({ length: N }, () => rnd());

  /* renderer */
  const wide = () => stage.clientWidth >= 900;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(wide() ? 1.75 : 2, window.devicePixelRatio || 1));
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

  /* floor */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ color: 0x000000, opacity: .55 }));   /* the page itself is the floor: only the shadows show */
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  /* the squares, as extruded columns */
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, .5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: .4, metalness: 0, envMapIntensity: .2 });
  const boxes = new THREE.InstancedMesh(geo, mat, N);
  boxes.castShadow = true; boxes.receiveShadow = true;
  boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(boxes);
  const WHITE = new THREE.Color("#F3F2EF"), BLUE = new THREE.Color("#2F5BFF"), RED = new THREE.Color("#E8392F"), DIM = new THREE.Color("#9da0a8");
  const col = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const home = Array.from({ length: N }, (_, i) => { const c = i % COLS, r = Math.floor(i / COLS); return { c, r, x: (c - (COLS - 1) / 2) * GAP, z: (r - (ROWS - 1) / 2) * GAP }; });

  /* the circle, as a glossy sphere */
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 40), new THREE.MeshPhysicalMaterial({ color: RED, roughness: .2, clearcoat: 1, clearcoatRoughness: .08, envMapIntensity: 1.1 }));
  ball.castShadow = true; scene.add(ball);

  /* camera path: [p, azimuth°, elevation°, distance, target y] */
  const KEYS = [[0, -40, 62, 40, 0], [.1, -34, 38, 30, .4], [.3, 4, 32, 27, .5], [.365, 96, 42, 30, .6], [.62, 128, 36, 27, .7], [.69, 214, 54, 33, .9], [.86, 226, 38, 29, 1.5], [1, 234, 33, 28, 1.9]];
  const camera = new THREE.PerspectiveCamera(32, 1, .1, 200);
  const tgt = new THREE.Vector3();
  function camAt(p) {
    let k = 0; while (k < KEYS.length - 2 && p > KEYS[k + 1][0]) k++;
    const A = KEYS[k], B = KEYS[k + 1], u = eio(clamp((p - A[0]) / (B[0] - A[0])));
    return { az: mix(A[1], B[1], u) * Math.PI / 180, el: mix(A[2], B[2], u) * Math.PI / 180, d: mix(A[3], B[3], u), ty: mix(A[4], B[4], u) };
  }

  /* post: lens blur on desktop, and a trail that only shows when the camera whips */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 16, aperture: .00003, maxblur: .0035 });
  composer.addPass(bokeh);
  const trail = new AfterimagePass(0); composer.addPass(trail);
  composer.addPass(new OutputPass());

  let W = 0, H = 0;
  function resize() {
    W = stage.clientWidth; H = stage.clientHeight;
    renderer.setSize(W, H, false); composer.setSize(W, H);
    camera.aspect = W / H;
    if (wide()) camera.clearViewOffset(); else camera.setViewOffset(W, H, 0, H * .23, W, H);   /* phones: the field sits in the top band */
    camera.fov = wide() ? 32 : 46;
    camera.updateProjectionMatrix();
    bokeh.enabled = wide();
    last = -1;
  }
  new ResizeObserver(resize).observe(stage);

  /* heights and colours for scroll position p */
  const H_TOP = { v: 0 };
  function layout(p) {
    const scan = span(p, .12, .31), span0 = (COLS - 1) * GAP / 2 + 2.4, scanX = mix(-span0, span0, scan);
    let hTop = 0;
    for (let i = 0; i < N; i++) {
      const h0 = home[i], f = fate[i], n = noise[i], d = h0.c + (ROWS - 1 - h0.r);
      /* shu: rise in a wave from the front corner, then the sphere's ripple reads every column */
      const ap = eo(span(p, d * .0045, .07 + d * .0045));
      let h = mix(.02, .18 + .3 * n, ap), w = SIZE, y = 0;
      col.copy(WHITE);
      if (scan > 0 && scan < 1) { const dx = h0.x - scanX, dz = h0.z; h += 1.35 * Math.exp(-(dx * dx + dz * dz * .08) * .45); }
      const read = scan > 0 ? clamp((scanX - h0.x) / 1.6) : 0;
      col.lerp(DIM, .45 * (1 - read) * ap);
      /* ha */
      if (f === "a") { const t = eio(span(p, .38 + h0.c * .004, .48 + h0.c * .004)); h = mix(h, 1.5 + 1.4 * n, t); col.lerp(BLUE, t); }
      if (f === "s") { const t = eio(span(p, .44 + h0.c * .004, .54 + h0.c * .004)); h = mix(h, .12, t); w = mix(SIZE, SIZE * .62, t); }
      if (f === "x") {
        const flush = span(p, .5 + h0.c * .003, .54 + h0.c * .003); col.lerp(RED, flush);
        const t = eio(span(p, .55 + h0.c * .004, .63 + h0.c * .004)); y = -h * 1.05 * t - .02 * t;
      }
      /* ri: everything is rebuilt into one rising order, the stopped gaps refilled with new work */
      const tr = eio(span(p, .7 + d * .0045, .86 + d * .0045));
      if (tr > 0) {
        const g = clamp((h0.c / (COLS - 1)) * .6 + (h0.r / (ROWS - 1)) * .4), step = Math.min(6, Math.floor(g * 7)), hr = .22 + step * .72;   /* terraces climbing away */
        h = mix(h, hr, tr); w = mix(w, SIZE, tr); y = mix(y, 0, tr);
        col.lerp(step >= 5 ? BLUE : WHITE, tr);
        if (tr >= 1 && hr > hTop) hTop = hr;
      }
      pos.set(h0.x, y, h0.z); scl.set(w, Math.max(.001, h), w);
      m4.compose(pos, q, scl); boxes.setMatrixAt(i, m4); boxes.setColorAt(i, col);
    }
    boxes.instanceMatrix.needsUpdate = true; boxes.instanceColor.needsUpdate = true;

    /* the sphere: rides the crest across the field in shu, then drops onto the summit in ri */
    if (scan > 0 && scan < 1) {
      const crest = .18 + .3 * .5 + 1.35;
      ball.visible = true; ball.position.set(scanX - .35, crest + R, 0); ball.rotation.z = -scanX / R;
    } else if (p > .86) {
      const top = home[N - 1], hr = .22 + 6 * .72, t = span(p, .86, .97);
      ball.visible = true; ball.position.set(top.x, hr + R + (1 - bounce(t)) * 6, top.z); ball.rotation.z = 0;
    } else ball.visible = false;
  }

  let last = -1, lastCam = null;
  function frame(p) {
    const C = camAt(p);
    tgt.set(0, C.ty, 0);
    const d = wide() ? C.d : C.d * 1.35;
    camera.position.set(tgt.x + d * Math.cos(C.el) * Math.sin(C.az), tgt.y + d * Math.sin(C.el), tgt.z + d * Math.cos(C.el) * Math.cos(C.az));
    camera.lookAt(tgt);
    const speed = lastCam ? Math.abs(C.az - lastCam.az) + Math.abs(C.el - lastCam.el) + Math.abs(C.d - lastCam.d) * .05 : 0;
    lastCam = C;
    trail.uniforms.damp.value = Math.min(.86, speed * 9);
    bokeh.uniforms.focus.value = camera.position.distanceTo(tgt);
    if (p !== last) { layout(p); last = p; }
    composer.render();
  }

  resize();
  layout(0);
  window.HOW3D = { ok: true, frame, canvas: cv };
  document.documentElement.classList.add("how-3d");
}

try { boot(); } catch (e) { console.warn("3D scene unavailable, using the flat version", e); }
