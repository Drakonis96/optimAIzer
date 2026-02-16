import assert from 'node:assert/strict';
import test from 'node:test';

import { redactSensitive, safeErrorMessage } from '../server/src/security/redact';

test('redactSensitive elimina secretos en headers y query params', () => {
  const openAiLike = `sk-${'proj-abc123456789XYZ00000000'}`;
  const googleLike = `AIza${'ABCDEFGHIJKLMNOPQRSTUVWX'}`;
  const raw =
    `Authorization: Bearer ${openAiLike}?api_key=${googleLike}&token=abc1234567890`;

  const redacted = redactSensitive(raw);

  assert.equal(redacted.includes(openAiLike), false);
  assert.equal(redacted.includes(googleLike), false);
  assert.equal(redacted.includes('token=abc1234567890'), false);
  assert.ok(redacted.includes('[REDACTED]'));
});

test('safeErrorMessage redacted, con longitud limitada y fallback seguro', () => {
  const secret = `sk-${'ant-supersecrettoken123456789'}`;
  const veryLong = `${secret} ${'x'.repeat(650)}`;
  const error = new Error(veryLong);

  const message = safeErrorMessage(error, 'fallback');

  assert.equal(message.includes(secret), false);
  assert.ok(message.includes('[REDACTED]'));
  assert.ok(message.length <= 600);
  assert.equal(safeErrorMessage('   ', 'fallback'), 'fallback');
});
