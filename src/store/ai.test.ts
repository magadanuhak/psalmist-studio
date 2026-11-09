import { describe, expect, it } from 'vitest';
import { AiError } from '../ai';
import { aiMessage } from './ai';
import { t } from '../i18n/ro';

describe('AI error messages (Romanian, graceful)', () => {
  it('offline tells how to start the service', () => {
    expect(aiMessage(new AiError('offline', 'x'))).toBe(t.ai.offlineHint);
    expect(t.ai.chipOffline).toContain('start-ai.cmd');
  });
  it('known codes map to their own message, unknown errors to the generic one', () => {
    expect(aiMessage(new AiError('not_ready', 'x'))).toBe(t.ai.loading);
    expect(aiMessage(new AiError('aborted', 'x'))).toBe(t.ai.aborted);
    expect(aiMessage(new AiError('timeout', 'x'))).toBe(t.ai.timeout);
    expect(aiMessage(new Error('boom'))).toBe(t.ai.failed);
    expect(aiMessage(new AiError('bad_request', 'audio gol'))).toContain('audio gol');
  });
});
