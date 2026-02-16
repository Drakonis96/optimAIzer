import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const readSource = (filePath: string): string =>
  fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf8');

test('App fuerza inicio en chat al cargar estado persistido', () => {
  const appSource = readSource('App.tsx');
  assert.match(
    appSource,
    /setActiveWorkspace\(resolveStartupWorkspace\(state\.activeWorkspace\)\);/
  );
});

test('NotesWorkspace mantiene preview no editable y sin escritura directa', () => {
  const notesSource = readSource('components/NotesWorkspace.tsx');
  assert.match(notesSource, /contentEditable=\{NOTES_PREVIEW_CONTENT_EDITABLE\}/);
  assert.equal(notesSource.includes('onInput='), false);
});
