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
  const hidden = '\uc2dc\u200b\ubc1c';
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

test('basic removes variation selectors, which are invisible too', () => {
  assert.equal(basic('\uc2dc\ufe0e\ubc1c'), TARGET);
  assert.equal(basic('\uc2dc\ufe00\ubc1c'), TARGET);
});

test('match drops combining marks, basic keeps them', () => {
  const accented = '\uc2dc\u0301\ubc1c';
  assert.equal(basic(accented), accented); // the dataset keeps the text as written
  assert.equal(match(accented), TARGET);
});

/* Where normalization stops. Geometric and math symbols are not pictographs, so
 * match leaves them and only squash, the hint level, sees through them. */
test('symbols that are not pictographs survive match', () => {
  assert.equal(match('\uc2dc\u25cf\ubc1c'), '\uc2dc\u25cf\ubc1c');
  assert.ok(squash('\uc2dc\u25cf\ubc1c').includes(TARGET));
});

test('shaped lookalikes are left to the model layer', () => {
  for (const text of ['\uc2dc1\ubc1c', '\u3145l\ubc1c', '\uc2dc\uc774\ubc1c']) {
    assert.ok(!squash(text).includes(TARGET), text);
  }
});

test('emoji-only comments survive basic but empty out under match', () => {
  assert.equal(basic('🤡🤡'), '🤡🤡'); // kept for the dataset and for L2
  assert.equal(match('🤡🤡'), ''); // rules see nothing, so they must not assume text
});

/* Jamo recomposition is the only Korean-specific step. Everything else is
 * script-neutral, so the same folding has to hold for English. */

test('fullwidth, mathematical and circled latin fold to plain letters', () => {
  assert.equal(match('\uff24\uff21\uff2d\uff2e'), 'damn');
  assert.equal(match('\u{1d41d}\u{1d41a}\u{1d426}\u{1d427}'), 'damn');
  assert.equal(match('\u24d3\u24d0\u24dc\u24dd'), 'damn');
});

test('accents fold away, which is how English evasion is usually written', () => {
  assert.equal(match('d\u00e1mn'), 'damn'); // precomposed
  assert.equal(match('da\u0301mn'), 'damn'); // combining
});

test('ligatures decompose', () => {
  assert.equal(match('\ufb01sh'), 'fish');
});

test('English lookalikes are left to the model layer as well', () => {
  assert.notEqual(squash('d0nut'), 'donut'); // zero for o
  assert.notEqual(squash('d\u0430mn'), 'damn'); // Cyrillic a
  assert.notEqual(squash('d\u03bfnut'), 'donut'); // Greek omicron
  assert.notEqual(squash('daaamn'), 'damn'); // stretched
});

test('a masked letter cannot be recovered at all', () => {
  assert.equal(squash('d*mn'), 'dmn'); // nothing says what the star replaced
});

/* The English half of the 시발점 problem, known as the Scunthorpe problem.
 * Substring matching cannot tell these apart in either language, which is why a
 * rule hit is a hint rather than a verdict. */
test('innocent words contain banned substrings', () => {
  assert.ok(match('classic').includes('ass'));
  assert.ok(match('Scunthorpe').includes('cunt'));
});

test('composeJamo leaves text that is already syllables', () => {
  assert.equal(composeJamo('한글 입력'), '한글 입력');
});

test('collapseRepeats caps runs without touching short ones', () => {
  assert.equal(collapseRepeats('ㅋㅋㅋㅋㅋㅋ'), 'ㅋㅋㅋ');
  assert.equal(collapseRepeats('ㅋㅋ'), 'ㅋㅋ');
});
