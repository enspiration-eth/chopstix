import * as THREE from 'three'
import { WORLD } from '../sim'
import { steelMaterial } from './rocket'

export interface TowerModel {
  readonly group: THREE.Group
  /** call with 0 (open) … 1 (closed), plus a vertical sag offset for the catch shock */
  readonly setArms: (closed: number, sag: number) => void
  readonly lights: THREE.Mesh[]
}

const towerMat = new THREE.MeshStandardMaterial({ color: 0x3b3f45, metalness: 0.55, roughness: 0.62 })
const accentMat = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.6, roughness: 0.5 })

/** Lattice launch tower with chopstick catch arms, launch mount, tank farm. World-space coordinates. */
export const createLaunchSite = (): TowerModel => {
  const group = new THREE.Group()
  const half = WORLD.towerHalfWidth
  const H = WORLD.towerHeight
  const cx = WORLD.towerX

  // --- lattice tower as one instanced mesh of beams
  const beams: THREE.Matrix4[] = []
  const beam = (a: THREE.Vector3, b: THREE.Vector3, thick: number) => {
    const d = new THREE.Vector3().subVectors(b, a)
    const len = d.length()
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
    beams.push(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(thick, len, thick)))
  }
  const corners = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ] as const
  for (const [x, z] of corners) beam(new THREE.Vector3(cx + x, 0, z), new THREE.Vector3(cx + x, H, z), 1.3)
  const level = 7.3
  for (let y = 0; y < H - 0.1; y += level) {
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = corners[k]!
      const [x1, z1] = corners[(k + 1) % 4]!
      const a = new THREE.Vector3(cx + x0, y, z0)
      const b = new THREE.Vector3(cx + x1, y, z1)
      beam(a, b, 0.55)
      const a2 = new THREE.Vector3(cx + x0, y + level, z0)
      const b2 = new THREE.Vector3(cx + x1, y + level, z1)
      beam((Math.floor(y / level) % 2 ? a : b).clone(), (Math.floor(y / level) % 2 ? b2 : a2).clone(), 0.4)
    }
  }
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const lattice = new THREE.InstancedMesh(unit, towerMat, beams.length)
  beams.forEach((m, i) => lattice.setMatrixAt(i, m))
  group.add(lattice)

  // top deck, crane mast and warning light
  const deck = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2, 2, half * 2 + 2), accentMat)
  deck.position.set(cx, H + 1, 0)
  group.add(deck)
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 22, 8), towerMat)
  mast.position.set(cx, H + 13, 0)
  group.add(mast)
  const lights: THREE.Mesh[] = []
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) })
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), lightMat)
  beacon.position.set(cx, H + 24.5, 0)
  group.add(beacon)
  lights.push(beacon)

  // --- carriage + chopsticks
  const carriage = new THREE.Group()
  carriage.position.set(0, WORLD.armY, 0)
  group.add(carriage)
  const box = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 3, 9, half * 2 + 3), accentMat)
  box.position.set(cx, 1.5, 0)
  carriage.add(box)

  const armSteel = steelMaterial(6, false, 1)
  const arms: THREE.Group[] = []
  const armLen = WORLD.catchX + 9 - (cx + half)
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group()
    pivot.position.set(cx + half + 0.5, 0, s * (half + 0.5))
    const arm = new THREE.Group()
    // truss: top and bottom chords + diagonals
    const top = new THREE.Mesh(new THREE.BoxGeometry(armLen, 1.4, 1.6), armSteel)
    top.position.set(armLen / 2, -0.7, 0)
    arm.add(top)
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(armLen * 0.92, 1.1, 1.3), armSteel)
    bottom.position.set(armLen * 0.46, -6.2, 0)
    arm.add(bottom)
    for (let i = 0; i < 7; i++) {
      const x0 = (i / 7) * armLen * 0.92
      const x1 = ((i + 1) / 7) * armLen * 0.92
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.5, Math.hypot(x1 - x0, 5.4), 0.5), towerMat)
      d.position.set((x0 + x1) / 2, -3.5, 0)
      d.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(x1 - x0, 5.4)
      arm.add(d)
    }
    // pads where the booster pins land
    const pad = new THREE.Mesh(new THREE.BoxGeometry(6, 0.6, 2.2), accentMat)
    pad.position.set(WORLD.catchX - (cx + half + 0.5), 0.0, -s * 0.4)
    arm.add(pad)
    pivot.add(arm)
    carriage.add(pivot)
    arms.push(pivot)
  }

  // the inner faces of the closed arms hug the booster (radius 4.5)
  const closedAngle = Math.atan2(half + 0.5 - 5.6, WORLD.catchX - (cx + half))
  const openAngle = -0.62
  const setArms = (closed: number, sag: number) => {
    const ang = openAngle + (closedAngle - openAngle) * closed
    arms[0]!.rotation.y = -ang // z<0 arm: positive yaw spreads it outward
    arms[1]!.rotation.y = ang
    carriage.position.y = WORLD.armY - sag
  }
  setArms(0, 0)

  // --- orbital launch mount
  const mount = new THREE.Group()
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(10, 10, 3.2, 40, 1, true), armSteel)
  ring.position.y = WORLD.mountHeight - 1.6
  mount.add(ring)
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(5.8, 5.8, 3.2, 40, 1, true), accentMat)
  inner.position.y = WORLD.mountHeight - 1.6
  mount.add(inner)
  const topRing = new THREE.Mesh(new THREE.RingGeometry(5.8, 10, 40, 1), armSteel)
  topRing.rotation.x = -Math.PI / 2
  topRing.position.y = WORLD.mountHeight
  mount.add(topRing)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, WORLD.mountHeight - 3, 2.2), armSteel)
    leg.position.set(Math.cos(a) * 8.2, (WORLD.mountHeight - 3) / 2, Math.sin(a) * 8.2)
    mount.add(leg)
  }
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 1.4), accentMat)
    clamp.position.set(Math.cos(a) * 5.3, WORLD.mountHeight + 0.4, Math.sin(a) * 5.3)
    clamp.rotation.y = -a
    mount.add(clamp)
  }
  const plate = new THREE.Mesh(new THREE.CircleGeometry(13, 40), new THREE.MeshStandardMaterial({ color: 0x1d1e20, metalness: 0.7, roughness: 0.4 }))
  plate.rotation.x = -Math.PI / 2
  plate.position.y = 0.15
  mount.add(plate)
  mount.position.x = WORLD.catchX
  group.add(mount)

  // --- tank farm and site clutter
  const tankMat = steelMaterial(8, false, 2)
  const tanks: Array<[number, number, number, number]> = [
    [-150, -70, 6, 34],
    [-165, -52, 6, 34],
    [-150, -36, 6, 34],
    [-180, -70, 4, 22],
    [-190, -40, 9, 18],
    [-205, -60, 9, 18],
  ]
  for (const [x, z, r, h] of tanks) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), tankMat)
    t.position.set(x, h / 2, z)
    group.add(t)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), tankMat)
    cap.position.set(x, h, z)
    group.add(cap)
  }
  const shed = new THREE.Mesh(new THREE.BoxGeometry(60, 26, 40), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.2, roughness: 0.7 }))
  shed.position.set(-230, 13, 90)
  group.add(shed)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.78
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 40, 6), towerMat)
    pole.position.set(Math.cos(a) * 95, 20, Math.sin(a) * 95)
    group.add(pole)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 1.5, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.7, 2.2) }))
    lamp.position.set(Math.cos(a) * 95, 40, Math.sin(a) * 95)
    group.add(lamp)
  }
  return { group, setArms, lights }
}
