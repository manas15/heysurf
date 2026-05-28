const CURSOR_ID = 'heysurf-cursor';
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const MOVE_DURATION = 450;

// Standard arrow cursor SVG — dark fill, white stroke
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <path d="M5 3l14 11-6.5 1L9 21z" fill="#1e1e2e" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;

export class AgentCursor {
  private el: SVGSVGElement;
  private root: ShadowRoot;
  private currentX = 0;
  private currentY = 0;

  constructor(shadowRoot: ShadowRoot) {
    this.root = shadowRoot;

    // Parse the SVG string into an element
    const tmp = document.createElement('div');
    tmp.innerHTML = CURSOR_SVG;
    this.el = tmp.firstElementChild as SVGSVGElement;
    this.el.id = CURSOR_ID;
    this.el.style.willChange = 'transform';

    const overlayRoot = shadowRoot.getElementById('overlay-root');
    if (overlayRoot) {
      overlayRoot.appendChild(this.el);
    } else {
      shadowRoot.appendChild(this.el);
    }
  }

  async moveTo(x: number, y: number): Promise<void> {
    const anim = this.el.animate(
      [
        { transform: `translate(${this.currentX}px, ${this.currentY}px)` },
        { transform: `translate(${x}px, ${y}px)` },
      ],
      {
        duration: MOVE_DURATION,
        easing: EASING,
        fill: 'forwards',
      },
    );

    await anim.finished;
    this.currentX = x;
    this.currentY = y;
  }

  async moveToElement(el: Element): Promise<void> {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    await this.moveTo(x, y);
  }

  async pressAnimation(): Promise<void> {
    const anim = this.el.animate(
      [
        { transform: `translate(${this.currentX}px, ${this.currentY}px) scale(1)` },
        { transform: `translate(${this.currentX}px, ${this.currentY}px) scale(0.85)` },
        { transform: `translate(${this.currentX}px, ${this.currentY}px) scale(1)` },
      ],
      {
        duration: 200,
        easing: 'ease-in-out',
        fill: 'forwards',
      },
    );
    await anim.finished;
  }

  show(): void {
    this.el.animate(
      [{ opacity: '0' }, { opacity: '1' }],
      { duration: 200, fill: 'forwards' },
    );
  }

  hide(): void {
    this.el.animate(
      [{ opacity: '1' }, { opacity: '0' }],
      { duration: 300, fill: 'forwards' },
    );
  }

  getPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  destroy(): void {
    this.el.remove();
  }
}
