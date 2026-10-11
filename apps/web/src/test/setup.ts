import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Map tests wait for ELK layout (bundled build in jsdom); 1 s is too tight when test files run in parallel.
configure({ asyncUtilTimeout: 5000 });

// index.html declares lang="en"; jsdom's blank document does not.
document.documentElement.lang = 'en';

// jsdom does not implement matchMedia.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// React Flow needs layout APIs jsdom lacks (shims follow the React Flow testing guide).
class ResizeObserverShim {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const contentRect = { x: 0, y: 0, top: 0, left: 0, width: 1000, height: 700, right: 1000, bottom: 700 } as DOMRectReadOnly;
    this.callback([{ target, contentRect } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverShim as unknown as typeof ResizeObserver;

class DOMMatrixReadOnlyShim {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}
(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= DOMMatrixReadOnlyShim;

Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { configurable: true, get() { return parseFloat((this as HTMLElement).style.height) || 1; } },
  offsetWidth: { configurable: true, get() { return parseFloat((this as HTMLElement).style.width) || 1; } },
});
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
  ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
