import { AgentAction } from '../shared/types';
import { getOverlayHost, destroyOverlay as destroyHost } from './overlay-host';
import { AgentCursor } from './cursor';
import {
  showClickRipple,
  showTypingIndicator,
  removeTypingIndicator,
  showScrollIndicator,
  showNavigateToast,
  showDoneIndicator,
} from './effects';
import { showHighlightBox, removeHighlightBox, removeAllHighlights } from './highlight-overlay';

let cursor: AgentCursor | null = null;

function ensureCursor(): AgentCursor {
  if (!cursor) {
    const host = getOverlayHost();
    cursor = new AgentCursor(host);
    cursor.show();
  }
  return cursor;
}

export function initOverlay(): void {
  getOverlayHost();
  ensureCursor();
}

export function destroyOverlay(): void {
  if (cursor) {
    cursor.destroy();
    cursor = null;
  }
  destroyHost();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function visualizeAction(
  action: AgentAction,
  targetEl?: Element,
): Promise<void> {
  const host = getOverlayHost();

  switch (action.name) {
    case 'click': {
      if (!targetEl) return;
      const c = ensureCursor();
      const rect = targetEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      // 1. Show highlight box
      const box = showHighlightBox(host, targetEl, 'clicking');
      // 2. Animate cursor to element center
      await c.moveToElement(targetEl);
      // 3. Click ripple
      showClickRipple(host, cx, cy);
      // 4. Press animation
      await c.pressAnimation();
      // 5. Remove highlight after 400ms
      await delay(400);
      removeHighlightBox(box);
      break;
    }

    case 'type': {
      if (!targetEl) return;
      const c = ensureCursor();

      const truncatedText =
        action.args.text.length > 20
          ? action.args.text.slice(0, 20) + '...'
          : action.args.text;

      // 1. Show highlight box with label
      const box = showHighlightBox(host, targetEl, `typing '${truncatedText}'`);
      // 2. Move cursor to element
      await c.moveToElement(targetEl);
      // 3. Show typing indicator dot
      const pos = c.getPosition();
      const dot = showTypingIndicator(host, pos.x, pos.y);
      // 4. Remove after typing completes (2s timeout)
      await delay(2000);
      removeTypingIndicator(dot);
      removeHighlightBox(box);
      break;
    }

    case 'scroll': {
      // 1. Show directional arrow indicator
      showScrollIndicator(host, action.args.direction);
      break;
    }

    case 'navigate': {
      // 1. Show "Navigating to..." toast
      showNavigateToast(host, action.args.url);
      await delay(500);
      break;
    }

    case 'done': {
      // 1. Show green checkmark
      showDoneIndicator(host);
      // 2. Fade out cursor
      if (cursor) {
        cursor.hide();
      }
      break;
    }

    default:
      break;
  }
}
