const HIGHLIGHT_CLASS = 'heysurf-highlight-box';

export function showHighlightBox(
  shadowRoot: ShadowRoot,
  el: Element,
  label?: string,
): HTMLElement {
  const box = document.createElement('div');
  box.className = HIGHLIGHT_CLASS;

  // Position over the target element
  const rect = el.getBoundingClientRect();
  applyRect(box, rect);

  // Optional label
  if (label) {
    const labelEl = document.createElement('div');
    labelEl.className = 'heysurf-highlight-label';
    labelEl.textContent = label;
    box.appendChild(labelEl);
  }

  const container = shadowRoot.getElementById('overlay-root') ?? shadowRoot;
  container.appendChild(box);

  // Track element position with rAF for 2 seconds
  let rafId: number;
  const start = performance.now();

  function track() {
    const elapsed = performance.now() - start;
    if (elapsed > 2000 || !box.isConnected) {
      return;
    }
    const r = el.getBoundingClientRect();
    applyRect(box, r);
    rafId = requestAnimationFrame(track);
  }

  rafId = requestAnimationFrame(track);

  // Store cleanup on the element for later removal
  (box as any).__heysurfCleanup = () => cancelAnimationFrame(rafId);

  return box;
}

function applyRect(box: HTMLElement, rect: DOMRect): void {
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

export function removeHighlightBox(box: HTMLElement): void {
  const cleanup = (box as any).__heysurfCleanup;
  if (typeof cleanup === 'function') cleanup();
  box.remove();
}

export function removeAllHighlights(shadowRoot: ShadowRoot): void {
  const boxes = shadowRoot.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  for (const box of Array.from(boxes)) {
    removeHighlightBox(box as HTMLElement);
  }
}
