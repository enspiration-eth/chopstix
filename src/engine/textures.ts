import * as THREE from 'three'

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

let seed = 1234
const rnd = () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

/** Brushed stainless steel: weld rings, panel seams, streaks, faint heat tint. Returns colour + roughness maps. */
export const steelTextures = (rings: number, heatTint: boolean) => {
  const W = 512
  const H = 1024
  const color = canvas(W, H)
  const rough = canvas(W, H)
  const g = color.ctx
  const r = rough.ctx
  g.fillStyle = '#b9bcc0'
  g.fillRect(0, 0, W, H)
  r.fillStyle = '#5a5a5a'
  r.fillRect(0, 0, W, H)
  // vertical brushing streaks
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * W
    const a = rnd() * 0.08
    g.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(40,45,55,${a})`
    g.fillRect(x, 0, 1 + rnd() * 2, H)
    r.fillStyle = `rgba(${rnd() < 0.5 ? 255 : 0},${rnd() < 0.5 ? 255 : 0},${rnd() < 0.5 ? 255 : 0},${a * 0.6})`
    r.fillRect(x, 0, 1 + rnd() * 3, H)
  }
  // blotchy oxidation / handling marks
  for (let i = 0; i < 90; i++) {
    const x = rnd() * W
    const y = rnd() * H
    const rad = 10 + rnd() * 60
    const grd = g.createRadialGradient(x, y, 0, x, y, rad)
    const dark = rnd() < 0.6
    grd.addColorStop(0, dark ? 'rgba(60,62,70,0.10)' : 'rgba(255,250,240,0.10)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // weld rings (horizontal) and staggered panel seams (vertical)
  const ringH = H / rings
  for (let i = 0; i <= rings; i++) {
    const y = Math.round(i * ringH)
    g.fillStyle = 'rgba(70,72,78,0.85)'
    g.fillRect(0, y, W, 2)
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.fillRect(0, y + 2, W, 1)
    r.fillStyle = 'rgba(200,200,200,1)'
    r.fillRect(0, y - 1, W, 4)
    const off = (i % 2) * (W / 8)
    for (let k = 0; k < 4; k++) {
      const x = Math.round(off + (k * W) / 4)
      g.fillStyle = 'rgba(80,82,88,0.55)'
      g.fillRect(x, y, 1.5, ringH)
    }
  }
  if (heatTint) {
    const grd = g.createLinearGradient(0, H, 0, H * 0.7)
    grd.addColorStop(0, 'rgba(120,80,40,0.45)')
    grd.addColorStop(0.4, 'rgba(70,60,110,0.25)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.fillRect(0, H * 0.7, W, H * 0.3)
  }
  const map = new THREE.CanvasTexture(color.c)
  map.colorSpace = THREE.SRGBColorSpace
  map.wrapS = THREE.RepeatWrapping
  map.anisotropy = 4
  const roughnessMap = new THREE.CanvasTexture(rough.c)
  roughnessMap.wrapS = THREE.RepeatWrapping
  return { map, roughnessMap }
}

/** Hexagonal black heat-shield tiles. */
export const tileTexture = () => {
  const W = 512
  const H = 512
  const { c, ctx } = canvas(W, H)
  ctx.fillStyle = '#0b0c0e'
  ctx.fillRect(0, 0, W, H)
  const s = 14
  const hw = s * Math.sqrt(3)
  for (let row = 0; row < H / (s * 1.5) + 2; row++) {
    for (let col = 0; col < W / hw + 2; col++) {
      const x = col * hw + (row % 2) * (hw / 2)
      const y = row * s * 1.5
      ctx.beginPath()
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6
        ctx.lineTo(x + Math.cos(a) * (s - 1.2), y + Math.sin(a) * (s - 1.2))
      }
      ctx.closePath()
      const v = 14 + Math.floor(rnd() * 14)
      ctx.fillStyle = rnd() < 0.03 ? '#d8d8d8' : `rgb(${v},${v},${v + 2})`
      ctx.fill()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** Lattice for grid fins / truss panels: white = solid, black = hole (used as alphaMap). */
export const gridTexture = (cells: number, bar: number) => {
  const N = 256
  const { c, ctx } = canvas(N, N)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, N, N)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = bar
  const step = N / cells
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath()
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step - N, N)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i * step + N, 0)
    ctx.lineTo(i * step, N)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step + N, N)
    ctx.stroke()
  }
  ctx.lineWidth = bar * 2.5
  ctx.strokeRect(0, 0, N, N)
  const t = new THREE.CanvasTexture(c)
  return t
}
