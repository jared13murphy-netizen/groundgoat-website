'use client'

import { useEffect, useRef, useState } from 'react'

// Henry County, IA - 98 acres demo tract polygon
const DEMO_POLYGON = [
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

const DEMO_INFO = { county: 'Henry', state: 'IA', acres: 98, township: 'New London' }

export default function HomeTerrain3D() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!canvasRef.current) return

    let cleanup: (() => void) | null = null

    async function init() {
      try {
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js')

        const container = canvasRef.current!
        const width = container.clientWidth
        const height = container.clientHeight

        // Scene setup
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x111111)

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000)
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setSize(width, height)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        container.appendChild(renderer.domElement)

        // Controls
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

        // Compute polygon bounds
        const lngs = DEMO_POLYGON.map(p => p[0])
        const lats = DEMO_POLYGON.map(p => p[1])
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
        const minLat = Math.min(...lats), maxLat = Math.max(...lats)
        const centerLng = (minLng + maxLng) / 2
        const centerLat = (minLat + maxLat) / 2

        // Convert to local coordinates (meters-ish)
        const latScale = 111320 // meters per degree latitude
        const lngScale = 111320 * Math.cos(centerLat * Math.PI / 180)
        const sceneW = (maxLng - minLng) * lngScale
        const sceneH = (maxLat - minLat) * latScale
        const maxDim = Math.max(sceneW, sceneH)

        // Create elevation grid
        const gridSize = 64
        const elevations: number[][] = []

        // Fetch elevation data from USGS
        let minElev = Infinity, maxElev = -Infinity
        try {
          const points: string[] = []
          for (let j = 0; j < gridSize; j++) {
            for (let i = 0; i < gridSize; i++) {
              const lng = minLng + (i / (gridSize - 1)) * (maxLng - minLng)
              const lat = minLat + (j / (gridSize - 1)) * (maxLat - minLat)
              points.push(`${lng},${lat}`)
            }
          }

          // Use USGS Elevation Point Query Service (batched)
          // Fetch corners and interpolate for speed
          const sampleSize = 16
          const sampleElevs: number[][] = []
          for (let j = 0; j < sampleSize; j++) {
            sampleElevs[j] = []
            for (let i = 0; i < sampleSize; i++) {
              const lng = minLng + (i / (sampleSize - 1)) * (maxLng - minLng)
              const lat = minLat + (j / (sampleSize - 1)) * (maxLat - minLat)
              try {
                const resp = await fetch(
                  `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&units=Feet&includeDate=false`
                )
                const data = await resp.json()
                const elev = data.value ?? 500
                sampleElevs[j][i] = elev
                if (elev < minElev) minElev = elev
                if (elev > maxElev) maxElev = elev
              } catch {
                sampleElevs[j][i] = 500
              }
            }
          }

          // Bilinear interpolation to full grid
          for (let j = 0; j < gridSize; j++) {
            elevations[j] = []
            const sj = (j / (gridSize - 1)) * (sampleSize - 1)
            const j0 = Math.floor(sj), j1 = Math.min(j0 + 1, sampleSize - 1)
            const jt = sj - j0
            for (let i = 0; i < gridSize; i++) {
              const si = (i / (gridSize - 1)) * (sampleSize - 1)
              const i0 = Math.floor(si), i1 = Math.min(i0 + 1, sampleSize - 1)
              const it = si - i0
              const v00 = sampleElevs[j0]?.[i0] ?? 500
              const v10 = sampleElevs[j0]?.[i1] ?? 500
              const v01 = sampleElevs[j1]?.[i0] ?? 500
              const v11 = sampleElevs[j1]?.[i1] ?? 500
              elevations[j][i] = v00 * (1 - it) * (1 - jt) + v10 * it * (1 - jt) + v01 * (1 - it) * jt + v11 * it * jt
            }
          }
        } catch {
          // Fallback: flat terrain with gentle noise
          for (let j = 0; j < gridSize; j++) {
            elevations[j] = []
            for (let i = 0; i < gridSize; i++) {
              elevations[j][i] = 500 + Math.sin(i * 0.3) * 5 + Math.cos(j * 0.2) * 3
            }
          }
          minElev = 490
          maxElev = 510
        }

        if (minElev === Infinity) { minElev = 490; maxElev = 510 }
        const elevRange = maxElev - minElev || 1

        // Build terrain geometry
        const geometry = new THREE.PlaneGeometry(
          sceneW / maxDim * 8,
          sceneH / maxDim * 8,
          gridSize - 1,
          gridSize - 1
        )

        const positions = geometry.attributes.position
        const colors = new Float32Array(positions.count * 3)
        const exaggeration = 0.03

        for (let j = 0; j < gridSize; j++) {
          for (let i = 0; i < gridSize; i++) {
            const idx = j * gridSize + i
            const elev = elevations[j][i]
            const normalizedElev = (elev - minElev) / elevRange
            const heightVal = normalizedElev * (sceneH / maxDim * 8) * exaggeration * 1.3

            positions.setZ(idx, heightVal)

            // Elevation color gradient (green to yellow to red)
            const t = normalizedElev
            if (t < 0.25) {
              colors[idx * 3] = 0.1
              colors[idx * 3 + 1] = 0.5 + t * 2
              colors[idx * 3 + 2] = 0.1
            } else if (t < 0.5) {
              const s = (t - 0.25) / 0.25
              colors[idx * 3] = s * 0.8
              colors[idx * 3 + 1] = 0.7 + s * 0.3
              colors[idx * 3 + 2] = 0.1
            } else if (t < 0.75) {
              const s = (t - 0.5) / 0.25
              colors[idx * 3] = 0.8 + s * 0.2
              colors[idx * 3 + 1] = 1.0 - s * 0.3
              colors[idx * 3 + 2] = 0.1
            } else {
              const s = (t - 0.75) / 0.25
              colors[idx * 3] = 1.0
              colors[idx * 3 + 1] = 0.7 - s * 0.5
              colors[idx * 3 + 2] = 0.1 + s * 0.2
            }
          }
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        geometry.computeVertexNormals()

        // Create polygon boundary mask
        const toLocal = (lng: number, lat: number): [number, number] => {
          const x = ((lng - minLng) / (maxLng - minLng) - 0.5) * (sceneW / maxDim * 8)
          const y = ((lat - minLat) / (maxLat - minLat) - 0.5) * (sceneH / maxDim * 8)
          return [x, y]
        }

        // Boundary outline
        const boundaryPoints = DEMO_POLYGON.map(p => {
          const [x, y] = toLocal(p[0], p[1])
          const gi = ((p[0] - minLng) / (maxLng - minLng)) * (gridSize - 1)
          const gj = ((p[1] - minLat) / (maxLat - minLat)) * (gridSize - 1)
          const i0 = Math.min(Math.floor(gi), gridSize - 2)
          const j0 = Math.min(Math.floor(gj), gridSize - 2)
          const it = gi - i0, jt = gj - j0
          const e = elevations[j0][i0] * (1-it)*(1-jt) + elevations[j0][i0+1]*it*(1-jt) +
                    elevations[j0+1][i0]*(1-it)*jt + elevations[j0+1][i0+1]*it*jt
          const z = ((e - minElev) / elevRange) * (sceneH / maxDim * 8) * exaggeration * 1.3 + 0.02
          return new THREE.Vector3(x, y, z)
        })

        const boundaryGeom = new THREE.BufferGeometry().setFromPoints(boundaryPoints)
        const boundaryLine = new THREE.Line(boundaryGeom, new THREE.LineBasicMaterial({
          color: 0xE91E8C,
          linewidth: 2,
        }))

        // Terrain material
        const material = new THREE.MeshLambertMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
        })

        const mesh = new THREE.Mesh(geometry, material)
        mesh.rotation.x = -Math.PI / 2
        scene.add(mesh)

        boundaryLine.rotation.x = -Math.PI / 2
        scene.add(boundaryLine)

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 0.4)
        scene.add(ambient)
        const directional = new THREE.DirectionalLight(0xffffff, 0.8)
        directional.position.set(5, 10, 5)
        scene.add(directional)
        const directional2 = new THREE.DirectionalLight(0xffffff, 0.3)
        directional2.position.set(-5, 5, -5)
        scene.add(directional2)

        // Camera position
        camera.position.set(6, 5, 6)
        camera.lookAt(0, 0, 0)
        controls.target.set(0, 0.2, 0)

        // Elevation legend
        const legendDiv = document.createElement('div')
        legendDiv.style.cssText = `
          position: absolute; bottom: 16px; right: 16px;
          background: rgba(0,0,0,0.7); border-radius: 8px; padding: 10px 14px;
          font-family: system-ui; font-size: 11px; color: #aaa;
          backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
        `
        legendDiv.innerHTML = `
          <div style="font-weight:600; margin-bottom:6px; color:#ddd">ELEVATION</div>
          <div style="display:flex; align-items:center; gap:8px">
            <div style="width:80px; height:8px; border-radius:4px; background:linear-gradient(90deg, #1a8a1a, #cccc1a, #cc8800, #ff3333)"></div>
          </div>
          <div style="display:flex; justify-content:space-between; margin-top:2px">
            <span>${Math.round(minElev)} ft</span>
            <span>${Math.round(maxElev)} ft</span>
          </div>
        `
        container.appendChild(legendDiv)

        // Info label
        const infoDiv = document.createElement('div')
        infoDiv.style.cssText = `
          position: absolute; top: 16px; left: 16px;
          font-family: system-ui; font-size: 13px; color: #fff;
        `
        infoDiv.innerHTML = `
          <div style="font-weight:700; font-size:15px">${DEMO_INFO.county}, ${DEMO_INFO.state}</div>
          <div style="color:#aaa; font-size:11px; margin-top:2px">${DEMO_INFO.acres} acres · ${DEMO_INFO.township}</div>
        `
        container.appendChild(infoDiv)

        setLoaded(true)

        // Animation loop
        let animId: number
        const animate = () => {
          animId = requestAnimationFrame(animate)
          controls.update()
          renderer.render(scene, camera)
        }
        animate()

        // Resize handler
        const onResize = () => {
          const w = container.clientWidth
          const h = container.clientHeight
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
          if (container.contains(renderer.domElement)) {
            container.removeChild(renderer.domElement)
          }
          if (container.contains(legendDiv)) container.removeChild(legendDiv)
          if (container.contains(infoDiv)) container.removeChild(infoDiv)
        }
      } catch (err) {
        console.error('3D terrain init failed:', err)
        setError(true)
      }
    }

    init()

    return () => {
      if (cleanup) cleanup()
    }
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
