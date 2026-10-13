import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadThenOpenProject } from './project-upload-flow.mjs';

test('successful upload is remembered before the editor opens', async () => {
  const project = { _id: 'room-1' };
  const events = [];
  const result = await uploadThenOpenProject(
    async () => { events.push('upload'); return project; },
    (saved) => events.push(saved === project ? 'remember' : 'wrong-project'),
    async (saved) => { events.push(saved === project ? 'open' : 'wrong-project'); return true; }
  );
  assert.deepEqual(events, ['upload', 'remember', 'open']);
  assert.deepEqual(result, { project, opened: true, openError: null });
});

test('image-open failure retains the uploaded project and does not upload again', async () => {
  const project = { _id: 'room-1' };
  const error = { status: 410 };
  let uploadCalls = 0;
  const remembered = [];
  const result = await uploadThenOpenProject(
    async () => { uploadCalls++; return project; },
    (saved) => remembered.push(saved),
    async () => { throw error; }
  );
  assert.deepEqual(result, { project, opened: false, openError: error });
  assert.deepEqual(remembered, [project]);
  assert.equal(uploadCalls, 1);
});

test('upload failure does not claim success, remember a project, or try to open it', async () => {
  const error = { status: 502 };
  let rememberCalls = 0;
  let openCalls = 0;
  await assert.rejects(uploadThenOpenProject(
    async () => { throw error; },
    () => { rememberCalls++; },
    async () => { openCalls++; }
  ), (actual) => actual === error);
  assert.equal(rememberCalls, 0);
  assert.equal(openCalls, 0);
});

test('a handled 410 keeps the project and reports that opening did not finish', async () => {
  const project = { _id: 'room-1' };
  const result = await uploadThenOpenProject(async () => project, () => {}, async () => false);
  assert.deepEqual(result, { project, opened: false, openError: null });
});
