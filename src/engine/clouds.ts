import * as THREE from 'three'
import { NOISE, SKY } from './glsl'

export interface CloudHoles {
  /** x, z, radius, strength */
  readonly holes: THREE.Vector4[]
}

const sharedUniforms = (sunDir: THREE.Vector3) => ({
  uSunDir: { value: sunDir },
  uAltitude: { value: 0 },
  uCamPos: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uRocket: { value: new THREE.Vector3(0, -9999, 0) },
  uHoles: { value: [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] },
})

const HOLES_GLSL = /* glsl */ `
uniform vec4 uHoles[3];
uniform vec3 uCamPos;
uniform vec3 uRocket;
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
`

/** Instanced, camera-facing cumulus puffs that the vehicle can punch through. */
export const createCloudPuffs = (sunDir: THREE.Vector3, count: number, seed = 1) => {
  const uniforms = sharedUniforms(sunDir)
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
  for (let i = 0; i < count; i++) {
    // clusters: a few big cloud masses made from several puffs
    const cluster = Math.floor(rnd() * (count / 6))
    const ang = cluster * 2.399 + 0.6
    const rad = 250 + Math.sqrt((cluster + 1) / (count / 6)) * 5200
    const cx = Math.cos(ang) * rad
    const cz = Math.sin(ang) * rad - 400
    const sx = cx + (rnd() - 0.5) * 520
    const sz = cz + (rnd() - 0.5) * 380
    const sy = 820 + rnd() * 380 + (rnd() < 0.3 ? 240 : 0)
    offsets[i * 4] = sx
    offsets[i * 4 + 1] = sy
    offsets[i * 4 + 2] = sz
    offsets[i * 4 + 3] = 220 + rnd() * 320
  }
  // guarantee a cloud bank right over the pad so the rocket punches through it
  for (let i = 0; i < Math.min(9, count); i++) {
    offsets[i * 4] = (rnd() - 0.5) * 420
    offsets[i * 4 + 1] = 900 + rnd() * 260
    offsets[i * 4 + 2] = (rnd() - 0.5) * 420 - 60
    offsets[i * 4 + 3] = 200 + rnd() * 160
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
        vec3 w = aOffset.xyz + (right * position.x + up * position.y * 0.62) * aOffset.w;
        vWorld = w;
        vSeed = fract(aOffset.x * 0.0137 + aOffset.z * 0.0071);
        vSize = aOffset.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${SKY}
      ${HOLES_GLSL}
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vSize;
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float n = fbm3(q * 2.2 + vSeed * 17.0 + uTime * 0.015);
        float r = length(q) + (n - 0.5) * 0.75;
        float dens = smoothstep(1.0, 0.25, r);
        if (dens < 0.01) discard;
        // fake sphere normal for lighting
        vec3 nrm = normalize(vec3(q, sqrt(max(0.0, 1.0 - dot(q, q)))));
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camFwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 wn = normalize(camRight * nrm.x + camUp * nrm.y - camFwd * nrm.z);
        float sun = clamp(dot(wn, normalize(uSunDir)) * 0.6 + 0.5, 0.0, 1.0);
        float base = smoothstep(780.0, 1250.0, vWorld.y);
        vec3 lit = vec3(1.0, 0.94, 0.86) * 1.15;
        vec3 shade = vec3(0.50, 0.56, 0.68);
        vec3 col = mix(shade, lit, sun * (0.55 + 0.45 * base));
        col *= 0.85 + 0.25 * n;
        vec3 V = normalize(vWorld - uCamPos);
        float silver = pow(max(dot(V, normalize(uSunDir)), 0.0), 8.0) * (1.0 - dens) * 2.0;
        col += vec3(1.0, 0.8, 0.6) * silver;
        float dist = length(vWorld - uCamPos);
        float fog = 1.0 - exp(-dist * 0.00007);
        col = mix(col, skyColor(normalize(vec3(V.x, 0.05, V.z)), uAltitude), fog * 0.85);
        float alpha = dens * 0.82 * holeMask(vWorld);
        alpha *= smoothstep(15.0, vSize * 0.6, dist);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 5

  const order = Array.from({ length: count }, (_, i) => i)
  const src = offsets.slice()
  const dist = new Float32Array(count)
  /** back-to-front sort so the alpha blending looks right */
  const sort = (cam: THREE.Vector3) => {
    for (let i = 0; i < count; i++) {
      const dx = src[i * 4]! - cam.x
      const dy = src[i * 4 + 1]! - cam.y
      const dz = src[i * 4 + 2]! - cam.z
      dist[i] = dx * dx + dy * dy + dz * dz
    }
    order.sort((a, b) => dist[b]! - dist[a]!)
    for (let i = 0; i < count; i++) {
      const j = order[i]!
      offsets[i * 4] = src[j * 4]!
      offsets[i * 4 + 1] = src[j * 4 + 1]!
      offsets[i * 4 + 2] = src[j * 4 + 2]!
      offsets[i * 4 + 3] = src[j * 4 + 3]!
    }
    attr.needsUpdate = true
  }
  return { mesh, uniforms, sort }
}

/** A thin stratocumulus deck high above the pad: a sea of clouds once you are above it. */
export const createCloudDeck = (sunDir: THREE.Vector3, height: number) => {
  const uniforms = sharedUniforms(sunDir)
  const geo = new THREE.PlaneGeometry(90000, 90000, 1, 1)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, height, 0)
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${SKY}
      ${HOLES_GLSL}
      uniform float uTime;
      varying vec3 vWorld;
      void main() {
        vec2 p = vWorld.xz * 0.00055 + vec2(uTime * 0.004, 0.0);
        float n = fbm(p);
        float d = fbm(p * 3.1 + 4.0);
        float cover = smoothstep(0.47, 0.72, n * 0.75 + d * 0.35);
        if (cover < 0.01) discard;
        float above = step(vWorld.y, uCamPos.y);
        float sun = 0.65 + 0.35 * d;
        vec3 top = vec3(1.0, 0.95, 0.88) * (0.9 + 0.35 * sun);
        vec3 under = vec3(0.55, 0.60, 0.70) * (0.6 + 0.4 * (1.0 - cover));
        vec3 col = mix(under, top, above);
        float dist = length(vWorld - uCamPos);
        vec3 V = normalize(vWorld - uCamPos);
        float fog = 1.0 - exp(-dist * mix(0.00005, 0.000018, above));
        col = mix(col, skyColor(normalize(vec3(V.x, abs(V.y) * 0.3 + 0.02, V.z)), uAltitude), fog * 0.9);
        float alpha = cover * 0.92 * holeMask(vWorld);
        alpha *= smoothstep(10.0, 120.0, abs(vWorld.y - uCamPos.y) + dist * 0.02);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 4
  return { mesh, uniforms }
}
