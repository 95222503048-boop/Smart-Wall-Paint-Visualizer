import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Project from '../models/Project.js';
import Color from '../models/Color.js';
import { authenticate } from '../middleware.js';
import { rateLimit } from '../rate-limit.js';
import cloudinary from '../cloudinary.js';
import { safeDiagnosticMessage } from '../diagnostics.js';

const limit = Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limit, files: 1 } });
const uploadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: Number(process.env.UPLOADS_PER_HOUR || 10), message: 'Upload limit reached. Please try again later.' });

const hasCloudinaryPublicId = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const isCloudinaryNotFound = (error) => error?.http_code === 404 || error?.statusCode === 404 || error?.error?.http_code === 404;

async function removeCloudinaryAsset(cloudinaryClient, publicId) {
  if (!hasCloudinaryPublicId(publicId)) return { status: 'missing-id' };
  let result;
  try { result = await cloudinaryClient.uploader.destroy(publicId, { resource_type: 'image', type: 'authenticated', invalidate: true }); }
  catch (error) { if (isCloudinaryNotFound(error)) return { status: 'already-missing' }; throw error; }
  if (result?.result === 'ok') return { status: 'deleted' };
  if (result?.result === 'not found') return { status: 'already-missing' };
  throw new Error('Cloudinary did not confirm image deletion.');
}

function uploadToCloudinary(cloudinaryClient, buffer, publicId) {
  return new Promise((resolve, reject) => {
    cloudinaryClient.uploader.upload_stream({
      resource_type: 'image',
      type: 'authenticated',
      public_id: `smart-wall-visualizer/${publicId}`,
      overwrite: false,
      use_filename: false,
      unique_filename: false,
    }, (error, result) => error ? reject(error) : resolve(result)).end(buffer);
  });
}

export function createProjectsRouter({
  ProjectModel = Project,
  ColorModel = Color,
  cloudinaryClient = cloudinary,
  authenticateUser = authenticate,
  uploadRateLimit = uploadLimiter,
  fetchImage = globalThis.fetch,
  logger = console
} = {}) {
  const router = Router();

function validImage(buffer, mimetype) {
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return false;
}

function validMask(mask) {
  if (!mask || typeof mask !== 'object' || Array.isArray(mask)) return false;
  const point = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const brush = mask.brush ?? [], polygons = mask.polygons ?? [];
  if (!Array.isArray(brush) || brush.length > 300 || !Array.isArray(polygons) || polygons.length > 300) return false;
  if (brush.some((stroke) => !stroke || !Number.isFinite(stroke.size) || stroke.size <= 0 || stroke.size > 1 || !Array.isArray(stroke.points) || stroke.points.length > 20000 || stroke.points.some((p) => !point(p)))) return false;
  if (polygons.some((poly) => !Array.isArray(poly) || poly.length > 10000 || poly.some((p) => !point(p)))) return false;
  if (mask.regions && (!Array.isArray(mask.regions) || mask.regions.length > 5000 || mask.regions.some((p) => !point(p)))) return false;
  if (mask.ai && (!Number.isInteger(mask.ai.width) || !Number.isInteger(mask.ai.height) || mask.ai.width < 1 || mask.ai.height < 1 || mask.ai.width * mask.ai.height > 4_000_000 || typeof mask.ai.bits !== 'string' || mask.ai.bits.length > 1_500_000)) return false;
  return true;
}
function validAppearance(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Number.isFinite(value.lighting) && value.lighting >= 0.5 && value.lighting <= 1.5
    && Number.isFinite(value.calibration) && value.calibration >= 0.5 && value.calibration <= 1.5
    && ['matte', 'eggshell', 'satin', 'gloss'].includes(value.finish)
    && ['solid', 'stripes', 'checks'].includes(value.pattern)
    && typeof value.dualTone === 'boolean'
    && Number.isFinite(value.split) && value.split >= 0 && value.split <= 1
    && /^#[0-9A-Fa-f]{6}$/.test(value.secondColor || '');
}

router.get('/', authenticateUser, async (req, res, next) => {
  try { res.json(await ProjectModel.find({ owner: req.user._id }).sort({ updatedAt: -1 })); } catch (err) { next(err); }
});

router.get('/:id/image', authenticateUser, async (req, res, next) => {
  try {
    const query = req.user.role === 'admin'
      ? { _id: req.params.id }
      : { _id: req.params.id, owner: req.user._id };
    const project = await ProjectModel.findOne(query).select('cloudinaryPublicId mimeType');
    if (!project) return res.status(404).json({ message: 'Room photo not found.' });
    if (!hasCloudinaryPublicId(project.cloudinaryPublicId)) {
      logger.warn(`Room photo unavailable: project ${project._id} has no Cloudinary public_id.`);
      return res.status(410).json({ message: 'This older room project has no stored image reference. Re-upload the room photo to continue editing.' });
    }
    const signedUrl = cloudinaryClient.utils.private_download_url(project.cloudinaryPublicId, project.mimeType === 'image/png' ? 'png' : 'jpg', {
      type: 'authenticated',
      expires_at: Math.floor(Date.now() / 1000) + 300
    });
    const image = await fetchImage(signedUrl, { signal: AbortSignal.timeout(20_000) });
    if (image.status === 404 || image.status === 410) {
      logger.warn(`Room photo unavailable: Cloudinary has no asset ${project.cloudinaryPublicId} for project ${project._id}.`);
      return res.status(410).json({ message: 'This room photo is no longer in image storage. Re-upload the original photo to continue editing.' });
    }
    if (!image.ok || !image.body) return res.status(502).json({ message: 'The room photo could not be loaded from image storage.' });
    res.type(project.mimeType);
    try { await pipeline(Readable.fromWeb(image.body), res); }
    catch (err) { if (!res.headersSent) next(err); else res.destroy(err); }
  } catch (err) {
    if (isCloudinaryNotFound(err)) return res.status(410).json({ message: 'This room photo is no longer in image storage. Re-upload the original photo to continue editing.' });
    next(err);
  }
});

router.post('/upload', authenticateUser, uploadRateLimit, upload.single('photo'), async (req, res, next) => {
  let cloudinaryPublicId;
  try {
    if (req.body?.ownershipConfirmed !== 'true') return res.status(400).json({ message: 'Confirm that you own this room photo before uploading.' });
    if (!req.file || !validImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ message: 'Upload a valid JPG or PNG image.' });
    let uploadedAsset;
    try {
      uploadedAsset = await uploadToCloudinary(cloudinaryClient, req.file.buffer, `room-${randomUUID()}`);
    } catch (err) {
      logger.error(JSON.stringify({ event: 'cloudinary_upload_failed', requestId: req.requestId || null, message: safeDiagnosticMessage(err.message || 'Cloudinary upload failed') }));
      return res.status(502).json({ message: 'The image could not be uploaded to image storage. Please try again.' });
    }
    if (!hasCloudinaryPublicId(uploadedAsset?.public_id)) {
      logger.error(JSON.stringify({ event: 'cloudinary_upload_missing_public_id', requestId: req.requestId || null, assetId: safeDiagnosticMessage(uploadedAsset?.asset_id || 'unavailable') }));
      return res.status(502).json({ message: 'Image storage did not return a valid image identifier, so the room was not saved. Please try again.' });
    }
    cloudinaryPublicId = uploadedAsset.public_id;
    let project;
    try {
      project = await ProjectModel.create({
        owner: req.user._id,
        title: (typeof req.body.title === 'string' ? req.body.title : req.file.originalname.replace(/\.[^.]+$/, '')).slice(0, 120),
        cloudinaryPublicId,
        mimeType: req.file.mimetype,
        width: Number(req.body.width) || undefined,
        height: Number(req.body.height) || undefined,
        trials: []
      });
    } catch (err) {
      try { await removeCloudinaryAsset(cloudinaryClient, cloudinaryPublicId); }
      catch (cleanupError) { logger.error(`Could not roll back Cloudinary asset ${cloudinaryPublicId} after project creation failed: ${cleanupError.message || 'unknown error'}`); }
      throw err;
    }
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', authenticateUser, async (req, res, next) => {
  try {
    const project = await ProjectModel.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    res.json(project);
  } catch (err) { next(err); }
});

router.patch('/:id', authenticateUser, async (req, res, next) => {
  try {
    const allowed = {};
    if (typeof req.body.title === 'string') allowed.title = req.body.title.slice(0, 120);
    const project = await ProjectModel.findOneAndUpdate({ _id: req.params.id, owner: req.user._id }, { ...allowed, updatedAt: new Date() }, { new: true, runValidators: true });
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    res.json(project);
  } catch (err) { next(err); }
});

router.put('/:id/trials/:trialId', authenticateUser, async (req, res, next) => {
  try {
    const { name, colorId, colorHex, opacity, mask, appearance, layers, activeLayerId } = req.body || {};
    if (typeof name !== 'string' || name.length > 120 || !/^#[0-9A-Fa-f]{6}$/.test(colorHex || '') || !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || !validMask(mask) || !validAppearance(appearance)) {
      return res.status(400).json({ message: 'Provide a valid color, opacity, and wall mask.' });
    }
    if (layers !== undefined && (!Array.isArray(layers) || layers.length < 1 || layers.length > 12 || layers.some((layer) => !layer || typeof layer.id !== 'string' || layer.id.length > 80 || typeof layer.name !== 'string' || layer.name.length > 80 || !/^#[0-9A-Fa-f]{6}$/.test(layer.colorHex || '') || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !validMask(layer.mask) || !validAppearance(layer.appearance)))) {
      return res.status(400).json({ message: 'Provide up to 12 valid, separately coloured wall areas.' });
    }
    if (layers !== undefined && activeLayerId && !layers.some((layer) => layer.id === activeLayerId)) {
      return res.status(400).json({ message: 'The active wall area must exist in the saved trial.' });
    }
    const project = await ProjectModel.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    if (!hasCloudinaryPublicId(project.cloudinaryPublicId)) return res.status(409).json({ message: 'This older project has no recoverable image reference. Re-upload the original room photo before saving edits.' });
    const requestedLayers = layers?.length ? layers : [{ colorId, colorHex, appearance }];
    const colorIds = [...new Set([...requestedLayers.flatMap((layer) => [layer.colorId, layer.appearance?.secondColorId]), colorId].map((id) => String(id || '')).filter(Boolean))];
    const palette = colorIds.length ? await ColorModel.find({ _id: { $in: colorIds }, active: true }).select('_id hex') : [];
    const validPaletteColor = (id, hex) => palette.some((color) => String(color._id) === String(id) && color.hex.toLowerCase() === String(hex).toLowerCase());
    if (!validPaletteColor(colorId, colorHex)) return res.status(403).json({ message: 'Choose a colour available in your palette before saving this design.' });
    if (requestedLayers.some((layer) => !validPaletteColor(layer.colorId, layer.colorHex))) return res.status(403).json({ message: 'Choose a colour available in your palette before saving this design.' });
    if (requestedLayers.some((layer) => layer.appearance?.dualTone && !validPaletteColor(layer.appearance.secondColorId, layer.appearance.secondColor))) return res.status(403).json({ message: 'Choose a second wall colour available in your palette.' });
    let trial = project.trials.id(req.params.trialId);
    if (!trial) {
      trial = project.trials.create({ _id: req.params.trialId, name, colorId, colorHex, opacity, mask, appearance, ...(layers === undefined ? {} : { layers, activeLayerId }) });
      project.trials.push(trial);
    } else Object.assign(trial, { name, colorId, colorHex, opacity, mask, appearance, ...(layers === undefined ? {} : { layers, activeLayerId }) });
    project.updatedAt = new Date();
    await project.save();
    res.json(project);
  } catch (err) { next(err); }
});

router.delete('/:id/trials/:trialId', authenticateUser, async (req, res, next) => {
  try {
    const project = await ProjectModel.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    if (!hasCloudinaryPublicId(project.cloudinaryPublicId)) return res.status(409).json({ message: 'This older project has no stored photo reference. Re-upload the room photo before changing saved designs.' });
    const trial = project.trials.id(req.params.trialId);
    if (!trial) return res.status(404).json({ message: 'Saved design not found.' });
    trial.deleteOne();
    project.updatedAt = new Date();
    await project.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/trials/:trialId/feedback', authenticateUser, async (req, res, next) => {
  try {
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Choose a rating from 1 to 5.' });
    const project = await ProjectModel.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    if (!hasCloudinaryPublicId(project.cloudinaryPublicId)) return res.status(409).json({ message: 'This older project has no stored photo reference. Re-upload the room photo before changing saved designs.' });
    const trial = project.trials.id(req.params.trialId);
    if (!trial) return res.status(404).json({ message: 'Trial not found.' });
    trial.satisfaction = rating;
    await project.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticateUser, async (req, res, next) => {
  try {
    const project = await ProjectModel.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    if (!hasCloudinaryPublicId(project.cloudinaryPublicId)) {
      logger.warn(`Deleting legacy project ${project._id} without a Cloudinary public_id; no Cloudinary deletion was attempted.`);
      await project.deleteOne();
      return res.json({ ok: true, imageDeleted: false, warning: 'This project had no stored image reference, so no Cloudinary image was deleted.' });
    }
    let removal;
    try { removal = await removeCloudinaryAsset(cloudinaryClient, project.cloudinaryPublicId); }
    catch (err) {
      logger.error(`Could not delete Cloudinary asset ${project.cloudinaryPublicId} for project ${project._id}: ${err.message || 'unknown error'}`);
      return res.status(502).json({ message: 'The room image could not be deleted from image storage. The project was kept; please try again.' });
    }
    if (removal.status === 'already-missing') logger.warn(`Cloudinary asset ${project.cloudinaryPublicId} for project ${project._id} was already missing; removing the project record.`);
    try { await project.deleteOne(); }
    catch (err) {
      logger.error(`Cloudinary image ${project.cloudinaryPublicId} was removed for project ${project._id}, but MongoDB deletion failed; the project was retained for a safe retry.`);
      throw err;
    }
    res.json({ ok: true, imageDeleted: removal.status === 'deleted' });
  } catch (err) { next(err); }
});

  return router;
}

export default createProjectsRouter();
