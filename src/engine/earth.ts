import * as THREE from 'three'
import { NOISE, SKY } from './glsl'

export const EARTH_RADIUS = 400_000

export const createEarth = (sunDir: THREE.Vector3, segments: number) => {
  const uniforms = {
    uSunDir: { value: sunDir },
    uAltitude: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uScorch: { value: 0 },
  }
  const geo = new THREE.SphereGeometry(EARTH_RADIUS, segments, segments / 2, 0, Math.PI * 2, 0, 0.5)
  geo.translate(0, -EARTH_RADIUS, 0)
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(position + vec3(0.0, ${EARTH_RADIUS.toFixed(1)}, 0.0));
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${SKY}
      uniform vec3 uCamPos;
      uniform float uTime;
      uniform float uScorch;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec2 p = vWorld.xz;
        float r = length(p);
        float n = fbm(p * 0.00035);
        float n2 = fbm(p * 0.004 + 7.0);
        float nFine = vnoise(p * 0.05);
        // coastline runs north-south east of the pad (Gulf to +x)
        float coast = vWorld.x - 1400.0 - (n - 0.5) * 2600.0 - 900.0 * sin(vWorld.z * 0.00021);
        vec3 marsh = mix(vec3(0.16, 0.21, 0.09), vec3(0.40, 0.33, 0.20), n2);
        marsh = mix(marsh, vec3(0.42, 0.38, 0.30), smoothstep(0.55, 0.8, fbm(p * 0.0012 + 3.0)));
        vec3 sand = vec3(0.78, 0.70, 0.55) * (0.9 + 0.1 * nFine);
        vec3 deep = vec3(0.02, 0.09, 0.16);
        vec3 shallow = vec3(0.07, 0.30, 0.34);
        float water = smoothstep(0.0, 40.0, coast);
        vec3 sea = mix(shallow, deep, smoothstep(0.0, 2500.0, coast));
        vec3 land = mix(marsh, sand, smoothstep(-260.0, -40.0, coast));
        // lagoons
        float lag = smoothstep(0.62, 0.66, fbm(p * 0.0006 + 11.0));
        land = mix(land, shallow * 0.8, lag * (1.0 - smoothstep(-400.0, 0.0, coast)));
        // launch site: concrete pad, apron and the road
        float pad = 1.0 - smoothstep(110.0, 125.0, length(p - vec2(-10.0, 0.0)));
        float road = (1.0 - smoothstep(5.0, 7.0, abs(vWorld.z - 160.0 - 0.0 * vWorld.x))) * step(vWorld.x, 0.0);
        vec3 concrete = vec3(0.55, 0.55, 0.53) * (0.85 + 0.15 * nFine) * (0.92 + 0.08 * step(0.5, fract(p.x / 12.0)) );
        land = mix(land, concrete, max(pad, road * 0.8));
        // scorch around the mount
        float sc = (1.0 - smoothstep(10.0, 70.0, length(p))) * (0.5 + 0.5 * n2);
        land = mix(land, land * 0.35, sc * (0.6 + 0.4 * uScorch));
        vec3 albedo = mix(land, sea, water);

        vec3 N = normalize(vNormal);
        vec3 L = normalize(uSunDir);
        float diff = max(dot(N, L), 0.0);
        vec3 V = normalize(uCamPos - vWorld);
        vec3 col = albedo * (diff * vec3(1.25, 1.12, 0.98) + vec3(0.22, 0.27, 0.36));
        // ocean glint
        vec3 H = normalize(L + V);
        float wave = vnoise(p * 0.02 + uTime * 0.2) * 0.5 + vnoise(p * 0.07 - uTime * 0.3) * 0.5;
        float spec = pow(max(dot(N, H), 0.0), 220.0 + wave * 200.0) * water;
        col += vec3(1.0, 0.85, 0.65) * spec * 3.5;

        // aerial perspective toward the shared sky model
        float dist = length(uCamPos - vWorld);
        float camAlt = max(uCamPos.y, 0.0);
        float density = 0.00005 * exp(-camAlt / 3500.0) + 0.00001;
        float fog = 1.0 - exp(-dist * density);
        vec3 dir = normalize(vWorld - uCamPos);
        vec3 haze = skyColor(normalize(vec3(dir.x, max(dir.y, -0.02) * 0.2, dir.z)), camAlt);
        col = mix(col, haze, clamp(fog, 0.0, 0.92));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, material)
  mesh.frustumCulled = false
  mesh.renderOrder = -5
  return { mesh, uniforms }
}
