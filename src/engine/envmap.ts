import * as THREE from 'three'

/** Build a small studio-of-the-sky environment for the steel to reflect: blue zenith, warm horizon, sun, dark ground. */
export const buildEnvMap = (renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3) => {
  const scene = new THREE.Scene()
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: sunDir.clone().normalize() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 uSun; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        vec3 sky = mix(vec3(0.85,0.82,0.78), vec3(0.18,0.35,0.7), pow(max(d.y,0.0),0.5));
        vec3 ground = mix(vec3(0.32,0.30,0.27), vec3(0.12,0.12,0.12), pow(max(-d.y,0.0),0.4));
        vec3 c = d.y > 0.0 ? sky : ground;
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0,0.8,0.6) * (pow(s, 600.0) * 60.0 + pow(s, 12.0) * 0.6);
        // a couple of soft "studio" strips give the steel long highlights
        c += vec3(1.0) * smoothstep(0.985, 1.0, 1.0 - abs(d.x - 0.7)) * step(0.0, d.y) * 0.9;
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  return rt.texture
}
