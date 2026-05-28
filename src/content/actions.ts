import { AgentAction } from '../shared/types';

function findElements(target: string): Element[] {
  const results: Element[] = [];
  const lowerTarget = target.toLowerCase();

  const all = document.querySelectorAll(
    'a, button, input, select, textarea, [role], h1, h2, h3, h4, h5, h6, label, img, summary, [tabindex], [onclick]',
  );

  for (const el of Array.from(all)) {
    // Check aria-label
    const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
    if (ariaLabel && ariaLabel.includes(lowerTarget)) {
      results.push(el);
      continue;
    }

    // Check text content
    const text = el.textContent?.trim().toLowerCase();
    if (text && text.includes(lowerTarget)) {
      results.push(el);
      continue;
    }

    // Check placeholder
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.placeholder?.toLowerCase().includes(lowerTarget)) {
        results.push(el);
        continue;
      }
    }

    // Check value for inputs
    if (el instanceof HTMLInputElement && el.value?.toLowerCase().includes(lowerTarget)) {
      results.push(el);
      continue;
    }

    // Check title
    const title = el.getAttribute('title')?.toLowerCase();
    if (title && title.includes(lowerTarget)) {
      results.push(el);
      continue;
    }

    // Check alt for images
    if (el instanceof HTMLImageElement && el.alt?.toLowerCase().includes(lowerTarget)) {
      results.push(el);
      continue;
    }

    // Check associated label
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label?.textContent?.toLowerCase().includes(lowerTarget)) {
        results.push(el);
        continue;
      }
    }
  }

  // Deduplicate: prefer more specific (deeper) elements
  return deduplicateElements(results);
}

function deduplicateElements(elements: Element[]): Element[] {
  const unique: Element[] = [];
  for (const el of elements) {
    // Skip if a descendant of this element is already in the list
    const hasDescendant = elements.some(
      (other) => other !== el && el.contains(other),
    );
    if (!hasDescendant) {
      unique.push(el);
    }
  }
  return unique;
}

/** Find the first matching target element (exported for visual-feedback) */
export function findTargetElement(target: string, index?: number): Element | null {
  const elements = findElements(target);
  if (elements.length === 0) return null;
  const idx = index ?? 0;
  return elements[Math.min(idx, elements.length - 1)];
}

function scrollIntoViewIfNeeded(el: Element) {
  const rect = el.getBoundingClientRect();
  const inView =
    rect.top >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth;

  if (!inView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const CHAR_DELAY = 30; // ms between characters

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dispatchKeyEvents(el: Element, char: string): void {
  const opts = { key: char, code: `Key${char.toUpperCase()}`, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keypress', opts));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: char, inputType: 'insertText' }));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
}

async function typeCharByChar(
  el: HTMLInputElement | HTMLTextAreaElement,
  text: string,
): Promise<void> {
  for (const char of text) {
    el.value += char;
    dispatchKeyEvents(el, char);
    await sleep(CHAR_DELAY);
  }
}

async function typeCharByCharContentEditable(
  el: HTMLElement,
  text: string,
): Promise<void> {
  for (const char of text) {
    el.textContent = (el.textContent ?? '') + char;
    dispatchKeyEvents(el, char);
    await sleep(CHAR_DELAY);
  }
}

export async function executeAction(action: AgentAction): Promise<{ success: boolean; message: string }> {
  try {
    switch (action.name) {
      case 'click': {
        const elements = findElements(action.args.target);
        const idx = action.args.index ?? 0;
        if (elements.length === 0) {
          return { success: false, message: `No element found matching "${action.args.target}"` };
        }
        const el = elements[Math.min(idx, elements.length - 1)];
        scrollIntoViewIfNeeded(el);
        if (el instanceof HTMLElement) {
          el.click();
        } else {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        return { success: true, message: `Clicked "${action.args.target}"` };
      }

      case 'type': {
        const elements = findElements(action.args.target);
        if (elements.length === 0) {
          return { success: false, message: `No input found matching "${action.args.target}"` };
        }
        const el = elements[0];
        scrollIntoViewIfNeeded(el);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          if (action.args.clearFirst !== false) {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          // Character-by-character typing for realistic behavior
          await typeCharByChar(el, action.args.text);
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el instanceof HTMLElement && el.isContentEditable) {
          el.focus();
          if (action.args.clearFirst !== false) {
            el.textContent = '';
          }
          await typeCharByCharContentEditable(el, action.args.text);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          return { success: false, message: `Element "${action.args.target}" is not a text input` };
        }
        return { success: true, message: `Typed "${action.args.text}" into "${action.args.target}"` };
      }

      case 'select': {
        const elements = findElements(action.args.target);
        if (elements.length === 0) {
          return { success: false, message: `No select found matching "${action.args.target}"` };
        }
        const el = elements[0];
        if (!(el instanceof HTMLSelectElement)) {
          return { success: false, message: `Element "${action.args.target}" is not a select` };
        }
        const option = Array.from(el.options).find(
          (opt) => opt.text.toLowerCase().includes(action.args.option.toLowerCase()),
        );
        if (!option) {
          return { success: false, message: `No option "${action.args.option}" in select "${action.args.target}"` };
        }
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: `Selected "${action.args.option}" in "${action.args.target}"` };
      }

      case 'scroll': {
        const { direction, amount = 500 } = action.args;
        switch (direction) {
          case 'down':
            window.scrollBy({ top: amount, behavior: 'smooth' });
            break;
          case 'up':
            window.scrollBy({ top: -amount, behavior: 'smooth' });
            break;
          case 'top':
            window.scrollTo({ top: 0, behavior: 'smooth' });
            break;
          case 'bottom':
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            break;
        }
        return { success: true, message: `Scrolled ${direction}` };
      }

      case 'navigate': {
        window.location.href = action.args.url;
        return { success: true, message: `Navigating to ${action.args.url}` };
      }

      case 'read_page': {
        // Extract text content based on the query — return visible text
        const body = document.body;
        const text = body?.innerText || '';
        // Truncate to reasonable size for LLM
        const truncated = text.slice(0, 8000);
        return { success: true, message: truncated };
      }

      case 'wait': {
        const ms = action.args.milliseconds ?? 2000;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { success: true, message: `Waited ${ms}ms` };
      }

      case 'done': {
        return { success: true, message: action.args.summary };
      }

      default:
        return { success: false, message: `Unknown action: ${(action as AgentAction).name}` };
    }
  } catch (err) {
    return { success: false, message: `Action failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
