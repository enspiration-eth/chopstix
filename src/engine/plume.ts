import * as THREE from 'three'
import { NOISE } from './glsl'

/** Super Heavy-ish cluster layout: 3 centre, 10 inner ring, 20 outer ring. Returns [x, z, ring]. */
export const engineLayout = (): Array<readonly [number, number, number]> => {
  const out: Array<readonly [number, number, number]> = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2
    out.push([Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0])
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    out.push([Math.cos(a) * 2.45, Math.sin(a) * 2.45, 1])
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + 0.157
    out.push([Math.cos(a) * 3.75, Math.sin(a) * 3.75, 2])
  }
  return out
}

export interface PlumeUniforms {
  uThrottleL: { value: number }
  uThrottleR: { value: number }
  uDensity: { value: number }
  uTime: { value: number }
  /** 1 = all 33 lit (ascent), 0 = 13 inner lit (return) */
  uAllLit: { value: number }
  uGimbal: { value: number }
  uOpacity: { value: number }
}

/** Instanced shader plumes for every engine: shock diamonds at sea level, blooming wide in vacuum. */
export const createPlumes = (
  radialSegments: number,
  layout: Array<readonly [number, number, number]> = engineLayout(),
  nozzle = 0.62,
): { mesh: THREE.Mesh; uniforms: PlumeUniforms } => {
  const base = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 24, true)
  base.translate(0, -0.5, 0)
  const geo = new THREE.InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('normal', base.getAttribute('normal'))
  geo.setAttribute('uv', base.getAttribute('uv'))
  const eng = new Float32Array(layout.length * 4)
  layout.forEach(([x, z, ring], i) => {
    eng[i * 4] = x
    eng[i * 4 + 1] = z
    eng[i * 4 + 2] = ring
    eng[i * 4 + 3] = Math.random()
  })
  geo.setAttribute('aEngine', new THREE.InstancedBufferAttribute(eng, 4))
  geo.instanceCount = layout.length

  const uniforms: PlumeUniforms = {
    uThrottleL: { value: 0 },
    uThrottleR: { value: 0 },
    uDensity: { value: 1 },
    uTime: { value: 0 },
    uAllLit: { value: 1 },
    uGimbal: { value: 0 },
    uOpacity: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aEngine;
      uniform float uThrottleL;
      uniform float uThrottleR;
      uniform float uDensity;
      uniform float uAllLit;
      uniform float uGimbal;
      uniform float uTime;
      varying float vV;
      varying float vThrottle;
      varying float vFacing;
      varying float vSeed;
      varying float vLen;
      void main() {
        float lit = aEngine.z < 1.5 ? 1.0 : uAllLit;
        float thr = (aEngine.x < 0.0 ? uThrottleL : uThrottleR) * lit;
        vThrottle = thr;
        vSeed = aEngine.w;
        float v = -position.y;            // 0 at the nozzle exit, 1 at the tail
        vV = v;
        float vac = 1.0 - uDensity;
        float len = mix(42.0, 120.0, pow(vac, 0.7)) * (0.35 + 0.65 * thr);
        vLen = len;
        float nozzle = ${nozzle.toFixed(3)};
        // under-expanded in thin air: the plume balloons out
        float expand = mix(0.35, 9.0, pow(vac, 1.4));
        float flick = 1.0 + 0.06 * sin(uTime * 60.0 + aEngine.w * 40.0 + v * 9.0);
        float r = nozzle * (1.0 + expand * pow(v, mix(0.9, 0.45, vac))) * flick * (0.4 + 0.6 * thr);
        vec3 p = vec3(position.x * r, position.y * len, position.z * r);
        // gimbal swings the jet the opposite way the nose turns
        float g = -uGimbal;
        p.xy = mat2(cos(g), -sin(g), sin(g), cos(g)) * p.xy;
        p.x += aEngine.x;
        p.z += aEngine.y;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 n = normalize(normalMatrix * vec3(normal.x, 0.0, normal.z));
        vFacing = abs(dot(n, normalize(-mv.xyz)));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      uniform float uDensity;
      uniform float uTime;
      uniform float uOpacity;
      varying float vV;
      varying float vThrottle;
      varying float vFacing;
      varying float vSeed;
      varying float vLen;
      void main() {
        if (vThrottle < 0.01) discard;
        float v = vV;
        float dens = uDensity;
        // Mach diamonds: periodic bright knots, sharp at sea level, washed out as the air thins
        float spacing = mix(3.6, 9.0, 1.0 - dens);
        float phase = v * vLen / spacing;
        float diamonds = pow(0.5 + 0.5 * cos(phase * 6.2831), 10.0) * smoothstep(0.75, 0.1, v) * dens;
        float core = pow(vFacing, 2.0);
        float edge = pow(vFacing, 0.8);
        float turb = vnoise(vec2(v * 14.0 - uTime * 32.0, vSeed * 30.0 + uTime * 5.0));
        vec3 hot = vec3(1.6, 1.45, 1.9);
        vec3 blue = vec3(0.45, 0.42, 1.55);
        vec3 orange = vec3(2.2, 0.95, 0.32);
        vec3 col = mix(hot, blue, smoothstep(0.0, 0.25, v));
        col = mix(col, orange, smoothstep(0.15, 0.7, v) * (0.35 + 0.65 * dens));
        col += vec3(1.8, 1.7, 2.4) * diamonds * core * 1.6;
        col = mix(col, vec3(0.5, 0.45, 1.1), (1.0 - dens) * 0.65);
        float a = edge * pow(1.0 - v, mix(1.1, 2.4, 1.0 - dens)) * (0.55 + 0.45 * turb);
        a *= mix(0.9, 0.22, 1.0 - dens);
        a *= smoothstep(0.0, 0.03, v + 0.01);
        a *= vThrottle * uOpacity;
        gl_FragColor = vec4(col * a * 1.8, a);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 20
  return { mesh, uniforms }
}

/** Soft additive glow sprite used for the base heat bloom and the payload stage engine. */
export const createGlow = (color: THREE.Color, size: number) => {
  const uniforms = { uColor: { value: color }, uIntensity: { value: 0 } }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * ${size.toFixed(1)};
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv * 2.0 - 1.0);
        float g = exp(-d * d * 5.0) + 0.25 * exp(-d * 2.2);
        g *= smoothstep(1.0, 0.7, d);
        gl_FragColor = vec4(uColor * g * uIntensity, g * uIntensity);
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.frustumCulled = false
  mesh.renderOrder = 21
  return { mesh, uniforms }
}
