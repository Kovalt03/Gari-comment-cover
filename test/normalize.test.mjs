// Normalization is easy to get quietly wrong, so every rule here is pinned to a
// concrete evasion or false positive seen on real comments.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
vm.runInThisContext(readFileSync(new URL('src/core/normalize.js', root), 'utf8'), {
  filename: 'src/core/normalize.js',
});
const { basic, match, squash, composeJamo, collapseRepeats } = Gari.normalize;

const TARGET = '시발';

test('basic composes decomposed input', () => {
  const decomposed = TARGET.normalize('NFD');
  assert.notEqual(decomposed, TARGET); // what a Mac input method can produce
  assert.equal(basic(decomposed), TARGET);
});

test('basic removes zero-width characters that NFKC leaves alone', () => {
  const hidden = '시​발';
  assert.equal(hidden.normalize('NFKC'), hidden);
  assert.equal(basic(hidden), TARGET);
});

test('basic tidies whitespace but keeps word gaps', () => {
  assert.equal(basic('  다시   발견했다\n'), '다시 발견했다');
});

test('match drops emoji wedged into a word', () => {
  assert.equal(match('시🔥발'), TARGET);
});

test('match recomposes spelled-out jamo', () => {
  assert.equal(match('ㅅㅣㅂㅏㄹ'), TARGET);
  assert.equal(match('ㅎㅏㄴㄱㅡㄹ'), '한글');
});

test('match leaves consonant-only slang alone', () => {
  assert.equal(match('ㅅㅂ'), 'ㅅㅂ'); // no vowel, so nothing to compose
  assert.equal(match('ㅋㅋㅋ'), 'ㅋㅋㅋ');
});

test('match unifies circled and halfwidth jamo with keyboard jamo', () => {
  // NFKC alone turns these into conjoining jamo, a different code point than ㅅ
  assert.notEqual('㉦'.normalize('NFKC'), 'ㅅ');
  assert.equal(match('㉦㉥'), 'ㅅㅂ');
  assert.equal(match('ﾵ'), 'ㅅ');
});

test('match folds fullwidth latin and case', () => {
  assert.equal(match('ｓｉＢＡＬ'), 'sibal');
});

test('match keeps spaces, so ordinary sentences do not collide', () => {
  for (const text of ['다시 발견했다', '역시 발로 뛰는 기자', '이번 시 발표 언제임']) {
    assert.ok(!match(text).includes(TARGET), text);
  }
});

test('squash removes the gaps, which is why it is only a hint', () => {
  assert.ok(squash('시.발').includes(TARGET));
  assert.ok(squash('시 발').includes(TARGET));
  // The same rule fires on innocent text. A squash hit must not cover a comment.
  assert.ok(squash('다시 발견했다').includes(TARGET));
});

test('emoji-only comments survive basic but empty out under match', () => {
  assert.equal(basic('🤡🤡'), '🤡🤡'); // kept for the dataset and for L2
  assert.equal(match('🤡🤡'), ''); // rules see nothing, so they must not assume text
});

test('composeJamo leaves text that is already syllables', () => {
  assert.equal(composeJamo('한글 입력'), '한글 입력');
});

test('collapseRepeats caps runs without touching short ones', () => {
  assert.equal(collapseRepeats('ㅋㅋㅋㅋㅋㅋ'), 'ㅋㅋㅋ');
  assert.equal(collapseRepeats('ㅋㅋ'), 'ㅋㅋ');
});
