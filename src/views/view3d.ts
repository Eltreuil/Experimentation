import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { App, ElevationDir } from '../app';
import { elementMeshes } from '../model/mesh';
import type { Id } from '../model/types';

export type VisualStyle = 'shaded' | 'consistent' | 'wireframe';

const SELECT_COLOR = new THREE.Color('#1a73e8');

/** Vue 3D (perspective) ou élévation (orthographique) du modèle. */
export class View3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly model = new THREE.Group();
  private annotations = new THREE.Group();
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private frame = 0;
  private dirtyModel = true;
  private disposers: (() => void)[] = [];
  private meshesById = new Map<Id, THREE.Mesh[]>();
  private materials = new Map<string, THREE.Material>();
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.55 });
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
  private downAt: { x: number; y: number } | null = null;
  private framed = false;
  style: VisualStyle = 'consistent';
  edges = true;
  clipHeight: number | null = null;

  constructor(
    readonly app: App,
    readonly container: HTMLElement,
    readonly elevation: ElevationDir | null = null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.shadowMap.enabled = !elevation;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = 'view3d-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(elevation ? '#ffffff' : '#dfe7ef');
    this.scene.add(this.model, this.annotations);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d8a80, elevation ? 1.6 : 1.1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, elevation ? 0.6 : 1.6);
    this.sun.position.set(18, 30, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    if (!elevation) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(400, 400),
        new THREE.MeshStandardMaterial({ color: '#c9d3bd', roughness: 1 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.002;
      ground.receiveShadow = true;
      ground.userData.ground = true;
      this.scene.add(ground);
    }

    if (elevation) {
      this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -1000, 1000);
    } else {
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
      this.camera.position.set(18, 14, 18);
    }
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    if (elevation) {
      this.controls.enableRotate = false;
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    } else {
      this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    }
    this.controls.addEventListener('change', () => this.requestRender());

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.disposers.push(() => ro.disconnect());
    this.disposers.push(
      app.project.onChange(() => {
        this.dirtyModel = true;
        this.requestRender();
      }),
    );
    this.disposers.push(app.on('selection', () => this.updateSelection()));

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!this.downAt || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
      this.downAt = null;
      if (moved < 4) this.pick(e);
    });
    el.addEventListener('dblclick', () => this.zoomExtents());
    this.resize();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const d of this.disposers) d();
    this.controls.dispose();
    this.clearModel();
    for (const m of this.materials.values()) m.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    this.renderer.setSize(w, h);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = w / h;
    } else {
      const halfH = (this.camera.top - this.camera.bottom) / 2;
      const cy = (this.camera.top + this.camera.bottom) / 2;
      const cx = (this.camera.right + this.camera.left) / 2;
      this.camera.top = cy + halfH;
      this.camera.bottom = cy - halfH;
      this.camera.left = cx - (halfH * w) / h;
      this.camera.right = cx + (halfH * w) / h;
    }
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.render());
  }

  private render(): void {
    if (this.dirtyModel) {
      this.rebuild();
      this.dirtyModel = false;
      if (!this.framed) {
        this.framed = true;
        this.zoomExtents();
      }
    }
    const moving = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (moving) this.requestRender();
  }

  /** Construit le modèle immédiatement (export sans rendu à l'écran). */
  ensureBuilt(): void {
    if (!this.dirtyModel) return;
    this.rebuild();
    this.dirtyModel = false;
  }

  setStyle(style: VisualStyle): void {
    this.style = style;
    this.dirtyModel = true;
    this.requestRender();
  }

  setEdges(on: boolean): void {
    this.edges = on;
    this.dirtyModel = true;
    this.requestRender();
  }

  /** Coupe horizontale (hauteur absolue en m) pour voir l'intérieur. */
  setClip(height: number | null): void {
    this.clipHeight = height;
    this.clipPlane.constant = height ?? 1000;
    this.requestRender();
  }

  private material(color: string, kind: 'opaque' | 'glass'): THREE.Material {
    const key = `${kind}:${color}:${this.style}`;
    let m = this.materials.get(key);
    if (!m) {
      const clippingPlanes = [this.clipPlane];
      if (kind === 'glass') {
        m = new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0, clippingPlanes, side: THREE.DoubleSide, depthWrite: false });
      } else if (this.style === 'wireframe') {
        m = new THREE.MeshBasicMaterial({ color, wireframe: true, clippingPlanes });
      } else if (this.style === 'consistent') {
        m = new THREE.MeshLambertMaterial({ color, clippingPlanes, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      } else {
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, clippingPlanes, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      }
      this.materials.set(key, m);
    }
    return m;
  }

  private clearModel(): void {
    this.model.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    });
    this.model.clear();
    this.annotations.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
      if (o instanceof THREE.Line) o.geometry.dispose();
    });
    this.annotations.clear();
    this.meshesById.clear();
  }

  private rebuild(): void {
    this.clearModel();
    const p = this.app.project;
    for (const e of p.elements) {
      const em = elementMeshes(p, e);
      if (!em) continue;
      const list: THREE.Mesh[] = [];
      for (const s of em.solids) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(s.positions, 3));
        geo.computeVertexNormals();
        const mat = this.material(s.color, s.material);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = s.material !== 'glass';
        mesh.receiveShadow = true;
        mesh.userData.id = e.id;
        mesh.userData.baseMaterial = mat;
        this.model.add(mesh);
        list.push(mesh);
        if (this.edges && this.style !== 'wireframe' && s.material !== 'glass') {
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), this.edgeMaterial);
          edges.raycast = () => {};
          mesh.add(edges);
        }
      }
      this.meshesById.set(e.id, list);
    }
    this.edgeMaterial.clippingPlanes = [this.clipPlane];
    if (this.elevation) this.buildLevelMarkers();
    this.updateSelection();
    this.updateShadowCamera();
  }

  private buildLevelMarkers(): void {
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const horiz = this.elevation === 'N' || this.elevation === 'S' ? 'x' : 'z';
    const min = box.min[horiz] - 2;
    const max = box.max[horiz] + 2;
    for (const l of this.app.project.sortedLevels()) {
      const pts =
        horiz === 'x'
          ? [new THREE.Vector3(min, l.elevation, 0), new THREE.Vector3(max, l.elevation, 0)]
          : [new THREE.Vector3(0, l.elevation, min), new THREE.Vector3(0, l.elevation, max)];
      // Place les repères devant le modèle, du côté de la caméra.
      const front = this.viewDirection().multiplyScalar(-1);
      const shift = front.clone().multiplyScalar(50);
      pts.forEach((pt) => pt.add(shift));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x3e7cb1, dashSize: 0.6, gapSize: 0.25 }));
      line.computeLineDistances();
      this.annotations.add(line);
      const label = makeTextSprite(`${l.name}  ${l.elevation >= 0 ? '+' : ''}${l.elevation.toFixed(2)}`);
      // Étiquette à l'extrémité droite (à l'écran) de la ligne de niveau.
      const right = new THREE.Vector3().crossVectors(this.viewDirection(), new THREE.Vector3(0, 1, 0));
      const end = (pts[0].dot(right) > pts[1].dot(right) ? pts[0] : pts[1]).clone();
      label.position.copy(end).add(new THREE.Vector3(0, 0.35, 0));
      this.annotations.add(label);
    }
  }

  private updateShadowCamera(): void {
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 + 2;
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).add(new THREE.Vector3(0.6, 1, 0.45).normalize().multiplyScalar(r * 2));
    const sc = this.sun.shadow.camera;
    sc.left = -r;
    sc.right = r;
    sc.top = r;
    sc.bottom = -r;
    sc.near = 0.1;
    sc.far = r * 4;
    sc.updateProjectionMatrix();
  }

  private updateSelection(): void {
    for (const [id, meshes] of this.meshesById) {
      const sel = this.app.selection.has(id);
      for (const m of meshes) {
        const base = m.userData.baseMaterial as THREE.Material;
        if (m.material !== base) (m.material as THREE.Material).dispose();
        if (!sel) {
          m.material = base;
          continue;
        }
        const hl = (base as THREE.MeshLambertMaterial).clone();
        if ('emissive' in hl) (hl as THREE.MeshLambertMaterial).emissive = SELECT_COLOR.clone().multiplyScalar(0.55);
        if ('color' in hl) (hl as THREE.MeshLambertMaterial).color = SELECT_COLOR.clone();
        m.material = hl;
      }
    }
    this.requestRender();
  }

  private pick(e: PointerEvent): void {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.model.children, false).filter((h) => {
      if (this.clipHeight === null) return true;
      return h.point.y <= this.clipHeight;
    });
    const id = hits[0]?.object.userData.id as Id | undefined;
    if (id) this.app.select([id], e.shiftKey || e.ctrlKey);
    else if (!e.shiftKey) this.app.clearSelection();
  }

  private viewDirection(): THREE.Vector3 {
    // Direction dans laquelle regarde la caméra de l'élévation.
    switch (this.elevation) {
      case 'S':
        return new THREE.Vector3(0, 0, -1); // façade sud, regard vers le nord
      case 'N':
        return new THREE.Vector3(0, 0, 1);
      case 'E':
        return new THREE.Vector3(-1, 0, 0);
      case 'W':
        return new THREE.Vector3(1, 0, 0);
      default:
        return new THREE.Vector3(-1, -0.6, -1).normalize();
    }
  }

  zoomExtents(): void {
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 3, 5));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = size.length() / 2;
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      if (dir.lengthSq() < 1e-6 || !this.framed) dir.set(1, 0.75, 1).normalize();
      const d = radius / Math.sin((this.camera.fov * Math.PI) / 360);
      this.camera.position.copy(center).add(dir.multiplyScalar(d * 0.9));
      this.camera.near = Math.max(0.05, d / 1000);
      this.camera.far = d * 50;
    } else {
      const look = this.viewDirection();
      this.camera.position.copy(center).sub(look.clone().multiplyScalar(200));
      this.camera.up.set(0, 1, 0);
      const r = this.container.getBoundingClientRect();
      const aspect = Math.max(1, r.width) / Math.max(1, r.height);
      const horiz = Math.abs(look.x) > 0.5 ? size.z : size.x;
      const halfH = Math.max(size.y, horiz / aspect) * 0.65 + 0.5;
      this.camera.top = halfH;
      this.camera.bottom = -halfH;
      this.camera.left = -halfH * aspect;
      this.camera.right = halfH * aspect;
      this.camera.zoom = 1;
      this.camera.near = 0.1;
      this.camera.far = 1000;
    }
    this.controls.target.copy(center);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  /** Orientation prédéfinie (ViewCube simplifié). */
  setOrientation(kind: 'iso' | 'top' | 'front' | 'right'): void {
    if (!(this.camera instanceof THREE.PerspectiveCamera)) return;
    const dirs = {
      iso: new THREE.Vector3(1, 0.75, 1),
      top: new THREE.Vector3(0, 1, 0.0001),
      front: new THREE.Vector3(0, 0.15, 1),
      right: new THREE.Vector3(1, 0.15, 0),
    };
    const d = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.copy(this.controls.target).add(dirs[kind].normalize().multiplyScalar(d));
    this.controls.update();
    this.requestRender();
  }

  snapshot(): string {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }
}

function makeTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '600 36px Inter, system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = w;
  canvas.height = 48;
  ctx.font = font;
  ctx.fillStyle = '#3e7cb1';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, 24);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.center.set(0, 0.5);
  sprite.scale.set((w / 48) * 0.45, 0.45, 1);
  return sprite;
}
