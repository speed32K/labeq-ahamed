import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHighlightSegments } from './highlight';

test('splitHighlightSegments returns unhighlighted text when query is empty or whitespace', () => {
  assert.deepEqual(splitHighlightSegments('AEPS WITHDRAWAL', ''), [
    { text: 'AEPS WITHDRAWAL', match: false },
  ]);
  assert.deepEqual(splitHighlightSegments('AEPS WITHDRAWAL', '   '), [
    { text: 'AEPS WITHDRAWAL', match: false },
  ]);
  assert.deepEqual(splitHighlightSegments('', 'aeps'), []);
});

test('splitHighlightSegments matches case-insensitively and preserves original casing', () => {
  assert.deepEqual(splitHighlightSegments('AEPS WITHDRAWAL', 'aeps'), [
    { text: 'AEPS', match: true },
    { text: ' WITHDRAWAL', match: false },
  ]);

  assert.deepEqual(splitHighlightSegments('Shafeek', 'e'), [
    { text: 'Shaf', match: false },
    { text: 'e', match: true },
    { text: 'e', match: true },
    { text: 'k', match: false },
  ]);

  assert.deepEqual(splitHighlightSegments('ONLINE', 'onl'), [
    { text: 'ONL', match: true },
    { text: 'INE', match: false },
  ]);
});

test('splitHighlightSegments safely escapes regex metacharacters and handles non-matches', () => {
  assert.deepEqual(splitHighlightSegments('Counter walk-in (3x60)', '(3x60)'), [
    { text: 'Counter walk-in ', match: false },
    { text: '(3x60)', match: true },
  ]);

  assert.deepEqual(splitHighlightSegments('MOBILE RECHARGE', 'cash'), [
    { text: 'MOBILE RECHARGE', match: false },
  ]);
});
