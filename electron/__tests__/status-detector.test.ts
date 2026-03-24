import { describe, it, expect } from 'vitest';
import { stripAnsi, detectPromptType } from '../status-detector';

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m')).toBe('hello');
  });
  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });
  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('detectPromptType', () => {
  it('detects input prompt', () => {
    expect(detectPromptType('some output\n> ')).toBe('input');
  });
  it('detects approval prompt with Allow keyword', () => {
    expect(detectPromptType('Do you want to allow this? (y/n)')).toBe('approval');
  });
  it('detects approval prompt with Yes/No', () => {
    expect(detectPromptType('Allow Bash tool? Yes / No')).toBe('approval');
  });
  it('returns null for regular output', () => {
    expect(detectPromptType('compiling files...')).toBeNull();
  });
});
