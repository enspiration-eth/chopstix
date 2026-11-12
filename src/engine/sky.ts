import * as THREE from 'three'
import { NOISE, SKY } from './glsl'

export const createSky = (sunDir: THREE.Vector3) => {
  const uniforms = {
    uSunDir: { value: sunDir },
    uAltitude: { value: 0 },
    uTime: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE}
      ${SKY}
      uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        vec3 col = skyColor(dir, uAltitude);
        float space = smoothstep(0.25, 1.0, clamp(uAltitude / 11000.0, 0.0, 1.0));
        if (space > 0.0) {
          vec3 d = dir * 420.0;
          vec3 cell = floor(d);
          float star = hash13(cell);
          float tw = 0.75 + 0.25 * sin(uTime * 3.0 + star * 50.0);
          vec3 f = fract(d) - 0.5;
          float s = (1.0 - smoothstep(0.0, 0.08, length(f))) * step(0.9965, star) * tw;
          col += vec3(s) * space * 1.6 * smoothstep(-0.05, 0.1, dir.y);
        }
        // sun disc (HDR so bloom picks it up)
        float sd = dot(dir, normalize(uSunDir));
        col += vec3(1.0, 0.92, 0.8) * smoothstep(0.9994, 0.99975, sd) * 18.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material)
  mesh.frustumCulled = false
  mesh.renderOrder = -10
  return { mesh, uniforms }
}
