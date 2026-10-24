import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types';
import { canCompose, HISTORY_IDLE, historyChunks, historyStatusOf, parsePrefs, unanalysedTails } from './flow';

const msg = (id: string, conv: string, day: number, analysed = false): ChatMessage => ({
  id,
  kind: 'msg',
  conversationId: conv,
  senderId: 'p-x',
  text: id,
  day,
  time: '1:00 PM',
  analysis: analysed ? ({ cues: [], score: 0, level: 0, stage: 'rapport', trace: [], latency: {} } as ChatMessage['analysis']) : undefined,
});
const dayRow = (conv: string, day: number): ChatMessage => ({ id: `day-${conv}-${day}`, kind: 'day', conversationId: conv, text: '', day, time: '' });

describe('history batches', () => {
  it('groups consecutive messages by chat and day, and stops at the checkpoint', () => {
    const ms = [dayRow('a', 1), msg('1', 'a', 1), msg('2', 'a', 1), dayRow('b', 1), msg('3', 'b', 1), msg('4', 'a', 1), msg('5', 'a', 2), msg('6', 'a', 2)];
    const chunks = historyChunks(ms, 5);
    expect(chunks.map((c) => c.ids)).toEqual([['1', '2'], ['3'], ['4'], ['5']]);
    expect(chunks.map((c) => c.lastId)).toEqual(['2', '3', '4', '5']);
  });

  it('marks a batch analysed only when every message in it is', () => {
    const chunks = historyChunks([msg('1', 'a', 1, true), msg('2', 'a', 1, false), msg('3', 'a', 2, true)], 3);
    expect(chunks.map((c) => c.analysed)).toEqual([false, true]);
  });

  it('reports honest status after a reload', () => {
    const half = [msg('1', 'a', 1, true), msg('2', 'a', 2, false)];
    expect(historyStatusOf('history', 2, half, 'inhouse')).toMatchObject({ status: 'idle', done: 1, total: 2 });
    expect(historyStatusOf('history', 2, half, 'gpt').status).toBe('messages_only');
    expect(historyStatusOf('history', 2, [msg('1', 'a', 1, true), msg('2', 'a', 2, true)], 'inhouse').status).toBe('complete');
    expect(historyStatusOf('fresh', null, half, 'inhouse')).toEqual(HISTORY_IDLE);
  });
});

describe('composer', () => {
  it('is never live in the Guided Demo or for scripted/preview cases', () => {
    expect(canCompose('A', 'history', HISTORY_IDLE)).toBe(false);
    expect(canCompose('B', 'scripted', HISTORY_IDLE)).toBe(false);
    expect(canCompose('C', 'preview', HISTORY_IDLE)).toBe(false);
    expect(canCompose('C', null, HISTORY_IDLE)).toBe(false);
  });
  it('is live for history and fresh cases, but not while history is being set up', () => {
    expect(canCompose('B', 'history', { ...HISTORY_IDLE, status: 'complete' })).toBe(true);
    expect(canCompose('C', 'fresh', HISTORY_IDLE)).toBe(true);
    expect(canCompose('B', 'history', { ...HISTORY_IDLE, status: 'analyzing' })).toBe(false);
    expect(canCompose('B', 'history', { ...HISTORY_IDLE, status: 'loading' })).toBe(false);
    expect(canCompose('B', 'history', { ...HISTORY_IDLE, status: 'failed' })).toBe(true);
  });
});

describe('unanalysed tails', () => {
  it('finds the newest unanalysed message per chat (e.g. a child reply after the last run)', () => {
    const ms = [msg('1', 'a', 1, true), msg('2', 'a', 1), msg('3', 'b', 1, true)];
    expect(unanalysedTails(ms)).toEqual([{ conversationId: 'a', lastId: '2' }]);
  });
});

describe('preferences', () => {
  it('accepts only known values and survives garbage', () => {
    expect(parsePrefs(JSON.stringify({ mode: 'C', backend: 'gpt', sound: false, speed: 2 }))).toEqual({ mode: 'C', backend: 'gpt', sound: false, speed: 2 });
    expect(parsePrefs(JSON.stringify({ mode: 'Z', backend: 'x', speed: 3 }))).toEqual({});
    expect(parsePrefs('{not json')).toEqual({});
    expect(parsePrefs(null)).toEqual({});
  });
});
