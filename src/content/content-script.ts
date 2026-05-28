import { ChromeMessage } from '../shared/types';
import { extractA11yTree, treeToString } from './a11y-tree';
import { executeAction, findTargetElement } from './actions';
import { highlightElement, clearHighlights } from './highlighter';
import { visualizeAction, initOverlay, destroyOverlay } from './visual-feedback';

// Guard against duplicate injection
if (!(window as any).__heySurfInjected) {
  (window as any).__heySurfInjected = true;

  chrome.runtime.onMessage.addListener(
    (message: ChromeMessage, _sender, sendResponse) => {
      switch (message.type) {
        case 'PING': {
          sendResponse({ type: 'PONG' });
          return false;
        }

        case 'GET_A11Y_TREE': {
          try {
            const tree = extractA11yTree();
            const treeStr = treeToString(tree);
            sendResponse({
              type: 'A11Y_TREE_RESULT',
              tree: treeStr,
              url: window.location.href,
              title: document.title,
            });
          } catch (err) {
            sendResponse({
              type: 'A11Y_TREE_RESULT',
              tree: `[Error extracting tree: ${err}]`,
              url: window.location.href,
              title: document.title,
            });
          }
          return false;
        }

        case 'EXECUTE_ACTION': {
          (async () => {
            // Find target element for visualization
            const action = message.action;
            let targetEl: Element | undefined;
            if ('target' in action.args && typeof action.args.target === 'string') {
              targetEl = findTargetElement(action.args.target, (action.args as any).index) ?? undefined;
            }
            // Visualize action BEFORE executing
            await visualizeAction(action, targetEl);
            // Execute the actual action
            const result = await executeAction(action);
            sendResponse({
              type: 'ACTION_RESULT',
              success: result.success,
              message: result.message,
            });
          })();
          return true; // async response
        }

        case 'HIGHLIGHT_ELEMENT': {
          highlightElement(message.target, message.index);
          sendResponse({ success: true });
          return false;
        }

        case 'CLEAR_HIGHLIGHTS': {
          clearHighlights();
          sendResponse({ success: true });
          return false;
        }

        case 'GET_PAGE_INFO': {
          sendResponse({
            type: 'PAGE_INFO_RESULT',
            url: window.location.href,
            title: document.title,
          });
          return false;
        }

        case 'INIT_OVERLAY': {
          initOverlay();
          sendResponse({ success: true });
          return false;
        }

        case 'DESTROY_OVERLAY': {
          destroyOverlay();
          sendResponse({ success: true });
          return false;
        }
      }

      return false;
    },
  );
}
