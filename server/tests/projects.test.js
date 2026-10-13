import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import Project from '../src/models/Project.js';
import { createProjectsRouter } from '../src/routes/projects.js';

const ownerId = 'owner-a';
const otherOwnerId = 'owner-b';
const validPng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function makeHarness(options = {}) {
  const calls = { uploadOptions: null, uploadBuffer: null, destroy: [], privateUrl: [], create: [], findOne: [], logs: [] };
  const assetResponse = options.uploadResponse ?? { public_id: 'smart-wall-visualizer/room-from-cloudinary', asset_id: 'asset-123' };
  const project = options.project === undefined ? {
    _id: 'project-a', owner: ownerId, title: 'Living room',
    cloudinaryPublicId: 'smart-wall-visualizer/room-saved', mimeType: 'image/png', trials: [],
    async deleteOne() { if (options.deleteError) throw options.deleteError; this.deleted = true; }
  } : options.project;

  const cloudinaryClient = {
    uploader: {
      upload_stream(uploadOptions, callback) {
        calls.uploadOptions = uploadOptions;
        return { end(buffer) {
          calls.uploadBuffer = Buffer.from(buffer);
          queueMicrotask(() => options.uploadError ? callback(options.uploadError) : callback(null, assetResponse));
          return this;
        } };
      },
      async destroy(publicId, params) {
        calls.destroy.push({ publicId, params });
        if (options.destroyError) throw options.destroyError;
        return options.destroyResult ?? { result: 'ok' };
      }
    },
    utils: {
      private_download_url(publicId, format, params) {
        calls.privateUrl.push({ publicId, format, params });
        if (!publicId) throw new Error('Missing required parameter - public_id');
        return 'https://cloudinary.test/private-image';
      }
    }
  };

  const queryForProject = (query) => {
    calls.findOne.push(query);
    const found = project && String(project._id) === String(query._id)
      && (!query.owner || String(project.owner) === String(query.owner)) ? project : null;
    return {
      select: async () => found,
      then(resolve, reject) { return Promise.resolve(found).then(resolve, reject); }
    };
  };
  const ProjectModel = {
    async create(document) {
      calls.create.push(document);
      if (options.createError) throw options.createError;
      return { _id: 'project-created', ...document, trials: [] };
    },
    findOne: queryForProject,
    find() { return { sort: async () => [] }; },
    async findOneAndUpdate() { return null; }
  };
  const ColorModel = { find: () => ({ select: async () => [] }) };
  const authenticateUser = (req, _res, next) => { req.user = { _id: options.userId || ownerId, role: options.role || 'user' }; next(); };
  const logger = {
    warn: (message) => calls.logs.push({ level: 'warn', message }),
    error: (message) => calls.logs.push({ level: 'error', message })
  };
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectsRouter({
    ProjectModel,
    ColorModel,
    cloudinaryClient,
    authenticateUser,
    uploadRateLimit: (_req, _res, next) => next(),
    fetchImage: options.fetchImage || (async () => new Response(Buffer.from([1, 2, 3]), { status: 200 })),
    logger
  }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message || 'test error' }));

  return { app, calls, project };
}

async function withServer(t, options = {}) {
  const harness = makeHarness(options);
  const server = createServer(harness.app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  return { ...harness, baseUrl: `http://127.0.0.1:${address.port}/api/projects` };
}

async function uploadRoom(baseUrl) {
  const form = new FormData();
  form.set('ownershipConfirmed', 'true');
  form.set('title', 'Bedroom');
  form.set('photo', new Blob([validPng], { type: 'image/png' }), 'bedroom.png');
  return fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
}

test('upload persists the actual Cloudinary public_id and project metadata', async (t) => {
  const { baseUrl, calls } = await withServer(t);
  const response = await uploadRoom(baseUrl);
  const project = await response.json();
  assert.equal(response.status, 201);
  assert.equal(project.cloudinaryPublicId, 'smart-wall-visualizer/room-from-cloudinary');
  assert.equal(project.owner, ownerId);
  assert.equal(project.title, 'Bedroom');
  assert.equal(project.mimeType, 'image/png');
  assert.equal(calls.uploadOptions.type, 'authenticated');
  assert.equal(calls.create[0].cloudinaryPublicId, project.cloudinaryPublicId);
  assert.match(calls.uploadOptions.public_id, /^smart-wall-visualizer\/room-[0-9a-f-]{36}$/);
  assert.notEqual(calls.create[0].cloudinaryPublicId, 'asset-123');
  assert.deepEqual(calls.uploadBuffer, validPng);
});

test('Cloudinary upload failure does not create a project', async (t) => {
  const { baseUrl, calls } = await withServer(t, { uploadError: new Error('Cloudinary unavailable') });
  const response = await uploadRoom(baseUrl);
  assert.equal(response.status, 502);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.destroy.length, 0);
});

test('successful upload response without public_id is rejected and never persisted', async (t) => {
  const { baseUrl, calls } = await withServer(t, { uploadResponse: { asset_id: 'asset-without-public-id' } });
  const response = await uploadRoom(baseUrl);
  assert.equal(response.status, 502);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.destroy.length, 0);
});

test('project creation failure after upload cleans up the exact returned asset id', async (t) => {
  const { baseUrl, calls } = await withServer(t, { createError: new Error('Mongo unavailable') });
  const response = await uploadRoom(baseUrl);
  assert.equal(response.status, 500);
  assert.equal(calls.destroy.length, 1);
  assert.equal(calls.destroy[0].publicId, 'smart-wall-visualizer/room-from-cloudinary');
  assert.equal(calls.destroy[0].params.type, 'authenticated');
});

test('image retrieval signs and streams the stored Cloudinary public_id with its image type', async (t) => {
  const { baseUrl, calls } = await withServer(t, {
    fetchImage: async (url) => {
      assert.equal(url, 'https://cloudinary.test/private-image');
      return new Response(Buffer.from([9, 8, 7]), { status: 200 });
    }
  });
  const response = await fetch(`${baseUrl}/project-a/image`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([9, 8, 7]));
  assert.equal(calls.privateUrl[0].publicId, 'smart-wall-visualizer/room-saved');
  assert.equal(calls.privateUrl[0].format, 'png');
  assert.deepEqual(calls.findOne[0], { _id: 'project-a', owner: ownerId });
});

test('image retrieval for a legacy project without public_id is explicit and never contacts Cloudinary', async (t) => {
  const legacyProject = { _id: 'project-a', owner: ownerId, cloudinaryPublicId: '', mimeType: 'image/jpeg' };
  const { baseUrl, calls } = await withServer(t, { project: legacyProject });
  const response = await fetch(`${baseUrl}/project-a/image`);
  assert.equal(response.status, 410);
  assert.equal(calls.privateUrl.length, 0);
});

test('image retrieval enforces project ownership', async (t) => {
  const { baseUrl, calls, project } = await withServer(t, { userId: otherOwnerId });
  const response = await fetch(`${baseUrl}/project-a/image`);
  assert.equal(response.status, 404);
  assert.equal(project.deleted, undefined);
  assert.equal(calls.privateUrl.length, 0);
});

test('deletion removes the stored asset id before deleting the owned project', async (t) => {
  const { baseUrl, calls, project } = await withServer(t);
  const response = await fetch(`${baseUrl}/project-a`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, imageDeleted: true });
  assert.equal(calls.destroy[0].publicId, 'smart-wall-visualizer/room-saved');
  assert.equal(project.deleted, true);
});

test('deleting an asset already missing from Cloudinary is idempotent', async (t) => {
  const { baseUrl, calls, project } = await withServer(t, { destroyResult: { result: 'not found' } });
  const response = await fetch(`${baseUrl}/project-a`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, imageDeleted: false });
  assert.equal(calls.destroy[0].publicId, project.cloudinaryPublicId);
  assert.equal(project.deleted, true);
});

test('Cloudinary deletion failure preserves the project and returns an error', async (t) => {
  const { baseUrl, calls, project } = await withServer(t, { destroyError: new Error('Cloudinary unavailable') });
  const response = await fetch(`${baseUrl}/project-a`, { method: 'DELETE' });
  assert.equal(response.status, 502);
  assert.equal(project.deleted, undefined);
  assert.equal(calls.destroy.length, 1);
});

test('legacy project deletion skips Cloudinary and reports the missing image reference', async (t) => {
  const project = { _id: 'project-a', owner: ownerId, cloudinaryPublicId: null, async deleteOne() { this.deleted = true; } };
  const { baseUrl, calls } = await withServer(t, { project });
  const response = await fetch(`${baseUrl}/project-a`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    imageDeleted: false,
    warning: 'This project had no stored image reference, so no Cloudinary image was deleted.'
  });
  assert.equal(calls.destroy.length, 0);
  assert.equal(project.deleted, true);
});

test('attempting to delete another user’s project does not delete its Cloudinary asset', async (t) => {
  const { baseUrl, calls, project } = await withServer(t, { userId: otherOwnerId });
  const response = await fetch(`${baseUrl}/project-a`, { method: 'DELETE' });
  assert.equal(response.status, 404);
  assert.equal(calls.destroy.length, 0);
  assert.equal(project.deleted, undefined);
});

test('Mongoose project schema requires a non-empty Cloudinary public_id', async () => {
  const projectWithoutId = new Project({ owner: new mongoose.Types.ObjectId(), title: 'Legacy room', mimeType: 'image/jpeg' });
  await assert.rejects(projectWithoutId.validate(), (error) => error.errors.cloudinaryPublicId?.kind === 'required');
  const projectWithId = new Project({
    owner: new mongoose.Types.ObjectId(), title: 'New room', mimeType: 'image/jpeg',
    cloudinaryPublicId: 'smart-wall-visualizer/room-123'
  });
  await assert.doesNotReject(projectWithId.validate());
});
