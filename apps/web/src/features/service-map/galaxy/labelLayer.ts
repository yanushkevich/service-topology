import * as THREE from 'three';
import { hiddenLabels, type ScreenLabel } from './labelDeclutter';

/** Where a label sits in the scene (Html `center` centres it there) and how important it is. */
export interface LabelAnchor {
  id: string;
  position: readonly [number, number, number];
  /** Lower keeps its place first (labelDeclutter.ts). */
  priority: number;
}

/**
 * A 3D scene's HTML labels and their declutter (labelDeclutter.ts), shared by the galaxy and the
 * flow drill-down. Labels attach their elements; `update` runs from the frame loop but re-measures
 * only when the camera, the canvas size, the anchors, or the labels changed. Anchors must keep
 * their identity between renders (memoize them). It writes label styles, never state.
 */
export class LabelLayer {
  private readonly labels = new Map<string, HTMLElement>();
  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private size = '';
  private anchors: readonly LabelAnchor[] | null = null;
  private dirty = true;

  /** Registers (or, with null, forgets) a label element. */
  attach(id: string, el: HTMLElement | null): void {
    if (el) this.labels.set(id, el);
    else this.labels.delete(id);
    this.dirty = true;
  }

  update(camera: THREE.Camera, size: { width: number; height: number }, anchors: readonly LabelAnchor[]): void {
    const key = `${size.width}x${size.height}`;
    if (!this.dirty && this.size === key && this.anchors === anchors && this.matrix.equals(camera.matrixWorld)) return;
    this.dirty = false;
    this.size = key;
    this.anchors = anchors;
    this.matrix.copy(camera.matrixWorld);
    const hidden = hiddenLabels(this.measure(camera, size, anchors));
    for (const [id, el] of this.labels) {
      const opacity = hidden.has(id) ? '0' : '';
      if (el.style.opacity !== opacity) el.style.opacity = opacity;
    }
  }

  /** Screen boxes of the shown labels, centred on their anchors. */
  private measure(camera: THREE.Camera, size: { width: number; height: number }, anchors: readonly LabelAnchor[]): ScreenLabel[] {
    const out: ScreenLabel[] = [];
    for (const anchor of anchors) {
      const el = this.labels.get(anchor.id);
      if (!el || el.style.visibility === 'hidden') continue;
      this.point.set(anchor.position[0], anchor.position[1], anchor.position[2]).project(camera);
      if (this.point.z > 1) continue; // behind the camera
      out.push({ id: anchor.id, x: ((this.point.x + 1) / 2) * size.width, y: ((1 - this.point.y) / 2) * size.height, width: el.offsetWidth, height: el.offsetHeight, priority: anchor.priority });
    }
    return out;
  }
}
