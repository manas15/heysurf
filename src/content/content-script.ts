import { ChromeMessage } from '../shared/types';
import { extractA11yTree, treeToString } from './a11y-tree';
import { executeAction } from './actions';
import { highlightElement, clearHighlights } from './highlighter';

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
          executeAction(message.action).then((result) => {
            sendResponse({
              type: 'ACTION_RESULT',
              success: result.success,
              message: result.message,
            });
          });
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
      }

      return false;
    },
  );
}
