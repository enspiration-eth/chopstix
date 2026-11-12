import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

const FilmShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1 },
    uAberration: { value: 0.0015 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uAberration;
    uniform float uFlash;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * uAberration * (0.5 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= mix(1.0, (1.0 - smoothstep(0.2, 0.85, r2 * 1.6)), 0.55 * uVignette);
      col += (h(vUv * 800.0 + uTime) - 0.5) * 0.025;
      col = mix(col, vec3(1.0, 0.96, 0.9), clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

/**
 * Runs right after the scene render, before bloom. Replaces NaN/Inf with black and clamps HDR so one
 * bad fragment (a driver's NaN, a half-float overflow) can't be blurred by the bloom mip chain into
 * a fully black frame. Uses the bit pattern instead of x != x, which fast-math compilers drop.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, uMax: { value: 32 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    float clean(float x) {
      // exponent bits all set => Inf or NaN
      return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u ? 0.0 : clamp(x, 0.0, uMax);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(clean(c.r), clean(c.g), clean(c.b), 1.0);
    }
  `,
}

export class Post {
  readonly composer: EffectComposer
  readonly bloom: UnrealBloomPass
  readonly film: ShaderPass
  readonly sanitize: ShaderPass
  private readonly renderer: THREE.WebGLRenderer
  enabled = true

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples: number) {
    this.renderer = renderer
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.sanitize = new ShaderPass(SanitizeShader)
    this.composer.addPass(this.sanitize)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.7, 0.55, 0.92)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.film = new ShaderPass(FilmShader)
    this.composer.addPass(this.film)
  }

  setSize(w: number, h: number, bloomScale: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(w, h)
    const dpr = this.renderer.getPixelRatio()
    this.bloom.setSize(Math.round(w * dpr * bloomScale * 0.5), Math.round(h * dpr * bloomScale * 0.5))
  }

  render(dt: number) {
    this.composer.render(dt)
  }
}
