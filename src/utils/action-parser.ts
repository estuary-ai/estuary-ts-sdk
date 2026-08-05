/**
 * Parses `<action name="..." .../>` XML tags from bot response text.
 *
 * Designed for streaming: call `parse()` with the accumulated text on each
 * chunk and it returns only newly-discovered actions since the last call.
 *
 * LEGACY (contract v1.9): the server now delivers actions as typed
 * `client_action` events and no longer instructs models to emit tags. This
 * parser stays during the deprecation window to strip stray tags from
 * displayed text (and fire characterAction if one slips through).
 */

export interface ParsedAction {
  name: string;
  params: Record<string, string>;
}

// Matches self-closing <action .../> tags (with optional whitespace before />)
const ACTION_TAG_RE = /<action\s+([^>]*?)\/>/gi;
// Matches key="value" or key='value' attribute pairs
const ATTR_RE = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*'([^']*)'/g;

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(attrString)) !== null) {
    const key = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    attrs[key] = value;
  }
  return attrs;
}

export class StreamingActionParser {
  private emittedCount = 0;

  /**
   * Parse the accumulated response text and return any new actions found
   * since the last call. Also returns the text with all action tags stripped.
   */
  parse(accumulatedText: string): { actions: ParsedAction[]; cleanText: string } {
    const allActions: ParsedAction[] = [];
    let match: RegExpExecArray | null;

    ACTION_TAG_RE.lastIndex = 0;
    while ((match = ACTION_TAG_RE.exec(accumulatedText)) !== null) {
      const attrs = parseAttributes(match[1]);
      const name = attrs.name;
      if (name) {
        delete attrs.name;
        allActions.push({ name, params: attrs });
      }
    }

    const newActions = allActions.slice(this.emittedCount);
    this.emittedCount = allActions.length;

    const cleanText = accumulatedText.replace(ACTION_TAG_RE, '').replace(/\s{2,}/g, ' ').trimEnd();

    return { actions: newActions, cleanText };
  }

  reset(): void {
    this.emittedCount = 0;
  }
}

/**
 * One-shot parse: extract all actions and return clean text.
 * Useful for non-streaming contexts.
 */
export function parseActions(text: string): { actions: ParsedAction[]; cleanText: string } {
  const parser = new StreamingActionParser();
  return parser.parse(text);
}
