import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTES_PREVIEW_CONTENT_EDITABLE,
  resolveStartupWorkspace,
} from '../utils/uiBehavior';

test('la app respeta el workspace persistido al arrancar', () => {
  assert.equal(resolveStartupWorkspace('chat'), 'chat');
  assert.equal(resolveStartupWorkspace('notes'), 'notes');
  assert.equal(resolveStartupWorkspace('agents'), 'agents');
  assert.equal(resolveStartupWorkspace(undefined), 'chat');
  assert.equal(resolveStartupWorkspace('invalid'), 'chat');
});

test('la vista preview de notas no es editable', () => {
  assert.equal(NOTES_PREVIEW_CONTENT_EDITABLE, false);
});
