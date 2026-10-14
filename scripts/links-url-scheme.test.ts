// Unit assertions for schemeless-URL handling in Links bookmarks.
// Bare domains pasted by users ("www.google.com") default to https via
// ensureHttpScheme; isValidHttpUrl still rejects non-http(s) schemes
// (including `javascript:`) and empty hosts. Run:
//   npx tsx --test scripts/links-url-scheme.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureHttpScheme,
  isValidHttpUrl,
  normalizeUrl,
} from '../src/linkding/normalize';

test('ensureHttpScheme defaults bare domains to https', () => {
  assert.equal(ensureHttpScheme('www.google.com'), 'https://www.google.com');
  assert.equal(ensureHttpScheme('  example.com/path  '), 'https://example.com/path');
  assert.equal(ensureHttpScheme(''), '');
  assert.equal(ensureHttpScheme('   '), '');
});

test('ensureHttpScheme leaves schemed input untouched', () => {
  assert.equal(ensureHttpScheme('https://example.com'), 'https://example.com');
  assert.equal(ensureHttpScheme('http://example.com'), 'http://example.com');
  assert.equal(ensureHttpScheme('javascript:alert(1)'), 'javascript:alert(1)');
  assert.equal(ensureHttpScheme('ftp://example.com'), 'ftp://example.com');
});

test('isValidHttpUrl accepts https defaulted bare domains', () => {
  assert.equal(isValidHttpUrl(ensureHttpScheme('www.google.com')), true);
  assert.equal(isValidHttpUrl('https://example.com/a?b=c'), true);
});

test('isValidHttpUrl still rejects dangerous and malformed input', () => {
  assert.equal(isValidHttpUrl(ensureHttpScheme('javascript:alert(1)')), false);
  assert.equal(isValidHttpUrl(ensureHttpScheme('ftp://example.com')), false);
  assert.equal(isValidHttpUrl(''), false);
  assert.equal(isValidHttpUrl(ensureHttpScheme('/relative/path')), false);
  // Legacy parity: schemed input keeps its old verdict, even with an odd
  // but parseable host ('http:///no-host' normalizes to http://no-host/).
  assert.equal(isValidHttpUrl('http:///no-host'), true);
});

test('bare domain end-to-end: ensured, valid, and canonically normalized', () => {
  const ensured = ensureHttpScheme('www.google.com');
  assert.equal(isValidHttpUrl(ensured), true);
  assert.equal(normalizeUrl(ensured), 'https://www.google.com');
});
