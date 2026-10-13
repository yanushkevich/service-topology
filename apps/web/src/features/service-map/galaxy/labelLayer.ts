import * as THREE from 'three';
import { hiddenLabels, labelPriority, type ScreenLabel } from './labelDeclutter';
import type { SceneNode } from './sceneModel';

/**
 * The scene's HTML labels and their declutter (labelDeclutter.ts). Nodes attach their label
 * elements; `update` runs from the frame loop but re-measures only when the camera, the canvas
 * size, the nodes, the hovered node, or the labels changed. It writes label styles, never state.
 */
export class LabelLayer {
  private readonly labels = new Map<string, HTMLDivElement>();
  private readonly matrix = new THREE.Matrix4();
  private readonly point = new THREE.Vector3();
  private key = '';
  private nodes: readonly SceneNode[] | null = null;
  private dirty = true;

  /** Registers (or, with null, forgets) a node's label element. */
  attach(id: string, el: HTMLDivElement | null): void {
    if (el) this.labels.set(id, el);
    else this.labels.delete(id);
    this.dirty = true;
  }

  update(camera: THREE.Camera, size: { width: number; height: number }, nodes: readonly SceneNode[], hovered: string | null): void {
    const key = `${size.width}x${size.height}|${hovered ?? ''}`;
    if (!this.dirty && this.key === key && this.nodes === nodes && this.matrix.equals(camera.matrixWorld)) return;
    this.dirty = false;
    this.key = key;
    this.nodes = nodes;
    this.matrix.copy(camera.matrixWorld);
    const hidden = hiddenLabels(this.measure(camera, size, nodes, hovered));
    for (const [id, el] of this.labels) {
      const opacity = hidden.has(id) ? '0' : '';
      if (el.style.opacity !== opacity) el.style.opacity = opacity;
    }
  }

  /** Screen boxes of the shown labels (Html `center` centres each on its anchor above the node). */
  private measure(camera: THREE.Camera, size: { width: number; height: number }, nodes: readonly SceneNode[], hovered: string | null): ScreenLabel[] {
    const out: ScreenLabel[] = [];
    for (const node of nodes) {
      const el = this.labels.get(node.id);
      if (!el || el.style.visibility === 'hidden') continue;
      const [x, y, z] = node.position;
      this.point.set(x, y + node.radius + 8, z).project(camera);
      if (this.point.z > 1) continue; // behind the camera
      out.push({
        id: node.id,
        x: ((this.point.x + 1) / 2) * size.width,
        y: ((1 - this.point.y) / 2) * size.height,
        width: el.offsetWidth,
        height: el.offsetHeight,
        priority: labelPriority(node, hovered),
      });
    }
    return out;
  }
}
