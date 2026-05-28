import { ToolDefinition } from '../shared/types';

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'click',
      description: 'Click an element on the page. Use the accessible name, role, or visible text to identify it.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'The accessible name, role, or visible text of the element to click',
          },
          index: {
            type: 'number',
            description: 'If multiple elements match, which one to click (0-indexed). Defaults to 0.',
          },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description: 'Type text into an input field, textarea, or contenteditable element.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'The accessible name or label of the input field',
          },
          text: {
            type: 'string',
            description: 'The text to type into the field',
          },
          clearFirst: {
            type: 'boolean',
            description: 'Whether to clear existing text before typing. Defaults to true.',
          },
        },
        required: ['target', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'select',
      description: 'Select an option from a dropdown/select element.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'The accessible name or label of the select element',
          },
          option: {
            type: 'string',
            description: 'The visible text of the option to select',
          },
        },
        required: ['target', 'option'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description: 'Scroll the page in a given direction.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down', 'top', 'bottom'],
            description: 'Direction to scroll',
          },
          amount: {
            type: 'number',
            description: 'Pixels to scroll (for up/down). Defaults to 500.',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a different URL in the current tab.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to navigate to',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description: 'Extract specific content from the page when the accessibility tree alone is insufficient. Use this for reading detailed text, tables, or specific sections.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What content to extract (e.g., "the price", "all email addresses", "the main article text")',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Wait for the page to update, e.g. after a navigation or AJAX request.',
      parameters: {
        type: 'object',
        properties: {
          milliseconds: {
            type: 'number',
            description: 'How long to wait in milliseconds. Defaults to 2000.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description: 'Signal that the task is complete. The summary will be spoken to the user.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'A brief summary of what was accomplished. This is spoken aloud to the user.',
          },
        },
        required: ['summary'],
      },
    },
  },
];
