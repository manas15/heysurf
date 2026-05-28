const OVERLAY_HOST_ID = 'heysurf-overlay-host';

const OVERLAY_CSS = `
  :host {
    all: initial;
  }

  #overlay-root {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483647;
    overflow: visible;
  }

  /* Cursor */
  #heysurf-cursor {
    position: fixed;
    top: 0;
    left: 0;
    width: 24px;
    height: 24px;
    pointer-events: none;
    will-change: transform;
    opacity: 0;
    z-index: 2147483647;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
  }

  /* Click ripple */
  .heysurf-click-ripple {
    position: fixed;
    pointer-events: none;
    width: 0;
    height: 0;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    animation: heysurf-ripple 600ms ease-out forwards;
  }

  @keyframes heysurf-ripple {
    0% {
      width: 0;
      height: 0;
      box-shadow:
        0 0 0 0 rgba(99, 102, 241, 0.6),
        0 0 0 0 rgba(99, 102, 241, 0.3);
      opacity: 1;
    }
    100% {
      width: 40px;
      height: 40px;
      box-shadow:
        0 0 0 10px rgba(99, 102, 241, 0),
        0 0 0 20px rgba(99, 102, 241, 0);
      opacity: 0;
    }
  }

  /* Highlight box */
  .heysurf-highlight-box {
    position: fixed;
    pointer-events: none;
    border: 2px solid rgba(99, 102, 241, 0.8);
    background: rgba(99, 102, 241, 0.08);
    border-radius: 4px;
    animation: heysurf-highlight-in 200ms ease-out forwards;
    z-index: 2147483646;
  }

  @keyframes heysurf-highlight-in {
    0% {
      opacity: 0;
      transform: scale(1.05);
    }
    100% {
      opacity: 1;
      transform: scale(1.0);
    }
  }

  /* Highlight label */
  .heysurf-highlight-label {
    position: absolute;
    bottom: 100%;
    left: -2px;
    background: rgba(99, 102, 241, 0.9);
    color: #fff;
    font: 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    padding: 2px 8px;
    border-radius: 4px 4px 0 0;
    white-space: nowrap;
    line-height: 1.4;
  }

  /* Typing indicator */
  .heysurf-typing-indicator {
    position: fixed;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(99, 102, 241, 0.9);
    pointer-events: none;
    animation: heysurf-pulse 0.8s ease-in-out infinite;
  }

  @keyframes heysurf-pulse {
    0%, 100% {
      opacity: 0.4;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  /* Scroll indicator */
  .heysurf-scroll-indicator {
    position: fixed;
    right: 24px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 32px;
    color: rgba(99, 102, 241, 0.8);
    pointer-events: none;
    animation: heysurf-scroll-fade 800ms ease-out forwards;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  @keyframes heysurf-scroll-fade {
    0% {
      opacity: 1;
      transform: translateY(-50%);
    }
    100% {
      opacity: 0;
      transform: translateY(-50%);
    }
  }

  /* Navigate toast */
  .heysurf-navigate-toast {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    padding: 12px 24px;
    border-radius: 8px;
    pointer-events: none;
    animation: heysurf-toast-fade 1.5s ease-out forwards;
    white-space: nowrap;
  }

  @keyframes heysurf-toast-fade {
    0%, 60% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  /* Done indicator */
  .heysurf-done-indicator {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: rgba(34, 197, 94, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: heysurf-done-fade 1.5s ease-out forwards;
  }

  .heysurf-done-indicator::after {
    content: '\\2713';
    color: #fff;
    font-size: 28px;
    line-height: 1;
  }

  @keyframes heysurf-done-fade {
    0%, 50% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.8);
    }
  }
`;

let shadowRoot: ShadowRoot | null = null;
let hostEl: HTMLElement | null = null;

export function getOverlayHost(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  hostEl = document.createElement('div');
  hostEl.id = OVERLAY_HOST_ID;
  hostEl.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(hostEl);

  shadowRoot = hostEl.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadowRoot.appendChild(style);

  const root = document.createElement('div');
  root.id = 'overlay-root';
  shadowRoot.appendChild(root);

  return shadowRoot;
}

export function destroyOverlay(): void {
  if (hostEl) {
    hostEl.remove();
    hostEl = null;
    shadowRoot = null;
  }
}
