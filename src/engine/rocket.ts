import * as THREE from 'three'
import { BOOSTER, WORLD } from '../sim'
import { createPlumes, engineLayout } from './plume'
import { gridTexture, steelTextures, tileTexture } from './textures'

const R = BOOSTER.radius

export interface BoosterModel {
  readonly group: THREE.Group
  readonly fins: THREE.Object3D[]
  readonly plumes: ReturnType<typeof createPlumes>
  readonly engineLight: THREE.PointLight
  readonly bells: THREE.InstancedMesh
}

export interface ShipModel {
  readonly group: THREE.Group
  readonly plumes: ReturnType<typeof createPlumes>
  readonly flaps: THREE.Object3D[]
}

export const steelMaterial = (rings: number, heat: boolean, repeatX: number) => {
  const { map, roughnessMap } = steelTextures(rings, heat)
  map.repeat.set(repeatX, 1)
  roughnessMap.repeat.set(repeatX, 1)
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map,
    roughnessMap,
    metalness: 0.92,
    roughness: 0.42,
    envMapIntensity: 1.25,
  })
}

const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.7, roughness: 0.55 })
const bellMat = new THREE.MeshStandardMaterial({
  color: 0x6d625a,
  metalness: 0.85,
  roughness: 0.35,
  side: THREE.DoubleSide,
  emissive: new THREE.Color(0xff6a20),
  emissiveIntensity: 0,
})

/** Super Heavy-style booster, origin at the engine plane, +Y up. */
export const createBooster = (radialSegments: number, plumeSegments: number): BoosterModel => {
  const group = new THREE.Group()
  const steel = steelMaterial(26, true, 3)

  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, BOOSTER.length - 4.5, radialSegments, 1, true), steel)
  body.position.y = 2 + (BOOSTER.length - 4.5) / 2
  group.add(body)

  // aft skirt
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.03, 2.2, radialSegments, 1, true), darkMetal)
  skirt.position.y = 1.1
  group.add(skirt)
  const heatShield = new THREE.Mesh(new THREE.CircleGeometry(R * 1.02, radialSegments), darkMetal)
  heatShield.rotation.x = Math.PI / 2
  heatShield.position.y = 0.9
  group.add(heatShield)

  // vented hot-staging ring at the top
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, 2.6, radialSegments, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.6 }),
  )
  ring.position.y = BOOSTER.length - 1.3
  group.add(ring)
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x8a8d92, metalness: 0.9, roughness: 0.3 })
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.6, 0.25), ventMat)
    strut.position.set(Math.cos(a) * R * 1.005, BOOSTER.length - 1.3, Math.sin(a) * R * 1.005)
    strut.rotation.y = -a
    group.add(strut)
  }
  const lid = new THREE.Mesh(new THREE.CircleGeometry(R, radialSegments), steel)
  lid.rotation.x = -Math.PI / 2
  lid.position.y = BOOSTER.length
  group.add(lid)

  // grid fins (lattice via alpha map) — two per side, angled like the real thing
  const lattice = gridTexture(9, 5)
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x9c9fa5,
    metalness: 0.85,
    roughness: 0.35,
    alphaMap: lattice,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  })
  const fins: THREE.Object3D[] = []
  const finAngles = [Math.PI * 0.18, Math.PI * 0.82, Math.PI * 1.18, Math.PI * 1.82]
  for (const a of finAngles) {
    const pivot = new THREE.Group()
    pivot.position.set(Math.cos(a) * R, BOOSTER.length - 6.5, Math.sin(a) * R)
    pivot.rotation.y = -a
    const holder = new THREE.Group()
    const panel = new THREE.Mesh(new THREE.BoxGeometry(5.2, 4.2, 0.5), finMat)
    panel.position.x = 2.9
    holder.add(panel)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.25, 0.6), darkMetal)
    frame.position.set(2.9, 2.1, 0)
    holder.add(frame)
    const frame2 = frame.clone()
    frame2.position.y = -2.1
    holder.add(frame2)
    pivot.add(holder)
    group.add(pivot)
    fins.push(holder)
  }

  // catch pins sit on +/-Z, facing the tower arms
  const pinMat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.8, roughness: 0.4 })
  for (const s of [-1, 1]) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 2.0), pinMat)
    pin.position.set(0, WORLD.pinsAboveBase + 0.6, s * (R + 0.9))
    group.add(pin)
  }

  // external conduit and chines for an asymmetric silhouette
  const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 52, 10), steel)
  conduit.position.set(-R - 0.25, 30, 0.6)
  group.add(conduit)
  for (const s of [-1, 1]) {
    const chine = new THREE.Mesh(new THREE.BoxGeometry(0.5, 16, 1.4), darkMetal)
    chine.position.set(0, 9, s * (R + 0.4))
    group.add(chine)
  }

  // 33 engine bells
  const layout = engineLayout()
  const bellGeo = new THREE.CylinderGeometry(0.42, 0.66, 1.9, 14, 1, true)
  bellGeo.translate(0, -0.95, 0)
  const bells = new THREE.InstancedMesh(bellGeo, bellMat, layout.length)
  const m = new THREE.Matrix4()
  layout.forEach(([x, z], i) => {
    m.makeTranslation(x, 0.9, z)
    bells.setMatrixAt(i, m)
  })
  group.add(bells)

  const plumes = createPlumes(plumeSegments)
  plumes.mesh.position.y = -0.95
  group.add(plumes.mesh)

  const engineLight = new THREE.PointLight(0xffa25a, 0, 700, 2)
  engineLight.position.y = -14
  group.add(engineLight)

  return { group, fins, plumes, engineLight, bells }
}

/** Starship-style upper stage / payload: steel, black tiles on the windward side, flaps. Origin at its base. */
export const createShip = (radialSegments: number, plumeSegments: number): ShipModel => {
  const group = new THREE.Group()
  const steel = steelMaterial(18, false, 3)
  const tiles = new THREE.MeshStandardMaterial({ map: tileTexture(), metalness: 0.1, roughness: 0.85 })
  tiles.map!.repeat.set(4, 8)
  const barrelH = 33
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, barrelH, radialSegments, 1, true), steel)
  body.position.y = barrelH / 2
  group.add(body)
  const shield = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.012, R * 1.012, barrelH - 1, radialSegments, 1, true, Math.PI * 0.5, Math.PI),
    tiles,
  )
  shield.position.y = barrelH / 2 + 0.5
  group.add(shield)

  // ogive nose
  const pts: THREE.Vector2[] = []
  const noseH = 17
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const r = R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.65))) * (1 - 0.04 * t)
    pts.push(new THREE.Vector2(Math.max(r, 0.01), t * noseH))
  }
  const noseGeo = new THREE.LatheGeometry(pts, radialSegments)
  const nose = new THREE.Mesh(noseGeo, steel)
  nose.position.y = barrelH
  group.add(nose)
  const noseTiles = new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p.x * 1.012, p.y)), radialSegments, Math.PI * 0.5, Math.PI), tiles)
  noseTiles.position.y = barrelH
  group.add(noseTiles)

  const flapMat = new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.3, roughness: 0.7 })
  const flaps: THREE.Object3D[] = []
  for (const s of [-1, 1]) {
    const aft = new THREE.Mesh(new THREE.BoxGeometry(3.6, 11, 0.45), flapMat)
    aft.position.set(s * (R + 1.6), 7.5, -0.6)
    group.add(aft)
    flaps.push(aft)
    const fwd = new THREE.Mesh(new THREE.BoxGeometry(2.4, 6, 0.4), flapMat)
    fwd.position.set(s * (R * 0.75 + 1.0), barrelH + 5, -0.6)
    fwd.rotation.z = s * -0.35
    group.add(fwd)
    flaps.push(fwd)
  }
  const base = new THREE.Mesh(new THREE.CircleGeometry(R, radialSegments), darkMetal)
  base.rotation.x = Math.PI / 2
  base.position.y = 0.05
  group.add(base)

  const layout: Array<readonly [number, number, number]> = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2
    layout.push([Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0])
    const b = a + Math.PI / 3
    layout.push([Math.cos(b) * 2.9, Math.sin(b) * 2.9, 0])
  }
  const bellGeo = new THREE.CylinderGeometry(0.42, 0.95, 2.4, 14, 1, true)
  bellGeo.translate(0, -1.2, 0)
  layout.forEach(([x, z]) => {
    const bell = new THREE.Mesh(bellGeo, bellMat)
    bell.position.set(x, 0.3, z)
    group.add(bell)
  })
  const plumes = createPlumes(plumeSegments, layout, 0.85)
  plumes.mesh.position.y = -2.0
  group.add(plumes.mesh)
  return { group, plumes, flaps }
}

export const setBellHeat = (heat: number) => {
  bellMat.emissiveIntensity = heat * 0.9
}
