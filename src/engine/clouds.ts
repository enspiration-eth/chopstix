import * as THREE from 'three'
import { DECK, DECK_COVER_GLSL } from './cloudNoise'
import { EARTH_RADIUS } from './earth'
import { SKY } from './glsl'

/*
 * Clouds: lit billboard cumulus near 1 km, and a stratocumulus deck near 2.7 km drawn as a stack of
 * horizontal slices through one shared density field (a cheap stand-in for raymarching that still
 * gives parallax, soft volume and self-shadowing). All noise comes from one CPU-built texture.
 *
 * NaN discipline: every pow() base is clamped >= 0, every normalize() is guarded, outputs are clamped.
 */

const sharedUniforms = (sunDir: THREE.Vector3, noise: THREE.Texture) => ({
  uSunDir: { value: sunDir },
  uAltitude: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uRocket: { value: new THREE.Vector3(0, -9999, 0) },
  uHoles: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] },
  uCloudTex: { value: noise },
  uGlowPos: { value: new THREE.Vector3(0, -9999, 0) },
  uGlow: { value: 0 },
})

const COMMON_GLSL = /* glsl */ `
uniform vec4 uHoles[3];
uniform vec3 uCamPos;
uniform vec3 uRocket;
uniform sampler2D uCloudTex;
uniform vec3 uGlowPos;
uniform float uGlow;
uniform float uTime;
vec3 safeNormalize(vec3 v) { return v / max(length(v), 1e-5); }
float holeMask(vec3 w) {
  float m = 1.0;
  for (int i = 0; i < 3; i++) {
    vec4 h = uHoles[i];
    if (h.w > 0.0) {
      float d = length(w.xz - h.xy);
      m *= mix(1.0, smoothstep(h.z * 0.55, h.z * 1.25, d), h.w);
    }
  }
  float dr = length(w - uRocket);
  m *= smoothstep(18.0, 55.0, dr);
  // keep a soft sight-line open from the camera to the vehicle
  vec3 ab = uRocket - uCamPos;
  float t = clamp(dot(w - uCamPos, ab) / max(dot(ab, ab), 1.0), 0.0, 1.0);
  float dl = length(w - (uCamPos + ab * t));
  m *= mix(0.2, 1.0, smoothstep(30.0, 140.0, dl));
  return m;
}
// Henyey-Greenstein phase, normalised so isotropic = 1
float hg(float cosT, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * cosT, 1e-4), 1.5);
}
vec3 sunColor() {
  // warm, low sun; HDR so the lit tops can bloom a little
  return vec3(1.0, 0.92, 0.80) * 1.9;
}
vec3 plumeGlow(vec3 w) {
  float d = length(w - uGlowPos);
  return vec3(1.0, 0.55, 0.22) * uGlow * exp(-d / 320.0) * 2.5;
}
vec3 aerial(vec3 col, vec3 w, float alt, out float fog) {
  vec3 V = safeNormalize(w - uCamPos);
  float dist = length(w - uCamPos);
  float meanAlt = max(0.5 * (alt + w.y), 0.0);
  float density = 0.000050 * exp(-meanAlt / 2600.0) + 0.000010;
  fog = 1.0 - exp(-dist * density);
  vec3 haze = skyColor(safeNormalize(vec3(V.x, abs(V.y) * 0.25 + 0.015, V.z)), alt);
  return mix(col, haze, clamp(fog, 0.0, 0.95));
}
`

const DECK_GLSL = /* glsl */ `
${DECK_COVER_GLSL}
float deckTop(float c, float detail) {
  return ${DECK.base.toFixed(1)} + ${DECK.thick.toFixed(1)} * (0.18 + 0.82 * pow(clamp(c, 0.0, 1.0), 1.3)) + (detail - 0.5) * 70.0 * c;
}
float deckBottom(float c, float detail) {
  return ${DECK.base.toFixed(1)} + 40.0 * (1.0 - c) + 18.0 * detail;
}
`

export interface CumulusCluster {
  readonly x: number
  readonly z: number
  readonly r: number
}

/** Instanced, camera-facing cumulus puffs (flat bases, cauliflower tops) the vehicle can punch through. */
export const createCloudPuffs = (sunDir: THREE.Vector3, noise: THREE.Texture, count: number, seed = 1) => {
  const uniforms = { ...sharedUniforms(sunDir, noise), uBase: { value: 860 } }
  const geo = new THREE.InstancedBufferGeometry()
  const base = new THREE.PlaneGeometry(1, 1)
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('uv', base.getAttribute('uv'))
  const offsets = new Float32Array(count * 4)
  let s = seed * 9301 + 49297
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
  const clusterCount = Math.max(4, Math.floor(count / 7))
  const clusters: CumulusCluster[] = []
  // random scatter (area-uniform) with a minimum spacing: no spiral or grid for the eye to find
  for (let c = 0; c < clusterCount; c++) {
    let x = 0, z = 0
    for (let tries = 0; tries < 24; tries++) {
      const ang = rnd() * Math.PI * 2
      const rad = 600 + Math.sqrt(rnd()) * 6800
      x = Math.cos(ang) * rad
      z = Math.sin(ang) * rad - 400
      if (clusters.every((o) => Math.hypot(o.x - x, o.z - z) > 750)) break
    }
    clusters.push({ x, z, r: 280 + rnd() * 420 })
  }
  // one bank right over the pad so the rocket punches through it
  clusters[0] = { x: 40, z: -80, r: 360 }
  for (let i = 0; i < count; i++) {
    const cl = clusters[i % clusterCount]!
    const k = Math.floor(i / clusterCount) // 0 = big low base puffs, higher k = smaller tops
    const spread = cl.r * (k === 0 ? 0.55 : 0.8)
    const a = rnd() * Math.PI * 2
    const rr = Math.sqrt(rnd()) * spread
    const tier = Math.min(1, k / 6)
    offsets[i * 4] = cl.x + Math.cos(a) * rr
    offsets[i * 4 + 2] = cl.z + Math.sin(a) * rr * 0.7
    // stack upward toward the centre: a dome
    offsets[i * 4 + 1] = 900 + tier * 330 * (1 - rr / (spread + 1)) + rnd() * 70
    offsets[i * 4 + 3] = (cl.r * (0.95 - tier * 0.45)) * (0.75 + rnd() * 0.5)
  }
  const attr = new THREE.InstancedBufferAttribute(offsets, 4)
  attr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('aOffset', attr)
  geo.instanceCount = count

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aOffset;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vSize;
      void main() {
        vUv = uv;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 w = aOffset.xyz + (right * position.x + up * position.y * 0.7) * aOffset.w;
        vWorld = w;
        vSeed = fract(aOffset.x * 0.0137 + aOffset.z * 0.0071);
        vSize = aOffset.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY}
      ${COMMON_GLSL}
      uniform float uBase;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vSize;
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        vec2 tq = q * 0.42 + vSeed * 7.0 + vec2(uTime * 0.0015, 0.0);
        float m = texture2D(uCloudTex, tq).r;
        float b = texture2D(uCloudTex, tq * 2.3 + 0.5).g;
        float r = length(q) + (m - 0.5) * 0.55 - (b - 0.5) * 0.45;
        float dens = 1.0 - smoothstep(0.32, 1.0, r);
        // flat, slightly ragged cumulus base
        dens *= smoothstep(uBase - 25.0, uBase + 60.0 + b * 30.0, vWorld.y);
        if (dens < 0.01) discard;
        // fake sphere normal, bumped by the billows
        vec3 nrm = safeNormalize(vec3(q + (vec2(b, m) - 0.5) * 0.6, sqrt(max(0.0, 1.0 - dot(q, q)))));
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 wn = safeNormalize(camRight * nrm.x + camUp * nrm.y - camFwd * nrm.z);
        vec3 L = safeNormalize(uSunDir);
        vec3 V = safeNormalize(vWorld - uCamPos);
        float hfac = clamp((vWorld.y - uBase) / 520.0, 0.0, 1.0);
        // Beer-Powder: light that has to cross more of the puff is dimmer; thin edges don't glow as much
        float thick = (1.0 - dot(wn, L)) * 0.5 * (0.4 + dens) + (1.0 - hfac) * 0.35;
        float beer = exp(-2.6 * max(thick, 0.0));
        float powder = 1.0 - exp(-5.0 * dens);
        float phase = mix(1.0, hg(dot(V, L), 0.6), 0.45);
        vec3 ambTop = skyColor(vec3(0.0, 1.0, 0.0), uAltitude) * 1.3 + vec3(0.32);
        vec3 ambBase = vec3(0.36, 0.40, 0.48);
        vec3 col = mix(ambBase, ambTop, pow(hfac, 0.7)) * 0.62;
        col += sunColor() * beer * mix(0.55, 1.0, powder) * phase;
        // silver lining where the sun is behind a thin edge
        col += vec3(1.0, 0.85, 0.65) * pow(max(dot(V, L), 0.0), 6.0) * (1.0 - dens) * 1.6;
        col += plumeGlow(vWorld) * (1.0 - hfac * 0.5);
        float fog;
        col = aerial(col, vWorld, uAltitude, fog);
        float alpha = dens * 0.92 * holeMask(vWorld);
        float dist = length(vWorld - uCamPos);
        alpha *= smoothstep(15.0, max(vSize * 0.6, 30.0), dist);
        alpha *= 1.0 - smoothstep(0.82, 1.0, fog);
        gl_FragColor = vec4(clamp(col, 0.0, 16.0), clamp(alpha, 0.0, 1.0));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 5

  const src = offsets.slice()
  const dist = new Float32Array(count)
  let active = count
  let order = Array.from({ length: active }, (_, i) => i)
  /** draw only the first n puffs (lower tiers); every cluster keeps its base */
  const setCount = (n: number) => {
    active = Math.max(1, Math.min(count, n))
    order = Array.from({ length: active }, (_, i) => i)
    geo.instanceCount = active
  }
  /** back-to-front sort so the alpha blending looks right */
  const sort = (cam: THREE.Vector3) => {
    for (let i = 0; i < active; i++) {
      const dx = src[i * 4]! - cam.x
      const dy = src[i * 4 + 1]! - cam.y
      const dz = src[i * 4 + 2]! - cam.z
      dist[i] = dx * dx + dy * dy + dz * dz
    }
    order.sort((a, b) => dist[b]! - dist[a]!)
    for (let i = 0; i < active; i++) {
      const j = order[i]!
      offsets[i * 4] = src[j * 4]!
      offsets[i * 4 + 1] = src[j * 4 + 1]!
      offsets[i * 4 + 2] = src[j * 4 + 2]!
      offsets[i * 4 + 3] = src[j * 4 + 3]!
    }
    attr.needsUpdate = true
  }
  return { mesh, uniforms, sort, setCount, clusters }
}

/**
 * Stratocumulus deck: `maxSlices` stacked, earth-curved planes through one density field.
 * Each slice adds a little optical depth, so together they read as a lumpy, self-shadowed volume
 * with real parallax; tiers just draw fewer slices (one on LOW, which becomes a flat textured layer).
 */
export const createCloudDeck = (sunDir: THREE.Vector3, noise: THREE.Texture, maxSteps: number) => {
  const TOP = DECK.base + DECK.thick + 60
  const BOT = DECK.base - 5
  const uniforms = {
    ...sharedUniforms(sunDir, noise),
    uSteps: { value: maxSteps },
    /** 0 = camera above the slab, 1 = below, 2 = inside */
    uMode: { value: 0 },
  }
  const geo = new THREE.PlaneGeometry(120000, 120000, 96, 96)
  geo.rotateX(-Math.PI / 2)
  const vertexShader = /* glsl */ `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      // follow the curvature of the (small) planet so the sea of clouds meets the horizon
      w.y -= dot(w.xz, w.xz) / ${(2 * EARTH_RADIUS).toFixed(1)};
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `
  const fragmentShader = /* glsl */ `
    ${SKY}
    ${COMMON_GLSL}
    ${DECK_GLSL}
    uniform float uSteps;
    uniform float uMode;
    varying vec3 vWorld;
    const float INV2R = ${(1 / (2 * EARTH_RADIUS)).toExponential(6)};
    // height inside the (curved) slab
    float slabH(vec3 p) { return p.y + dot(p.xz, p.xz) * INV2R; }
    // 2x2 Bayer matrix [[0, 2], [3, 1]] for cell (x, y) in {0, 1}
    float bayer2(vec2 c) { return 2.0 * c.x * (1.0 - c.y) + 3.0 * c.y * (1.0 - c.x) + c.x * c.y; }
    void main() {
      vec3 L = safeNormalize(uSunDir);
      vec3 ro = uCamPos;
      vec3 rv = vWorld - ro;
      float tFrag = length(rv);
      vec3 V = rv / max(tFrag, 1e-3);
      // vertical rate of the ray through the curved slab
      float rate = V.y + dot(vWorld.xz, V.xz) * 2.0 * INV2R;
      float t0, t1;
      if (uMode > 1.5) { t0 = 0.0; t1 = min(tFrag, 1500.0); }
      else {
        t0 = tFrag;
        t1 = tFrag + min(${(DECK.thick + 65).toFixed(1)} / max(abs(rate), 0.06), 2500.0);
      }
      // far away the deck is a thin sliver on screen: half the steps are enough there
      float n = floor(max(mix(uSteps, uSteps * 0.5, smoothstep(6000.0, 20000.0, tFrag)), 2.0) + 0.5);
      float span = t1 - t0;
      // 4x4 ordered (Bayer) dither: hides step banding as a fine regular texture instead of speckle
      vec2 bp = mod(floor(gl_FragCoord.xy), 4.0);
      vec2 b1 = mod(bp, 2.0);
      vec2 b2 = floor(bp * 0.5);
      float jit = (4.0 * bayer2(b1) + bayer2(b2)) / 16.0 + 1.0 / 32.0;
      // one shadow probe toward the sun per pixel (where the cover is thicker sun-ward, we are shaded)
      vec2 toSun = L.xz / max(length(L.xz), 1e-4);
      float sinE = max(L.y, 0.12);
      vec3 pFirst = ro + V * (t0 + span * 0.5 / (n * n));
      // warp + weather vary over kilometres: once per pixel, shared by every step
      vec3 wx = deckWeather(pFirst.xz);
      float cShadow = deckCoverW(pFirst.xz + wx.xy + toSun * 380.0, wx.z, uTime);
      vec3 ambTop = skyColor(vec3(0.0, 1.0, 0.0), uAltitude) * 1.3 + vec3(0.34);
      vec3 ambBase = vec3(0.20, 0.23, 0.30);
      float phase = mix(1.0, hg(dot(V, L), 0.55), 0.5);
      float T = 1.0;
      vec3 acc = vec3(0.0);
      float tHit = 0.0;
      for (int i = 0; i < 16; i++) {
        if (float(i) >= n || T < 0.03) break;
        // steps grow quadratically: dense near the surface we enter through, where the detail shows
        float u = (float(i) + jit) / n;
        float t = t0 + span * u * u;
        float ds = max(span * 2.0 * u / n, span / (n * n));
        vec3 p = ro + V * t;
        float y = slabH(p);
        vec2 pw = p.xz + wx.xy;
        float c = deckCoverW(pw, wx.z, uTime);
        if (c < 0.01) continue;
        // pseudo-3D detail: blend two decorrelated layers of the 2D noise by height
        float ly = max(y - ${DECK.base.toFixed(1)}, 0.0) / 150.0;
        float fl = floor(ly);
        vec2 dp = deckDetailUV(pw) + vec2(uTime * 0.002, 0.0);
        float detail = mix(texture2D(uCloudTex, dp + fl * vec2(0.37, 0.71)).b,
                           texture2D(uCloudTex, dp + (fl + 1.0) * vec2(0.37, 0.71)).b, smoothstep(0.0, 1.0, fract(ly)));
        // eroded cover drives the cloud height, so small blobs stay low bumps and big cells grow domes
        float ce = clamp(c * (0.55 + 0.75 * detail), 0.0, 1.0);
        float top = deckTop(ce, detail);
        float bottom = deckBottom(ce, detail);
        float h = clamp((y - bottom) / max(top - bottom, 1.0), 0.0, 1.0);
        float dens = smoothstep(-20.0, 120.0, top - y) * smoothstep(0.0, 60.0, y - bottom);
        dens *= smoothstep(0.08, 0.3, ce);
        if (dens < 0.005) continue;
        // Beer: sun light crossing the cloud above this point; billows shade their own valleys
        float climb = max(top - y, 0.0);
        float depthSun = climb / sinE * 0.35 + 140.0 * max(cShadow - c, 0.0) + (1.0 - detail) * 110.0 * ce;
        float beer = exp(-0.012 * depthSun);
        // powder: the dark-edged look of thick cloud lit from behind the viewer
        float powder = 1.0 - exp(-0.03 * max(y - bottom, 0.0) - 2.0 * dens);
        vec3 lit = mix(ambBase, ambTop, pow(h, 0.8)) * 0.6 + sunColor() * beer * mix(0.5, 1.0, powder) * phase;
        lit += plumeGlow(vec3(p.x, y, p.z)) * (1.0 - h * 0.6);
        // per-step opacity is capped so one lucky sample can't punch a hard speck into thin cloud
        float a = 1.0 - exp(-dens * 0.014 * min(ds, 160.0));
        acc += T * a * lit;
        tHit += T * a * t;
        T *= 1.0 - a;
      }
      float alpha = 1.0 - T;
      if (alpha < 0.004) discard;
      vec3 col = acc / max(alpha, 1e-4);
      // punch holes and the sight-line to the vehicle, evaluated once at the mean hit point
      vec3 pHit = ro + V * (tHit / max(alpha, 1e-4));
      alpha *= holeMask(vec3(pHit.x, slabH(pHit), pHit.z));
      float fog;
      col = aerial(col, pHit, uAltitude, fog);
      alpha *= 1.0 - smoothstep(30000.0, 58000.0, length(vWorld.xz - uCamPos.xz));
      gl_FragColor = vec4(clamp(col, 0.0, 16.0), clamp(alpha, 0.0, 1.0));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  })
  const top = new THREE.Mesh(geo, material)
  const bottom = new THREE.Mesh(geo, material)
  top.frustumCulled = bottom.frustumCulled = false
  const group = new THREE.Group()
  group.add(top, bottom)
  /** Follow the camera (so the grid detail stays near it), pick which slab face(s) start the march. */
  const update = (cam: THREE.Vector3, steps: number, renderOrder: number) => {
    uniforms.uSteps.value = Math.max(1, Math.min(16, steps))
    const sx = Math.round(cam.x / 500) * 500
    const sz = Math.round(cam.z / 500) * 500
    const camH = cam.y + (cam.x * cam.x + cam.z * cam.z) / (2 * EARTH_RADIUS)
    const mode = camH > TOP ? 0 : camH < BOT ? 1 : 2
    uniforms.uMode.value = mode
    top.position.set(sx, TOP, sz)
    bottom.position.set(sx, BOT, sz)
    top.visible = mode !== 1
    bottom.visible = mode !== 0
    top.renderOrder = bottom.renderOrder = renderOrder
  }
  return { group, uniforms, update }
}
