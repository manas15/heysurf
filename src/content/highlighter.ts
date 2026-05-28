const HIGHLIGHT_CLASS = 'heysurf-highlight';
const HIGHLIGHT_STYLE_ID = 'heysurf-highlight-style';

function injectStyles() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      outline: 3px solid #6366f1 !important;
      outline-offset: 2px !important;
      background-color: rgba(99, 102, 241, 0.1) !important;
      transition: outline 0.2s ease, background-color 0.2s ease !important;
      border-radius: 4px !important;
    }
  `;
  document.head.appendChild(style);
}

export function highlightElement(target: string, index: number = 0) {
  injectStyles();
  clearHighlights();

  const lowerTarget = target.toLowerCase();
  const all = document.querySelectorAll(
    'a, button, input, select, textarea, [role], h1, h2, h3, h4, h5, h6, img, [tabindex]',
  );

  let matchCount = 0;
  for (const el of Array.from(all)) {
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
    const text = el.textContent?.trim().toLowerCase() || '';
    const placeholder = (el as HTMLInputElement).placeholder?.toLowerCase() || '';
    const title = el.getAttribute('title')?.toLowerCase() || '';

    if (
      ariaLabel.includes(lowerTarget) ||
      text.includes(lowerTarget) ||
      placeholder.includes(lowerTarget) ||
      title.includes(lowerTarget)
    ) {
      if (matchCount === index) {
        el.classList.add(HIGHLIGHT_CLASS);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      matchCount++;
    }
  }
}

export function clearHighlights() {
  const highlighted = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
  for (const el of Array.from(highlighted)) {
    el.classList.remove(HIGHLIGHT_CLASS);
  }
}
