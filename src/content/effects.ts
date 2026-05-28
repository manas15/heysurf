/** Click ripple: two expanding concentric rings at click point */
export function showClickRipple(shadowRoot: ShadowRoot, x: number, y: number): void {
  const ripple = document.createElement('div');
  ripple.className = 'heysurf-click-ripple';
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;

  const container = shadowRoot.getElementById('overlay-root') ?? shadowRoot;
  container.appendChild(ripple);

  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

/** Typing indicator: pulsing indigo dot near a position */
export function showTypingIndicator(shadowRoot: ShadowRoot, x: number, y: number): HTMLElement {
  const dot = document.createElement('div');
  dot.className = 'heysurf-typing-indicator';
  dot.style.left = `${x + 16}px`;
  dot.style.top = `${y - 4}px`;

  const container = shadowRoot.getElementById('overlay-root') ?? shadowRoot;
  container.appendChild(dot);

  return dot;
}

export function removeTypingIndicator(dot: HTMLElement): void {
  dot.remove();
}

/** Scroll indicator: directional arrow on right side of viewport */
export function showScrollIndicator(shadowRoot: ShadowRoot, direction: 'up' | 'down' | 'top' | 'bottom'): void {
  const arrow = document.createElement('div');
  arrow.className = 'heysurf-scroll-indicator';

  const arrows: Record<string, string> = {
    up: '\u2191',
    down: '\u2193',
    top: '\u21E7',
    bottom: '\u21E9',
  };
  arrow.textContent = arrows[direction] ?? arrows.down;

  const container = shadowRoot.getElementById('overlay-root') ?? shadowRoot;
  container.appendChild(arrow);

  arrow.addEventListener('animationend', () => arrow.remove(), { once: true });
}

/** Navigate toast: brief "Navigating to..." text */
export function showNavigateToast(shadowRoot: ShadowRoot, url: string): void {
  const toast = document.createElement('div');
  toast.className = 'heysurf-navigate-toast';
  // Show a truncated URL
  const displayUrl = url.length > 60 ? url.slice(0, 57) + '...' : url;
  toast.textContent = `Navigating to ${displayUrl}`;

  const container = shadowRoot.getElementById('overlay-root') ?? shadowRoot;
  container.appendChild(toast);

  toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

/** Done indicator: green checkmark that appears and fades */
export function showDoneIndicator(shadowRoot: ShadowRoot): void {
  const done = document.createElement('div');
  done.className = 'heysurf-done-indicator';

  const container = shadowRoot.getElementById('overlay-root') ?? shadowRoot;
  container.appendChild(done);

  done.addEventListener('animationend', () => done.remove(), { once: true });
}
