'use client'

import { useEffect, useRef, useState } from 'react'

// Henry County, IA - 98 acres demo tract polygon
const DEMO_POLYGON: [number, number][] = [
  [-91.433838, 40.913145], [-91.432636, 40.91314], [-91.429079, 40.913126],
  [-91.429068, 40.914492], [-91.426718, 40.914498], [-91.426716, 40.914588],
  [-91.426631, 40.918162], [-91.428814, 40.918177], [-91.42898, 40.918178],
  [-91.428978, 40.91948], [-91.428978, 40.919532], [-91.430107, 40.919534],
  [-91.430155, 40.919534], [-91.430112, 40.920601], [-91.428977, 40.920585],
  [-91.428975, 40.921769], [-91.429094, 40.921827], [-91.430466, 40.922487],
  [-91.431733, 40.922478], [-91.43259, 40.922698], [-91.432589, 40.922758],
  [-91.43373, 40.92277], [-91.433731, 40.92271], [-91.433744, 40.92182],
  [-91.433756, 40.920584], [-91.433766, 40.919531], [-91.433768, 40.919278],
  [-91.433779, 40.918165], [-91.433814, 40.91451], [-91.433838, 40.913145],
]

// Pre-baked 16x16 elevation grid from USGS (feet) — loads instantly
const DEMO_ELEVATIONS = [
  [676.7,674.8,675.9,676.1,678.0,689.2,685.4,672.1,695.1,711.2,709.2,714.3,713.0,711.2,715.4,712.4],
  [704.1,699.9,685.0,698.1,708.2,715.6,714.9,698.0,699.3,708.6,721.0,719.6,721.4,725.0,724.6,710.7],
  [720.0,718.8,698.6,713.2,723.3,725.3,720.3,697.5,692.1,723.4,727.0,729.8,731.0,731.0,717.0,687.8],
  [732.2,727.0,719.6,717.0,723.1,735.5,728.3,730.0,718.1,711.7,722.9,735.9,735.2,728.8,692.5,714.4],
  [743.0,739.3,741.7,724.9,731.2,742.7,741.8,735.1,733.7,712.0,730.0,735.9,736.0,722.7,704.9,726.2],
  [745.0,746.4,744.8,741.8,743.7,747.8,747.1,742.8,736.2,739.5,740.8,739.1,740.2,707.1,730.0,726.4],
  [741.9,744.0,745.7,747.2,748.5,749.0,749.8,747.3,741.7,747.6,744.0,734.5,735.2,740.7,733.1,710.1],
  [743.0,744.9,745.7,747.2,749.0,749.4,750.0,751.3,750.7,748.5,746.3,744.9,738.8,745.9,740.8,736.5],
  [741.4,744.2,746.3,747.9,749.0,749.3,750.2,752.2,753.0,753.0,750.8,751.8,751.5,748.9,742.4,727.7],
  [741.2,745.0,747.8,749.3,749.4,747.5,749.9,751.7,753.5,755.2,754.8,756.1,755.9,754.6,754.0,735.8],
  [738.1,742.8,746.2,746.2,743.9,747.6,746.9,749.2,753.1,754.6,755.5,756.3,756.8,756.5,751.0,753.7],
  [736.4,739.6,742.3,739.8,739.0,743.8,739.3,744.7,751.0,753.6,755.2,754.7,753.6,753.4,755.4,753.7],
  [730.7,732.7,739.0,738.7,734.7,738.7,747.0,748.5,744.6,746.9,752.2,747.7,750.0,755.0,757.5,758.4],
  [729.6,733.4,731.6,722.7,731.4,742.0,732.9,739.6,748.7,749.2,741.3,747.4,748.5,755.3,758.0,759.6],
  [722.6,724.6,714.2,719.8,723.5,724.8,737.3,738.9,730.2,732.4,743.4,750.4,753.6,754.9,751.6,756.7],
  [709.7,707.3,700.8,711.7,717.4,725.5,732.5,738.8,743.7,747.5,751.9,753.5,754.6,754.0,753.8,758.4],
]

const SAMPLE_SIZE = 16

export default function HomeTerrain3D() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!canvasRef.current) return
    let cleanup: (() => void) | null = null

    const init = async () => {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')

        const container = canvasRef.current!
        const width = container.clientWidth
        const height = container.clientHeight

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x111111)

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setSize(width, height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        container.appendChild(renderer.domElement)

        const controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.05
        controls.autoRotate = true
        controls.autoRotateSpeed = 0.5
        controls.enableZoom = true
        controls.enablePan = false
        controls.minDistance = 2
        controls.maxDistance = 15
        controls.maxPolarAngle = Math.PI / 2.2

        // Compute bounds
        const lngs = DEMO_POLYGON.map(p => p[0])
        const lats = DEMO_POLYGON.map(p => p[1])
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
        const minLat = Math.min(...lats), maxLat = Math.max(...lats)
        const centerLat = (minLat + maxLat) / 2
        const latScale = 111320
        const lngScale = 111320 * Math.cos(centerLat * Math.PI / 180)
        const sceneW = (maxLng - minLng) * lngScale
        const sceneH = (maxLat - minLat) * latScale
        const maxDim = Math.max(sceneW, sceneH)

        // Interpolate 16x16 pre-baked data to 64x64 grid
        const gridSize = 64
        let minElev = Infinity, maxElev = -Infinity
        const elevations: number[][] = []

        for (let j = 0; j < gridSize; j++) {
          elevations[j] = []
          const sj = (j / (gridSize - 1)) * (SAMPLE_SIZE - 1)
          const j0 = Math.floor(sj), j1 = Math.min(j0 + 1, SAMPLE_SIZE - 1)
          const jt = sj - j0
          for (let i = 0; i < gridSize; i++) {
            const si = (i / (gridSize - 1)) * (SAMPLE_SIZE - 1)
            const i0 = Math.floor(si), i1 = Math.min(i0 + 1, SAMPLE_SIZE - 1)
            const it = si - i0
            const v = DEMO_ELEVATIONS[j0][i0] * (1 - it) * (1 - jt) +
                      DEMO_ELEVATIONS[j0][i1] * it * (1 - jt) +
                      DEMO_ELEVATIONS[j1][i0] * (1 - it) * jt +
                      DEMO_ELEVATIONS[j1][i1] * it * jt
            elevations[j][i] = v
            if (v < minElev) minElev = v
            if (v > maxElev) maxElev = v
          }
        }

        const elevRange = maxElev - minElev || 1
        const exaggeration = 0.03

        // Build geometry
        const planeW = sceneW / maxDim * 8
        const planeH = sceneH / maxDim * 8
        const geometry = new THREE.PlaneGeometry(planeW, planeH, gridSize - 1, gridSize - 1)
        const positions = geometry.attributes.position
        const colors = new Float32Array(positions.count * 3)

        for (let j = 0; j < gridSize; j++) {
          for (let i = 0; i < gridSize; i++) {
            const idx = j * gridSize + i
            const norm = (elevations[j][i] - minElev) / elevRange
            positions.setZ(idx, norm * planeH * exaggeration * 1.3)

            // Color gradient: green → yellow → orange → red
            const t = norm
            if (t < 0.25) {
              colors[idx * 3] = 0.1; colors[idx * 3 + 1] = 0.5 + t * 2; colors[idx * 3 + 2] = 0.1
            } else if (t < 0.5) {
              const s = (t - 0.25) / 0.25
              colors[idx * 3] = s * 0.8; colors[idx * 3 + 1] = 0.7 + s * 0.3; colors[idx * 3 + 2] = 0.1
            } else if (t < 0.75) {
              const s = (t - 0.5) / 0.25
              colors[idx * 3] = 0.8 + s * 0.2; colors[idx * 3 + 1] = 1.0 - s * 0.3; colors[idx * 3 + 2] = 0.1
            } else {
              const s = (t - 0.75) / 0.25
              colors[idx * 3] = 1.0; colors[idx * 3 + 1] = 0.7 - s * 0.5; colors[idx * 3 + 2] = 0.1 + s * 0.2
            }
          }
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geometry.computeVertexNormals()

        // Boundary outline
        const boundaryPoints = DEMO_POLYGON.map(p => {
          const x = ((p[0] - minLng) / (maxLng - minLng) - 0.5) * planeW
          const y = ((p[1] - minLat) / (maxLat - minLat) - 0.5) * planeH
          const gi = ((p[0] - minLng) / (maxLng - minLng)) * (gridSize - 1)
          const gj = ((p[1] - minLat) / (maxLat - minLat)) * (gridSize - 1)
          const i0 = Math.min(Math.floor(gi), gridSize - 2)
          const j0 = Math.min(Math.floor(gj), gridSize - 2)
          const it = gi - i0, jt = gj - j0
          const e = elevations[j0][i0] * (1-it)*(1-jt) + elevations[j0][i0+1]*it*(1-jt) +
                    elevations[j0+1][i0]*(1-it)*jt + elevations[j0+1][i0+1]*it*jt
          const z = ((e - minElev) / elevRange) * planeH * exaggeration * 1.3 + 0.02
          return new THREE.Vector3(x, y, z)
        })

        const boundaryGeom = new THREE.BufferGeometry().setFromPoints(boundaryPoints)
        const boundaryLine = new THREE.Line(boundaryGeom, new THREE.LineBasicMaterial({ color: 0xE91E8C, linewidth: 2 }))

        const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
        const mesh = new THREE.Mesh(geometry, material)
        mesh.rotation.x = -Math.PI / 2
        scene.add(mesh)
        boundaryLine.rotation.x = -Math.PI / 2
        scene.add(boundaryLine)

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.4))
        const d1 = new THREE.DirectionalLight(0xffffff, 0.8)
        d1.position.set(5, 10, 5)
        scene.add(d1)
        const d2 = new THREE.DirectionalLight(0xffffff, 0.3)
        d2.position.set(-5, 5, -5)
        scene.add(d2)

        camera.position.set(6, 5, 6)
        camera.lookAt(0, 0, 0)
        controls.target.set(0, 0.2, 0)

        // Elevation legend only (no location info)
        const legendDiv = document.createElement('div')
        legendDiv.style.cssText = `
          position:absolute; bottom:16px; right:16px;
          background:rgba(0,0,0,0.7); border-radius:8px; padding:10px 14px;
          font-family:system-ui; font-size:11px; color:#aaa;
          backdrop-filter:blur(8px); border:1px solid rgba(255,255,255,0.1);
        `
        legendDiv.innerHTML = `
          <div style="font-weight:600;margin-bottom:6px;color:#ddd">ELEVATION</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:80px;height:8px;border-radius:4px;background:linear-gradient(90deg,#1a8a1a,#cccc1a,#cc8800,#ff3333)"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:2px">
            <span>${Math.round(minElev)} ft</span>
            <span>${Math.round(maxElev)} ft</span>
          </div>
        `
        container.appendChild(legendDiv)

        setLoaded(true)

        let animId: number
        const animate = () => {
          animId = requestAnimationFrame(animate)
          controls.update()
          renderer.render(scene, camera)
        }
        animate()

        const onResize = () => {
          const w = container.clientWidth, h = container.clientHeight
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          renderer.setSize(w, h)
        }
        window.addEventListener('resize', onResize)

        cleanup = () => {
          cancelAnimationFrame(animId)
          window.removeEventListener('resize', onResize)
          renderer.dispose()
          geometry.dispose()
          material.dispose()
          if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
          if (container.contains(legendDiv)) container.removeChild(legendDiv)
        }
      } catch (err) {
        console.error('3D terrain init failed:', err)
        setError(true)
      }
    }

    init()
    return () => { if (cleanup) cleanup() }
  }, [])

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[#111]">
      <div ref={canvasRef} className="w-full h-full" />
      {!loaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#111]">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-gg-pink border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gg-gray-400">Loading 3D terrain...</p>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#111]">
          <p className="text-sm text-gg-gray-500">3D terrain unavailable</p>
        </div>
      )}
    </div>
  )
}
