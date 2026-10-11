/** WebGL availability and context-loss handling (spec §9). DOM-only; no Three.js imports. */

export function detectWebGL(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const canvas = createCanvas();
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return gl !== null && gl !== undefined;
  } catch {
    return false;
  }
}

/**
 * Calls `onLost` when the GPU context is lost (driver reset, too many contexts, tab backgrounded on
 * some devices) and `onRestored` when the browser restores it. Returns a cleanup function.
 */
export function watchContextLoss(canvas: HTMLCanvasElement, onLost: () => void, onRestored: () => void): () => void {
  const lost = (event: Event) => {
    event.preventDefault(); // allow the browser to restore the context
    onLost();
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}
