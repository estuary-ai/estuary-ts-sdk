import { describe, it, expect } from 'vitest';
import { StreamingActionParser, parseActions } from '../src/utils/action-parser';

describe('parseActions (one-shot)', () => {
  it('should parse a single action tag', () => {
    const { actions, cleanText } = parseActions(
      'Sure, I\'ll sit down now. <action name="sit" />'
    );
    expect(actions).toEqual([{ name: 'sit', params: {} }]);
    expect(cleanText).toBe("Sure, I'll sit down now.");
  });

  it('should parse action with parameters', () => {
    const { actions, cleanText } = parseActions(
      'Let me follow you! <action name="follow" target="player" speed="fast" />'
    );
    expect(actions).toEqual([
      { name: 'follow', params: { target: 'player', speed: 'fast' } },
    ]);
    expect(cleanText).toBe('Let me follow you!');
  });

  it('should parse multiple actions in one response', () => {
    const { actions, cleanText } = parseActions(
      'I\'ll wave and then sit! <action name="wave" /> <action name="sit" />'
    );
    expect(actions).toHaveLength(2);
    expect(actions[0].name).toBe('wave');
    expect(actions[1].name).toBe('sit');
    expect(cleanText).toBe("I'll wave and then sit!");
  });

  it('should return empty actions for text without tags', () => {
    const { actions, cleanText } = parseActions('Just a regular message');
    expect(actions).toEqual([]);
    expect(cleanText).toBe('Just a regular message');
  });

  it('should handle action tag with single-quoted attributes', () => {
    const { actions } = parseActions("<action name='look_at' target='camera' />");
    expect(actions).toEqual([{ name: 'look_at', params: { target: 'camera' } }]);
  });

  it('should skip tags without a name attribute', () => {
    const { actions } = parseActions('<action target="player" />');
    expect(actions).toEqual([]);
  });

  it('should handle action tag mid-sentence', () => {
    const { actions, cleanText } = parseActions(
      'I see something interesting <action name="follow_user" /> over there!'
    );
    expect(actions).toEqual([{ name: 'follow_user', params: {} }]);
    expect(cleanText).toBe('I see something interesting over there!');
  });
});

describe('StreamingActionParser', () => {
  it('should emit actions incrementally as text accumulates', () => {
    const parser = new StreamingActionParser();

    // First chunk: no action yet
    const r1 = parser.parse('Sure, I\'ll sit down');
    expect(r1.actions).toEqual([]);

    // Second chunk: action tag completes
    const r2 = parser.parse('Sure, I\'ll sit down now. <action name="sit" />');
    expect(r2.actions).toEqual([{ name: 'sit', params: {} }]);
    expect(r2.cleanText).toBe("Sure, I'll sit down now.");

    // Third chunk: same text, no new actions
    const r3 = parser.parse('Sure, I\'ll sit down now. <action name="sit" /> More text.');
    expect(r3.actions).toEqual([]);
    expect(r3.cleanText).toBe("Sure, I'll sit down now. More text.");
  });

  it('should emit second action only when it completes', () => {
    const parser = new StreamingActionParser();

    const r1 = parser.parse('Hello <action name="wave" /> let me');
    expect(r1.actions).toHaveLength(1);
    expect(r1.actions[0].name).toBe('wave');

    // Partial second action — not yet complete
    const r2 = parser.parse('Hello <action name="wave" /> let me <action name="fol');
    expect(r2.actions).toEqual([]);

    // Second action completes
    const r3 = parser.parse(
      'Hello <action name="wave" /> let me <action name="follow" target="player" />'
    );
    expect(r3.actions).toHaveLength(1);
    expect(r3.actions[0].name).toBe('follow');
    expect(r3.actions[0].params).toEqual({ target: 'player' });
  });

  it('should reset state', () => {
    const parser = new StreamingActionParser();

    parser.parse('Text <action name="sit" />');
    parser.reset();

    // After reset, same action should be emitted again
    const r = parser.parse('Text <action name="sit" />');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].name).toBe('sit');
  });
});
