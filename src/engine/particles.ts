import * as THREE from 'three'
import { NOISE } from './glsl'

export interface EmitOptions {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  size0: number
  size1: number
  r: number
  g: number
  b: number
  alpha: number
  drag?: number
  buoyancy?: number
  heat?: number
  gravity?: number
}

/**
 * CPU-simulated, GPU-drawn billboard particles (instanced quads, so no point-size limits on iOS).
 * `additive` systems are for fire and sparks; the normal one is lit smoke and steam.
 */
export class Particles {
  readonly mesh: THREE.Mesh
  private readonly max: number
  private cursor = 0
  private readonly px: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size: Float32Array
  private readonly col: Float32Array
  private readonly params: Float32Array
  private readonly aPos: Float32Array
  private readonly aData: Float32Array
  private readonly aCol: Float32Array
  private readonly posAttr: THREE.InstancedBufferAttribute
  private readonly dataAttr: THREE.InstancedBufferAttribute
  private readonly colAttr: THREE.InstancedBufferAttribute
  private readonly geo: THREE.InstancedBufferGeometry
  readonly uniforms: {
    uSunDir: { value: THREE.Vector3 }
    uGlowPos: { value: THREE.Vector3 }
    uGlow: { value: number }
    uTime: { value: number }
  }
  budget: number

  constructor(max: number, additive: boolean, sunDir: THREE.Vector3) {
    this.max = max
    this.budget = max
    this.px = new Float32Array(max * 3)
    this.vel = new Float32Array(max * 3)
    this.age = new Float32Array(max).fill(1e9)
    this.life = new Float32Array(max).fill(1)
    this.size = new Float32Array(max * 2)
    this.col = new Float32Array(max * 4)
    this.params = new Float32Array(max * 4)
    this.aPos = new Float32Array(max * 3)
    this.aData = new Float32Array(max * 4)
    this.aCol = new Float32Array(max * 3)
    const base = new THREE.PlaneGeometry(1, 1)
    this.geo = new THREE.InstancedBufferGeometry()
    this.geo.index = base.index
    this.geo.setAttribute('position', base.getAttribute('position'))
    this.geo.setAttribute('uv', base.getAttribute('uv'))
    this.posAttr = new THREE.InstancedBufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage)
    this.dataAttr = new THREE.InstancedBufferAttribute(this.aData, 4).setUsage(THREE.DynamicDrawUsage)
    this.colAttr = new THREE.InstancedBufferAttribute(this.aCol, 3).setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('aPos', this.posAttr)
    this.geo.setAttribute('aData', this.dataAttr)
    this.geo.setAttribute('aCol', this.colAttr)
    this.geo.instanceCount = 0
    this.uniforms = {
      uSunDir: { value: sunDir },
      uGlowPos: { value: new THREE.Vector3() },
      uGlow: { value: 0 },
      uTime: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aPos;
        attribute vec4 aData; // size, alpha, seed, heat
        attribute vec3 aCol;
        varying vec2 vUv;
        varying vec4 vData;
        varying vec3 vCol;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vData = aData;
          vCol = aCol;
          vWorld = aPos;
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          float a = aData.z * 6.283 + aData.z * 0.0;
          vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
          mv.xy += q * aData.x;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: additive
        ? /* glsl */ `
        ${NOISE}
        varying vec2 vUv;
        varying vec4 vData;
        varying vec3 vCol;
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float n = vnoise(q * 3.0 + vData.z * 40.0);
          float d = length(q) + (n - 0.5) * 0.5;
          float a = (1.0 - smoothstep(0.0, 1.0, d)) * vData.y;
          if (a < 0.003) discard;
          gl_FragColor = vec4(clamp(vCol * a, 0.0, 24.0), clamp(a, 0.0, 1.0));
        }`
        : /* glsl */ `
        ${NOISE}
        uniform vec3 uSunDir;
        uniform vec3 uGlowPos;
        uniform float uGlow;
        varying vec2 vUv;
        varying vec4 vData;
        varying vec3 vCol;
        varying vec3 vWorld;
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float n = fbm3(q * 2.4 + vData.z * 37.0);
          float d = length(q) + (n - 0.5) * 0.7;
          float a = (1.0 - smoothstep(0.15, 1.0, d)) * vData.y;
          if (a < 0.004) discard;
          float lit = 0.62 + 0.38 * clamp(q.y * 0.6 + 0.5 + uSunDir.y * 0.3, 0.0, 1.0);
          vec3 col = vCol * lit * (0.8 + 0.3 * n);
          float gd = length(vWorld - uGlowPos);
          col += vec3(1.5, 0.8, 0.4) * uGlow * exp(-gd * 0.02) * 0.6;
          col += vec3(2.2, 0.9, 0.3) * vData.w * vData.w * (1.0 - d);
          gl_FragColor = vec4(clamp(col, 0.0, 24.0), clamp(a, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    })
    this.mesh = new THREE.Mesh(this.geo, material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = additive ? 22 : 10
  }

  emit(o: EmitOptions) {
    // ring buffer: when over budget the oldest puff is recycled
    const i = this.cursor
    this.cursor = (this.cursor + 1) % Math.max(1, Math.min(this.max, this.budget))
    this.px[i * 3] = o.x
    this.px[i * 3 + 1] = o.y
    this.px[i * 3 + 2] = o.z
    this.vel[i * 3] = o.vx
    this.vel[i * 3 + 1] = o.vy
    this.vel[i * 3 + 2] = o.vz
    this.age[i] = 0
    this.life[i] = o.life
    this.size[i * 2] = o.size0
    this.size[i * 2 + 1] = o.size1
    this.col[i * 4] = o.r
    this.col[i * 4 + 1] = o.g
    this.col[i * 4 + 2] = o.b
    this.col[i * 4 + 3] = o.alpha
    this.params[i * 4] = o.drag ?? 0.5
    this.params[i * 4 + 1] = o.buoyancy ?? 0
    this.params[i * 4 + 2] = o.heat ?? 0
    this.params[i * 4 + 3] = o.gravity ?? 0
  }

  update(dt: number, wind: number) {
    let n = 0
    for (let i = 0; i < this.max; i++) {
      const age = (this.age[i] = this.age[i]! + dt)
      const life = this.life[i]!
      if (age >= life) continue
      const t = age / life
      const drag = Math.exp(-this.params[i * 4]! * dt)
      const buoy = this.params[i * 4 + 1]!
      const grav = this.params[i * 4 + 3]!
      this.vel[i * 3] = this.vel[i * 3]! * drag + wind * (1 - drag) * 0.6
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * drag + (buoy - grav) * dt
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * drag
      const x = (this.px[i * 3] = this.px[i * 3]! + this.vel[i * 3]! * dt)
      let y = (this.px[i * 3 + 1] = this.px[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt)
      const z = (this.px[i * 3 + 2] = this.px[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt)
      if (y < 0.5 && grav > 0) {
        y = this.px[i * 3 + 1] = 0.5
        this.vel[i * 3 + 1] = Math.abs(this.vel[i * 3 + 1]!) * 0.3
      }
      const size = this.size[i * 2]! + (this.size[i * 2 + 1]! - this.size[i * 2]!) * (1 - (1 - t) * (1 - t))
      const fadeIn = Math.min(1, t * 12)
      const alpha = this.col[i * 4 + 3]! * fadeIn * (1 - t) * (1 - t * 0.3)
      const heat = this.params[i * 4 + 2]! * Math.max(0, 1 - t * 3)
      this.aPos[n * 3] = x
      this.aPos[n * 3 + 1] = y
      this.aPos[n * 3 + 2] = z
      this.aData[n * 4] = size
      this.aData[n * 4 + 1] = alpha
      this.aData[n * 4 + 2] = (i * 0.618) % 1
      this.aData[n * 4 + 3] = heat
      // fire cools from white-yellow to deep red
      const cool = this.params[i * 4 + 2]! > 0 ? 1 - t * 0.7 : 1
      this.aCol[n * 3] = this.col[i * 4]! * cool
      this.aCol[n * 3 + 1] = this.col[i * 4 + 1]! * cool * cool
      this.aCol[n * 3 + 2] = this.col[i * 4 + 2]! * cool * cool * cool
      n++
    }
    this.geo.instanceCount = n
    this.posAttr.needsUpdate = true
    this.dataAttr.needsUpdate = true
    this.colAttr.needsUpdate = true
  }

  clear() {
    this.age.fill(1e9)
    this.geo.instanceCount = 0
  }
}
