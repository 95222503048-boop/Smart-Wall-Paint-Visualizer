import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Component, ElementRef, HostListener, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

type User = { id: string; name: string; email: string; role: 'user' | 'admin' };
type PaintColor = { _id: string; name: string; hex: string; brand: string; finishes: string[]; categories: string[]; active?: boolean };
type Point = { x: number; y: number };
type AiMask = { width: number; height: number; bits: string; prompt: string; threshold: number };
type WallMask = { brush: Array<{ points: Point[]; size: number; erasable?: boolean }>; polygons: Point[][]; regions?: Point[]; eraser?: Array<{ points: Point[]; size: number }>; ai?: AiMask };
type PaintLayer = { id: string; name: string; colorId: string | null; colorHex: string; opacity: number; mask: WallMask; appearance: Appearance };
type EditorSnapshot = { mask: WallMask; polygonDraft: Point[]; color: PaintColor | null; opacity: number; appearance: Appearance; pendingAiMask: AiMask | null; layers: PaintLayer[]; activeLayerId: string };
type Trial = { _id: string; name: string; colorId: string | null; colorHex: string; opacity: number; mask: WallMask; appearance?: Appearance; layers?: PaintLayer[]; activeLayerId?: string; createdAt: string; satisfaction?: number | null };
type Appearance = { lighting: number; calibration: number; finish: 'matte' | 'eggshell' | 'satin' | 'gloss'; pattern: 'solid' | 'stripes' | 'checks'; dualTone: boolean; split: number; secondColor: string; secondColorId?: string };
type Project = { _id: string; title: string; originalUrl: string; mimeType: string; trials: Trial[]; updatedAt: string; owner?: { name: string; email: string } };
type Metrics = { totalUsers: number; uploadsLast24h: number; savedTrials: number; averageSessionMinutes: number; activeSessions: number; averageSatisfaction: number | null; refreshedAt: string };

@Component({
  selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html', styleUrl: './app.component.css'
})
export class AppComponent {
  readonly Math = Math;
  private http = inject(HttpClient);
  private api = '/api';
  @ViewChild('paintCanvas') paintCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasStage') canvasStage?: ElementRef<HTMLDivElement>;
  @ViewChild('photoInput') photoInput?: ElementRef<HTMLInputElement>;

  user: User | null = null;
  sessionId = '';
  csrfToken = '';
  view: 'auth' | 'home' | 'editor' | 'saved' | 'admin' = 'auth';
  authMode: 'login' | 'register' = 'login';
  email = ''; password = ''; fullName = '';
  projects: Project[] = []; colors: PaintColor[] = [];
  imageCache: Record<string, string> = {};
  adminUsers: Array<User & { projectCount: number; createdAt: string }> = [];
  adminProjects: Project[] = [];
  metrics: Metrics | null = null;
  activeProject: Project | null = null;
  activeTrialId = '';
  photo = new Image();
  photoReady = false;
  color: PaintColor | null = null;
  opacity = 0.72;
  appearance: Appearance = { lighting: 1, calibration: 1, finish: 'eggshell', pattern: 'solid', dualTone: false, split: 0.5, secondColor: '#D8CDB8' };
  tool: 'brush' | 'eraser' | 'polygon' | 'ai' | 'zoom-in' | 'zoom-out' = 'brush';
  brushSize = 0.035;
  autoTolerance = 28;
  aiDialog = false;
  aiConsent = false;
  aiBusy = false;
  aiPrompt = 'wall';
  aiThreshold = 0.45;
  aiProgress = 0;
  aiProgressFile = '';
  aiStatus = '';
  aiError = '';
  pendingAiMask: AiMask | null = null;
  dirty = false;
  fullscreen = false;
  fullscreenFallback = false;
  drawing = false;
  erasableStrokes = true;
  currentStroke: Point[] = [];
  polygonDraft: Point[] = [];
  mask: WallMask = { brush: [], polygons: [] };
  paintLayers: PaintLayer[] = [];
  activeLayerId = '';
  undoStack: EditorSnapshot[] = [];
  zoom = 1;
  zoomAnchorTimer = 0;
  busy = false;
  leaveDialog = false;
  pendingNavigation: (() => void) | null = null;
  error = '';
  message = '';
  uploadTitle = '';
  ownershipConfirmed = false;
  newColor = { name: '', hex: '#879B87', brand: 'Studio palette', finishes: 'Matte, Eggshell, Satin', categories: 'Living room, Bedroom' };
  editingColorId = '';
  previewMode: 'paint' | 'before' = 'paint';
  private imageScale = 1;
  private labCache: { photo: HTMLImageElement; width: number; height: number; data: Float32Array } | null = null;
  private adminTimer: number | undefined;
  private segmentationRuntime: any = null;
  private segmentationLoad: Promise<void> | null = null;

  @ViewChild('canvasColumn') canvasColumn?: ElementRef<HTMLElement>;

  constructor() { void this.restoreSession(); }

  get currentTrial(): Trial | undefined { return this.activeProject?.trials.find((t) => t._id === this.activeTrialId); }
  get activePaintLayer(): PaintLayer | undefined { return this.paintLayers.find((layer) => layer.id === this.activeLayerId); }
  get hasSavedTrials(): boolean { return this.projects.some((project) => project.trials.length > 0); }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get isEditor(): boolean { return this.view === 'editor' && !!this.activeProject; }
  get aiModelAccepted(): boolean { return localStorage.getItem('swv_ai_model_consent') === 'accepted'; }
  get aiModelReady(): boolean { return !!this.segmentationRuntime; }
  get imageDimensions(): string { return this.photoReady ? `${Math.round(this.photo.naturalWidth * this.imageScale)} × ${Math.round(this.photo.naturalHeight * this.imageScale)} px` : ''; }

  private headers() { return { withCredentials: true, headers: new HttpHeaders(this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {}) }; }
  private async refreshCsrf() {
    const result = await firstValueFrom(this.http.get<{ csrfToken: string }>(`${this.api}/auth/csrf`, { withCredentials: true }));
    this.csrfToken = result.csrfToken;
  }
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return await firstValueFrom(this.http.request<T>(method, `${this.api}${path}`, { body, ...this.headers(), responseType: 'json' }));
  }
  projectImage(project: Project): string { return this.imageCache[project._id] || ''; }
  private async cacheProjectImage(project: Project) {
    if (this.imageCache[project._id]) return this.imageCache[project._id];
    const blob = await firstValueFrom(this.http.get(`${this.api}/projects/${project._id}/image`, { ...this.headers(), responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    this.imageCache[project._id] = url;
    return url;
  }
  private showError(err: unknown) { this.error = err instanceof HttpErrorResponse ? (err.error?.message || 'Something went wrong. Please try again.') : 'Something went wrong. Please try again.'; }

  async restoreSession() {
    try {
      await this.refreshCsrf();
      const data = await this.request<{ user: User }>('GET', '/auth/me');
      this.user = data.user; this.view = 'home'; await this.loadHome(); void this.pingSession();
    } catch { this.clearSession(); }
  }
  async authenticate() {
    this.error = ''; this.busy = true;
    try {
      await this.refreshCsrf();
      const path = this.authMode === 'login' ? '/auth/login' : '/auth/register';
      const payload = this.authMode === 'login' ? { email: this.email, password: this.password } : { name: this.fullName, email: this.email, password: this.password };
      const result = await firstValueFrom(this.http.post<{ user: User; sessionId: string }>(`${this.api}${path}`, payload, this.headers()));
      this.user = result.user; this.sessionId = result.sessionId;
      this.view = 'home'; await this.loadHome(); void this.pingSession();
    } catch (err) { this.showError(err); } finally { this.busy = false; }
  }
  private clearSession() {
    this.user = null; this.sessionId = ''; this.view = 'auth';
    Object.values(this.imageCache).forEach((url) => URL.revokeObjectURL(url)); this.imageCache = {};
    if (this.adminTimer) window.clearInterval(this.adminTimer);
  }
  logout() { this.confirmEditorLeave(() => void this.performLogout()); }
  private async performLogout() {
    try { await this.request('POST', '/auth/session/end', { sessionId: this.sessionId }); } catch { /* local sign-out should still work offline */ }
    this.clearSession(); this.activeProject = null; this.error = ''; this.message = '';
  }
  private async pingSession() {
    try { await this.request('POST', '/auth/session/ping', { sessionId: this.sessionId }); } catch { return; }
    window.setTimeout(() => void this.pingSession(), 60000);
  }
  async loadHome() {
    if (!this.user) return;
    this.error = '';
    try {
      const [projects, colors] = await Promise.all([this.request<Project[]>('GET', '/projects'), this.request<PaintColor[]>('GET', '/colors')]);
      this.projects = projects; this.colors = colors;
      await Promise.all(projects.map((project) => this.cacheProjectImage(project).catch(() => '')));
    } catch (err) { this.showError(err); }
  }
  openUpload() { this.error = ''; this.message = ''; this.uploadTitle = ''; this.ownershipConfirmed = false; this.photoInput?.nativeElement.click(); }
  async onPhotoPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { this.error = 'Choose a JPG or PNG room photo.'; return; }
    if (this.uploadPreviewUrl) URL.revokeObjectURL(this.uploadPreviewUrl);
    const objectUrl = URL.createObjectURL(file); this.uploadPreviewUrl = objectUrl;
    this.uploadTitle = file.name.replace(/\.[^.]+$/, '');
    this.error = '';
    const image = new Image();
    image.onload = () => { this.photo = image; this.photoReady = true; this.imageScale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)); this.view = 'home'; this.uploadPendingFile = file; };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); this.uploadPreviewUrl = ''; this.error = 'This image could not be opened.'; };
    image.src = objectUrl;
    this.uploadDialog = true;
  }
  uploadPendingFile: File | null = null;
  uploadDialog = false;
  uploadPreviewUrl = '';
  async createProject() {
    if (!this.uploadPendingFile) return;
    if (!this.ownershipConfirmed) { this.error = 'Please confirm that you own this photo.'; return; }
    this.error = ''; this.busy = true;
    try {
      const form = new FormData(); form.set('photo', this.uploadPendingFile); form.set('title', this.uploadTitle || 'My room'); form.set('ownershipConfirmed', 'true'); form.set('width', String(this.photo.naturalWidth)); form.set('height', String(this.photo.naturalHeight));
      const project = await firstValueFrom(this.http.post<Project>(`${this.api}/projects/upload`, form, this.headers()));
      this.uploadDialog = false; this.uploadPendingFile = null; this.projects.unshift(project); await this.openProject(project);
      if (this.uploadPreviewUrl) URL.revokeObjectURL(this.uploadPreviewUrl); this.uploadPreviewUrl = '';
    } catch (err) { this.showError(err); } finally { this.busy = false; }
  }
  async openProject(project: Project, trial?: Trial) {
    this.error = ''; this.message = ''; this.busy = true;
    try {
      this.activeProject = await this.request<Project>('GET', `/projects/${project._id}`);
      const selected = trial || this.activeProject.trials[this.activeProject.trials.length - 1];
      this.activeTrialId = selected?._id || crypto.randomUUID();
      this.paintLayers = selected?.layers?.length ? structuredClone(selected.layers) : [{ id: crypto.randomUUID(), name: 'Wall 1', colorId: selected?.colorId || null, colorHex: selected?.colorHex || this.colors[0]?.hex || '#C7836A', opacity: selected?.opacity ?? 0.72, mask: structuredClone(selected?.mask || { brush: [], polygons: [] }), appearance: { ...this.appearance, ...(selected?.appearance || {}) } }];
      this.activeLayerId = selected?.activeLayerId && this.paintLayers.some((layer) => layer.id === selected.activeLayerId) ? selected.activeLayerId : this.paintLayers[0].id;
      this.loadActiveLayer();
      this.previewMode = 'paint'; this.polygonDraft = []; this.undoStack = []; this.pendingAiMask = null; this.dirty = false; this.zoom = 1; this.tool = 'brush';
      this.photoReady = false;
      const src = await this.cacheProjectImage(this.activeProject);
      const img = new Image(); img.onload = () => { this.photo = img; this.photoReady = true; this.imageScale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)); this.view = 'editor'; requestAnimationFrame(() => this.drawCanvas()); }; img.onerror = () => { this.error = 'The original photo could not be loaded.'; }; img.src = src;
    } catch (err) { this.showError(err); } finally { this.busy = false; }
  }
  newTrial() { this.confirmEditorLeave(() => this.startNewTrial()); }
  private startNewTrial() {
    this.activeTrialId = crypto.randomUUID(); this.pendingAiMask = null; this.dirty = true; this.polygonDraft = []; this.undoStack = []; this.previewMode = 'paint'; this.opacity = 0.72; this.appearance = { lighting: 1, calibration: 1, finish: 'eggshell', pattern: 'solid', dualTone: false, split: 0.5, secondColor: '#D8CDB8' }; this.zoom = 1; this.tool = 'brush';
    const id = crypto.randomUUID(); this.paintLayers = [{ id, name: 'Wall 1', colorId: this.color?._id || null, colorHex: this.color?.hex || '#C7836A', opacity: this.opacity, mask: { brush: [], polygons: [] }, appearance: { ...this.appearance } }]; this.activeLayerId = id;
    this.message = 'New paint trial started.'; this.drawCanvas();
  }
  startBlankProject(project: Project) { void this.openProject(project); }
  async saveTrial(): Promise<boolean> {
    if (this.pendingAiMask) { this.error = 'Review the AI selection and choose “Use this selection” or discard it before saving.'; return false; }
    if (this.polygonDraft.length) {
      if (this.polygonDraft.length < 3) { this.error = 'Finish the polygon with at least three corners before saving.'; return false; }
      this.finishPolygon();
    }
    if (!this.activeProject || !this.color) { this.error = 'Choose a paint color before saving.'; return false; }
    this.busy = true; this.error = '';
    try {
      this.syncActiveLayer();
      const usedLayers = this.paintLayers.filter((layer) => layer.mask.brush.length || layer.mask.polygons.length || layer.mask.ai || layer.mask.regions?.length);
      const trialColours = [...new Set(usedLayers.map((layer) => this.colors.find((candidate) => candidate._id === layer.colorId)?.name || layer.colorHex))];
      const trialName = `${trialColours.length ? trialColours.join(' + ') : this.color.name}${usedLayers.length > 1 ? ` · ${usedLayers.length} areas` : ' trial'}`;
      const saved = await this.request<Project>('PUT', `/projects/${this.activeProject._id}/trials/${this.activeTrialId}`, { name: trialName, colorId: this.color._id || null, colorHex: this.color.hex, opacity: this.opacity, mask: this.mask, appearance: this.appearance, layers: this.paintLayers, activeLayerId: this.activeLayerId });
      this.activeProject = saved; this.projects = this.projects.map((p) => p._id === saved._id ? saved : p); this.dirty = false; this.message = 'Your changes are saved.'; return true;
    } catch (err) { this.showError(err); return false; } finally { this.busy = false; }
  }
  async removeProject(project: Project) {
    if (!window.confirm(`Delete “${project.title}” and its saved paint trials?`)) return;
    try { await this.request('DELETE', `/projects/${project._id}`); this.projects = this.projects.filter((p) => p._id !== project._id); const url = this.imageCache[project._id]; if (url) URL.revokeObjectURL(url); delete this.imageCache[project._id]; if (this.activeProject?._id === project._id) this.goHome(); }
    catch (err) { this.showError(err); }
  }
  async downloadRoomPhoto(project: Project) {
    try { const url = await this.cacheProjectImage(project); const link = document.createElement('a'); link.href = url; link.download = `${project.title || 'room'}${project.mimeType === 'image/png' ? '.png' : '.jpg'}`; link.click(); }
    catch (err) { this.showError(err); }
  }
  async deleteSavedTrial(project: Project, trial: Trial) {
    if (!window.confirm(`Delete “${trial.name || 'Paint trial'}” from ${project.title}? This only removes the saved design.`)) return;
    try { await this.request('DELETE', `/projects/${project._id}/trials/${trial._id}`); const updated = { ...project, trials: project.trials.filter((item) => item._id !== trial._id) }; this.projects = this.projects.map((item) => item._id === project._id ? updated : item); if (this.activeProject?._id === project._id) this.activeProject = updated; }
    catch (err) { this.showError(err); }
  }
  async downloadSavedTrial(project: Project, trial: Trial) {
    try {
      const src = await this.cacheProjectImage(project);
      const photo = new Image(); photo.src = src; await photo.decode();
      const old = { photo: this.photo, photoReady: this.photoReady, imageScale: this.imageScale, mask: this.mask, color: this.color, opacity: this.opacity, appearance: this.appearance, paintLayers: this.paintLayers, activeLayerId: this.activeLayerId, pendingAiMask: this.pendingAiMask, previewMode: this.previewMode, tool: this.tool };
      try {
        this.photo = photo; this.photoReady = true; this.imageScale = Math.min(1, 2400 / Math.max(photo.naturalWidth, photo.naturalHeight));
        this.paintLayers = structuredClone(trial.layers?.length ? trial.layers : [{ id: trial._id, name: trial.name, colorId: trial.colorId, colorHex: trial.colorHex, opacity: trial.opacity, mask: trial.mask, appearance: trial.appearance || this.appearance }]);
        this.activeLayerId = trial.activeLayerId || this.paintLayers[0].id; this.loadActiveLayer(); this.pendingAiMask = null; this.previewMode = 'paint'; this.tool = 'zoom-out';
        const canvas = document.createElement('canvas'); this.drawCanvas(canvas);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('PNG export failed.')), 'image/png'));
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${project.title}-${trial.name || 'paint-trial'}.png`.replace(/[^a-z0-9_.-]+/gi, '-'); link.click(); URL.revokeObjectURL(url);
      } finally { Object.assign(this, old); this.drawCanvas(); }
    } catch (err) { this.showError(err); }
  }
  async submitFeedback(rating: number) {
    if (!this.activeProject || !this.currentTrial) return;
    try { await this.request('POST', `/projects/${this.activeProject._id}/trials/${this.activeTrialId}/feedback`, { rating }); this.currentTrial.satisfaction = rating; this.message = 'Thanks for your feedback.'; }
    catch (err) { this.showError(err); }
  }
  private confirmEditorLeave(action: () => void) {
    if (!this.isEditor || (!this.dirty && !this.pendingAiMask)) { action(); return; }
    this.pendingNavigation = action; this.leaveDialog = true; this.error = '';
  }
  async saveAndLeave() {
    if (!this.pendingNavigation || this.busy) return;
    const action = this.pendingNavigation;
    if (await this.saveTrial()) { this.pendingNavigation = null; this.leaveDialog = false; action(); }
  }
  discardAndLeave() {
    const action = this.pendingNavigation; this.pendingNavigation = null; this.leaveDialog = false; this.dirty = false;
    if (action) action();
  }
  stayInEditor() { this.pendingNavigation = null; this.leaveDialog = false; }
  goHome() { this.confirmEditorLeave(() => this.showHome()); }
  private showHome() { this.view = 'home'; this.activeProject = null; this.message = ''; this.error = ''; void this.loadHome(); }
  goSaved() { this.confirmEditorLeave(() => this.showSaved()); }
  private showSaved() { this.view = 'saved'; this.activeProject = null; this.error = ''; void this.loadHome(); }
  goAdmin() { this.confirmEditorLeave(() => void this.openAdmin()); }
  private async openAdmin() {
    this.view = 'admin'; this.error = ''; this.busy = true;
    try { await this.loadAdmin(); if (this.adminTimer) window.clearInterval(this.adminTimer); this.adminTimer = window.setInterval(() => { if (this.view === 'admin') void this.refreshAdmin(); }, 60000); } catch (err) { this.showError(err); } finally { this.busy = false; }
  }
  private async loadAdmin() {
    const [metrics, users, projects, colors] = await Promise.all([
      this.request<Metrics>('GET', '/admin/analytics'), this.request<any[]>('GET', '/admin/users'), this.request<Project[]>('GET', '/admin/projects'), this.request<PaintColor[]>('GET', '/colors/admin/all')
    ]);
    this.metrics = metrics; this.adminUsers = users; this.adminProjects = projects; this.colors = colors;
    await Promise.all(projects.map((project) => this.cacheProjectImage(project).catch(() => '')));
  }
  async refreshAdmin() { try { await this.loadAdmin(); } catch (err) { this.showError(err); } }
  async changeRole(person: User & { projectCount: number }, event: Event) {
    const role = (event.target as HTMLSelectElement).value;
    try { await this.request('PATCH', `/admin/users/${person.id}/role`, { role }); person.role = role as 'user' | 'admin'; } catch (err) { this.showError(err); }
  }
  async addColor() {
    this.error = '';
    try {
      const body = { name: this.newColor.name, hex: this.newColor.hex.toUpperCase(), brand: this.newColor.brand, finishes: this.newColor.finishes.split(',').map((x) => x.trim()).filter(Boolean), categories: this.newColor.categories.split(',').map((x) => x.trim()).filter(Boolean) };
      const saved = this.editingColorId
        ? await this.request<PaintColor>('PATCH', `/colors/${this.editingColorId}`, body)
        : await this.request<PaintColor>('POST', '/colors', body);
      const exists = this.colors.some((c) => c._id === saved._id);
      this.colors = (exists ? this.colors.map((c) => c._id === saved._id ? saved : c) : [...this.colors, saved]).sort((a, b) => a.name.localeCompare(b.name));
      this.cancelColorEdit();
    } catch (err) { this.showError(err); }
  }
  editColor(color: PaintColor) { this.editingColorId = color._id; this.newColor = { name: color.name, hex: color.hex, brand: color.brand, finishes: color.finishes.join(', '), categories: color.categories.join(', ') }; }
  cancelColorEdit() { this.editingColorId = ''; this.newColor = { name: '', hex: '#879B87', brand: 'Studio palette', finishes: 'Matte, Eggshell, Satin', categories: 'Living room, Bedroom' }; }
  async removeColor(color: PaintColor) {
    if (!window.confirm(`Permanently delete “${color.name}” from the studio palette? This cannot be undone. Existing saved previews will keep their recorded colour.`)) return;
    try { await this.request('DELETE', `/colors/${color._id}`); this.colors = this.colors.filter((c) => c._id !== color._id); } catch (err) { this.showError(err); }
  }

  setTool(tool: 'brush' | 'eraser' | 'polygon' | 'ai' | 'zoom-in' | 'zoom-out') {
    if (tool === 'ai') { this.tool = 'ai'; this.beginAiSegmentation(); return; }
    if (tool !== this.tool) {
      if (this.polygonDraft.length) this.recordHistory();
      this.tool = tool; this.drawing = false; this.currentStroke = []; this.polygonDraft = []; this.drawCanvas();
    }
  }
  private syncActiveLayer() {
    const layer = this.activePaintLayer;
    if (!layer) return;
    layer.mask = structuredClone(this.mask); layer.colorId = this.color?._id || null; layer.colorHex = this.color?.hex || layer.colorHex; layer.opacity = this.opacity; layer.appearance = { ...this.appearance };
  }
  private loadActiveLayer() {
    const layer = this.activePaintLayer;
    if (!layer) return;
    this.mask = structuredClone(layer.mask || { brush: [], polygons: [] });
    this.color = this.colors.find((candidate) => candidate._id === layer.colorId) || this.colors.find((candidate) => candidate.hex.toLowerCase() === layer.colorHex?.toLowerCase()) || { _id: layer.colorId || '', name: layer.name, hex: layer.colorHex, brand: 'Custom shade', finishes: [], categories: [] };
    this.opacity = layer.opacity ?? 0.72; this.appearance = { ...this.appearance, ...(layer.appearance || {}) };
  }
  addWallLayer() {
    if (this.paintLayers.length >= 12) { this.error = 'A paint trial can contain up to 12 separately coloured areas.'; return; }
    if (this.polygonDraft.length >= 3) this.finishPolygon(); else this.polygonDraft = [];
    this.recordHistory(); this.syncActiveLayer();
    const id = crypto.randomUUID(), layer: PaintLayer = { id, name: `Wall ${this.paintLayers.length + 1}`, colorId: this.color?._id || null, colorHex: this.color?.hex || '#C7836A', opacity: this.opacity, mask: { brush: [], polygons: [] }, appearance: { ...this.appearance } };
    this.paintLayers = [...this.paintLayers, layer]; this.activeLayerId = id; this.loadActiveLayer(); this.dirty = true; this.error = ''; this.message = `${layer.name} added. Choose a colour, then select its area.`; this.drawCanvas();
  }
  selectWallLayer(id: string) {
    if (id === this.activeLayerId) return;
    if (this.polygonDraft.length >= 3) this.finishPolygon(); else this.polygonDraft = [];
    this.recordHistory(); this.syncActiveLayer(); this.activeLayerId = id; this.loadActiveLayer(); this.pendingAiMask = null; this.dirty = true; this.drawCanvas();
  }
  removeWallLayer(id: string) {
    if (this.paintLayers.length <= 1) { this.error = 'Keep at least one wall area in the trial.'; return; }
    this.recordHistory(); this.paintLayers = this.paintLayers.filter((layer) => layer.id !== id);
    if (this.activeLayerId === id) this.activeLayerId = this.paintLayers[Math.max(0, this.paintLayers.length - 1)].id;
    this.pendingAiMask = null; this.polygonDraft = []; this.loadActiveLayer(); this.dirty = true; this.drawCanvas();
  }
  private recordHistory() {
    this.syncActiveLayer();
    this.undoStack.push({ mask: structuredClone(this.mask), polygonDraft: structuredClone(this.polygonDraft), color: this.color ? { ...this.color } : null, opacity: this.opacity, appearance: { ...this.appearance }, pendingAiMask: this.pendingAiMask ? structuredClone(this.pendingAiMask) : null, layers: structuredClone(this.paintLayers), activeLayerId: this.activeLayerId });
    if (this.undoStack.length > 50) this.undoStack.shift();
  }
  private pointFromEvent(event: PointerEvent): Point {
    const canvas = this.paintCanvas!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    // Use the rendered canvas bounds (including CSS zoom), then normalize to
    // the bitmap dimensions used by drawImage and the saved mask.
    const bitmapX = (event.clientX - rect.left) * canvas.width / rect.width;
    const bitmapY = (event.clientY - rect.top) * canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(1, bitmapX / canvas.width)),
      y: Math.max(0, Math.min(1, bitmapY / canvas.height))
    };
  }
  pointerDown(event: PointerEvent) {
    if (!this.paintCanvas || !this.photoReady) return;
    if (this.pendingAiMask) return;
    if (this.tool === 'zoom-in') { this.changeZoom(1.25, event.clientX, event.clientY); return; }
    if (this.tool === 'zoom-out') { this.changeZoom(0.8, event.clientX, event.clientY); return; }
    if (this.previewMode === 'before') return;
    this.paintCanvas.nativeElement.setPointerCapture(event.pointerId);
    const point = this.pointFromEvent(event);
    if (this.tool === 'brush' || this.tool === 'eraser') {
      this.recordHistory(); this.dirty = true; this.drawing = true; this.currentStroke = [point];
      const strokes = this.tool === 'eraser' ? (this.mask.eraser ||= []) : this.mask.brush;
      strokes.push({ points: this.currentStroke, size: this.brushSize, ...(this.tool === 'brush' ? { erasable: this.erasableStrokes } : {}) });
    }
    else { if (!this.polygonDraft.length) this.recordHistory(); this.dirty = true; this.polygonDraft.push(point); }
    this.drawCanvas();
  }
  pointerMove(event: PointerEvent) {
    if ((this.tool === 'brush' || this.tool === 'eraser') && this.drawing) {
      const point = this.pointFromEvent(event), previous = this.currentStroke[this.currentStroke.length - 1];
      const distance = Math.hypot((point.x - previous.x) * this.photo.naturalWidth, (point.y - previous.y) * this.photo.naturalHeight);
      const steps = Math.max(1, Math.ceil(distance / Math.max(2, this.brushSize * this.photo.naturalWidth * 0.18)));
      for (let step = 1; step <= steps; step++) this.currentStroke.push({ x: previous.x + (point.x - previous.x) * step / steps, y: previous.y + (point.y - previous.y) * step / steps });
      this.drawCanvas();
    }
  }
  pointerUp() {
    if (this.drawing && this.tool === 'eraser') {
      const eraser = this.mask.eraser?.pop();
      if (eraser) {
        const radius = eraser.size / 2;
        const isHit = (point: Point) => eraser.points.some((erasePoint) => Math.hypot((point.x - erasePoint.x) * this.photo.naturalWidth, (point.y - erasePoint.y) * this.photo.naturalHeight) < radius * this.photo.naturalWidth);
        // Erasing is committed as an edit to the original stroke list. The
        // temporary eraser path is never kept in the saved mask.
        this.mask.brush = this.mask.brush.flatMap((stroke) => {
          if (stroke.erasable === false) return [stroke];
          const segments: Point[][] = []; let kept: Point[] = [];
          for (const point of stroke.points) {
            if (isHit(point)) { if (kept.length) segments.push(kept); kept = []; }
            else kept.push(point);
          }
          if (kept.length) segments.push(kept);
          return segments.map((points) => ({ ...stroke, points }));
        });
        if (this.mask.ai) this.eraseAiMask(this.mask.ai, eraser);
      }
    }
    this.drawing = false; this.currentStroke = []; this.drawCanvas();
  }
  finishPolygon() {
    if (this.polygonDraft.length < 3) { this.error = 'A wall selection needs at least three points.'; return; }
    this.mask.polygons.push(this.polygonDraft); this.polygonDraft = []; this.dirty = true; this.error = ''; this.drawCanvas();
  }
  undoMask() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.mask = previous.mask; this.polygonDraft = previous.polygonDraft; this.color = previous.color; this.opacity = previous.opacity; this.appearance = previous.appearance; this.pendingAiMask = previous.pendingAiMask; this.paintLayers = previous.layers; this.activeLayerId = previous.activeLayerId; this.syncActiveLayer(); this.dirty = true;
    this.drawCanvas();
  }
  clearMask() {
    if (!this.mask.brush.length && !this.mask.polygons.length && !this.mask.regions?.length && !this.mask.eraser?.length && !this.mask.ai && !this.pendingAiMask && !this.polygonDraft.length) return;
    this.recordHistory(); this.mask = { brush: [], polygons: [] }; this.pendingAiMask = null; this.polygonDraft = []; this.dirty = true; this.drawCanvas();
  }
  selectColor(color: PaintColor) { if (this.color?._id !== color._id) this.recordHistory(); this.color = color; this.syncActiveLayer(); this.dirty = true; this.drawCanvas(); }
  selectSecondColor(id: string) { const shade = this.colors.find((candidate) => candidate._id === id); if (shade) { this.beginAppearanceEdit(); this.updateAppearance('secondColor', shade.hex); this.updateAppearance('secondColorId', shade._id); } }
  updateOpacity(value: number) { this.opacity = Number(value); this.syncActiveLayer(); this.dirty = true; this.drawCanvas(); }
  beginOpacityEdit() { this.recordHistory(); }
  beginAppearanceEdit() { this.recordHistory(); }
  updateAppearance<K extends keyof Appearance>(key: K, value: Appearance[K]) { this.appearance = { ...this.appearance, [key]: value }; this.syncActiveLayer(); this.dirty = true; this.drawCanvas(); }
  updateAutoTolerance(value: number) { this.autoTolerance = Number(value); this.drawCanvas(); }

  beginAiSegmentation() {
    if (document.fullscreenElement) void document.exitFullscreen();
    if (this.fullscreenFallback) { this.fullscreenFallback = false; this.fullscreen = false; }
    this.aiDialog = true; this.aiError = ''; this.aiConsent = localStorage.getItem('swv_ai_model_consent') === 'accepted';
    this.aiStatus = this.segmentationRuntime ? 'Model ready in this tab.' : 'The model will run on this device.';
  }
  private updateAiProgress(info: any) {
    if (info?.status === 'progress' && info.total > 0) {
      this.aiProgress = Math.round(info.progress || info.loaded * 100 / info.total); this.aiProgressFile = info.file || 'Model file';
      this.aiStatus = 'Downloading model files…';
    } else if (info?.status === 'initiate') { this.aiProgressFile = info.file || 'Preparing model'; }
  }
  private async loadAiModel() {
    if (this.segmentationRuntime) return;
    if (!this.segmentationLoad) this.segmentationLoad = (async () => {
      const hf = await import('@huggingface/transformers');
      hf.env.useBrowserCache = true;
      const progress_callback = (info: any) => this.updateAiProgress(info);
      const modelId = 'Xenova/clipseg-rd64-refined';
      const [tokenizer, processor, model] = await Promise.all([
        hf.AutoTokenizer.from_pretrained(modelId, { progress_callback }),
        hf.AutoProcessor.from_pretrained(modelId, { progress_callback }),
        hf.CLIPSegForImageSegmentation.from_pretrained(modelId, { progress_callback })
      ]);
      this.segmentationRuntime = { ...hf, tokenizer, processor, model };
      this.aiProgress = 100; this.aiStatus = 'AI model is ready.';
    })().catch((error) => { this.segmentationLoad = null; throw error; });
    await this.segmentationLoad;
  }
  async runAiSegmentation() {
    if (!this.photoReady || !this.aiPrompt.trim()) { this.aiError = 'Enter what you want to select, such as “wall”, “sofa”, or “curtains”.'; return; }
    if (localStorage.getItem('swv_ai_model_consent') !== 'accepted' && !this.aiConsent) { this.aiError = 'Please confirm before downloading the AI model files.'; return; }
    localStorage.setItem('swv_ai_model_consent', 'accepted'); this.aiBusy = true; this.aiError = ''; this.aiProgress = 0; this.aiStatus = 'Loading AI segmentation model…';
    try {
      await this.loadAiModel();
      this.aiStatus = 'Analyzing the room photo…'; this.aiProgressFile = '';
      const longest = Math.max(this.photo.naturalWidth, this.photo.naturalHeight), scale = Math.min(1, 1024 / longest);
      const input = document.createElement('canvas'); input.width = Math.max(1, Math.round(this.photo.naturalWidth * scale)); input.height = Math.max(1, Math.round(this.photo.naturalHeight * scale));
      const inputCtx = input.getContext('2d'); if (!inputCtx) throw new Error('Could not prepare the room photo for segmentation.');
      inputCtx.drawImage(this.photo, 0, 0, input.width, input.height);
      const rawImage = this.segmentationRuntime.RawImage.fromCanvas(input);
      const prompt = this.aiPrompt.trim();
      const texts = [prompt, `the ${prompt} in an indoor room`];
      const textInputs = this.segmentationRuntime.tokenizer(texts, { padding: true, truncation: true });
      const imageInputs = await this.segmentationRuntime.processor(rawImage);
      const { logits } = await this.segmentationRuntime.model({ ...textInputs, ...imageInputs });
      const dims = logits.dims as number[];
      const mapHeight = dims[dims.length - 2], mapWidth = dims[dims.length - 1], mapSize = mapWidth * mapHeight;
      const promptCount = Math.max(1, Math.floor(logits.data.length / mapSize));
      const packed = new Uint8Array(Math.ceil(mapSize / 8)); let selected = 0;
      for (let pixel = 0; pixel < mapSize; pixel++) {
        let confidence = 0;
        for (let promptIndex = 0; promptIndex < promptCount; promptIndex++) {
          const logit = logits.data[promptIndex * mapSize + pixel];
          confidence = Math.max(confidence, 1 / (1 + Math.exp(-logit)));
        }
        if (confidence >= this.aiThreshold) { packed[pixel >> 3] |= 1 << (pixel & 7); selected++; }
      }
      if (!selected) throw new Error('The model did not find that area. Try a simpler prompt such as “wall” or “sofa”.');
      this.pendingAiMask = { width: mapWidth, height: mapHeight, bits: this.bytesToBase64(packed), prompt, threshold: this.aiThreshold };
      this.aiDialog = false; this.message = `AI found “${prompt}”. Review the preview, then apply it or keep editing manually.`; this.drawCanvas();
    } catch (error) {
      this.aiError = error instanceof Error ? error.message : 'AI segmentation failed. Check your internet connection and try again.';
      this.aiStatus = 'Model unavailable';
    } finally { this.aiBusy = false; }
  }
  acceptAiMask() {
    if (!this.pendingAiMask) return;
    this.recordHistory(); this.mask = { brush: [], polygons: [], ai: this.pendingAiMask }; this.pendingAiMask = null; this.polygonDraft = []; this.dirty = true; this.message = 'AI selection applied. Refine it with the brush, eraser, or polygon tool.'; this.drawCanvas();
  }
  discardAiMask() { this.pendingAiMask = null; this.drawCanvas(); }
  private bytesToBase64(bytes: Uint8Array) { let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
  private base64ToBytes(value: string) { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; }
  private paintAiMask(mask: AiMask, maskCtx: CanvasRenderingContext2D, width: number, height: number) {
    const bits = this.base64ToBytes(mask.bits), pixels = mask.width * mask.height, bitmap = document.createElement('canvas'); bitmap.width = mask.width; bitmap.height = mask.height;
    const bitmapCtx = bitmap.getContext('2d'); if (!bitmapCtx) return;
    const imageData = bitmapCtx.createImageData(mask.width, mask.height);
    for (let pixel = 0; pixel < pixels; pixel++) if ((bits[pixel >> 3] & (1 << (pixel & 7))) !== 0) { const offset = pixel * 4; imageData.data[offset] = 255; imageData.data[offset + 1] = 255; imageData.data[offset + 2] = 255; imageData.data[offset + 3] = 255; }
    bitmapCtx.putImageData(imageData, 0, 0); maskCtx.drawImage(bitmap, 0, 0, width, height);
  }
  private eraseAiMask(mask: AiMask, stroke: { points: Point[]; size: number }) {
    const bitmap = document.createElement('canvas'); bitmap.width = mask.width; bitmap.height = mask.height;
    const ctx = bitmap.getContext('2d'); if (!ctx) return;
    const bits = this.base64ToBytes(mask.bits), imageData = ctx.createImageData(mask.width, mask.height);
    for (let pixel = 0; pixel < mask.width * mask.height; pixel++) if ((bits[pixel >> 3] & (1 << (pixel & 7))) !== 0) imageData.data[pixel * 4 + 3] = 255;
    ctx.putImageData(imageData, 0, 0); ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#fff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, stroke.size * mask.width);
    ctx.beginPath(); ctx.moveTo(stroke.points[0].x * mask.width, stroke.points[0].y * mask.height);
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * mask.width + .1, stroke.points[0].y * mask.height + .1); else stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x * mask.width, point.y * mask.height));
    ctx.stroke(); const erased = ctx.getImageData(0, 0, mask.width, mask.height), packed = new Uint8Array(Math.ceil(mask.width * mask.height / 8));
    for (let pixel = 0; pixel < mask.width * mask.height; pixel++) if (erased.data[pixel * 4 + 3] > 0) packed[pixel >> 3] |= 1 << (pixel & 7);
    this.mask.ai = { ...mask, bits: this.bytesToBase64(packed) };
  }
  async toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    try { await this.canvasColumn?.nativeElement.requestFullscreen(); }
    catch { this.fullscreenFallback = true; this.fullscreen = true; }
  }
  @HostListener('document:fullscreenchange') onFullscreenChange() { this.fullscreen = !!document.fullscreenElement; }
  changeZoom(factor: number, clientX?: number, clientY?: number) {
    const next = Math.max(0.5, Math.min(4, Math.round(this.zoom * factor * 100) / 100));
    const canvas = this.paintCanvas?.nativeElement, stage = this.canvasStage?.nativeElement;
    if (!canvas || !stage || next === this.zoom) { this.zoom = next; return; }
    const canvasRect = canvas.getBoundingClientRect(), stageRect = stage.getBoundingClientRect();
    const anchorX = clientX ?? stageRect.left + stage.clientWidth / 2;
    const anchorY = clientY ?? stageRect.top + stage.clientHeight / 2;
    const displayedZoom = canvas.offsetWidth ? canvasRect.width / canvas.offsetWidth : this.zoom;
    const zoomRatio = next / displayedZoom;
    const scrollLeft = stage.scrollLeft + (anchorX - canvasRect.left) * (zoomRatio - 1);
    const scrollTop = stage.scrollTop + (anchorY - canvasRect.top) * (zoomRatio - 1);
    this.zoom = next;
    window.clearTimeout(this.zoomAnchorTimer);
    this.zoomAnchorTimer = window.setTimeout(() => {
      stage.scrollTo({ left: Math.max(0, scrollLeft), top: Math.max(0, scrollTop), behavior: 'smooth' });
    }, 180);
  }
  resetZoom() { this.changeZoom(1 / this.zoom); }
  onCanvasWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    this.changeZoom(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
  }
  @HostListener('window:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && this.isEditor) { event.preventDefault(); if (!this.busy) void this.saveTrial(); return; }
    if (event.key === 'Escape' && this.fullscreenFallback) { this.fullscreenFallback = false; this.fullscreen = false; return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && this.isEditor && this.canUndo) {
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement && ['text', 'email', 'password'].includes(target.type)) return;
      event.preventDefault(); this.undoMask();
    }
  }
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent) {
    if (!this.isEditor || (!this.dirty && !this.pendingAiMask)) return;
    event.preventDefault(); event.returnValue = '';
  }
  async selectTrial(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    const trial = this.activeProject?.trials.find((item) => item._id === id);
    if (id === 'new') { this.newTrial(); return; }
    if (trial && this.activeProject) { const project = this.activeProject; this.confirmEditorLeave(() => void this.openProject(project, trial)); }
  }
  toggleBefore() { this.previewMode = this.previewMode === 'before' ? 'paint' : 'before'; this.drawCanvas(); }
  downloadPreview() {
    const canvas = this.paintCanvas?.nativeElement;
    if (!canvas || !this.activeProject) return;
    this.drawCanvas();
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${this.activeProject?.title || 'room'}-${this.previewMode === 'before' ? 'original' : 'painted'}.png`; link.click(); URL.revokeObjectURL(link.href);
    }, 'image/png');
  }
  private drawCanvas(target?: HTMLCanvasElement) {
    const canvas = target || this.paintCanvas?.nativeElement;
    if (!canvas || !this.photoReady) { if (!canvas) requestAnimationFrame(() => this.drawCanvas()); return; }
    const width = Math.round(this.photo.naturalWidth * this.imageScale), height = Math.round(this.photo.naturalHeight * this.imageScale);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.clearRect(0, 0, width, height); ctx.drawImage(this.photo, 0, 0, width, height);
    if (this.previewMode !== 'before') {
      this.syncActiveLayer();
      const saved = { mask: this.mask, color: this.color, opacity: this.opacity, appearance: this.appearance, pendingAiMask: this.pendingAiMask };
      for (const layer of this.paintLayers) {
        const hasSelection = layer.mask.brush.some((stroke) => stroke.points.length) || layer.mask.polygons.some((polygon) => polygon.length >= 3) || !!layer.mask.regions?.length || !!layer.mask.ai;
        if (!hasSelection && !(layer.id === this.activeLayerId && saved.pendingAiMask)) continue;
        this.mask = layer.mask; this.opacity = layer.opacity; this.appearance = layer.appearance;
        this.color = this.colors.find((candidate) => candidate._id === layer.colorId) || { _id: layer.colorId || '', name: layer.name, hex: layer.colorHex, brand: 'Custom shade', finishes: [], categories: [] };
        this.pendingAiMask = layer.id === this.activeLayerId ? saved.pendingAiMask : null;
        if (this.color) this.paintTint(ctx, width, height);
      }
      this.mask = saved.mask; this.color = saved.color; this.opacity = saved.opacity; this.appearance = saved.appearance; this.pendingAiMask = saved.pendingAiMask;
    }
    if (this.previewMode !== 'before' && (this.polygonDraft.length || this.tool === 'brush' || this.tool === 'eraser')) this.drawGuides(ctx, width, height);
  }
  private paintTint(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const maskCanvas = document.createElement('canvas'); maskCanvas.width = width; maskCanvas.height = height;
    const maskCtx = maskCanvas.getContext('2d'); if (!maskCtx) return;
    maskCtx.fillStyle = '#fff'; maskCtx.strokeStyle = '#fff'; maskCtx.lineCap = 'round'; maskCtx.lineJoin = 'round';
    if (this.pendingAiMask) this.paintAiMask(this.pendingAiMask, maskCtx, width, height);
    else {
    for (const stroke of this.mask.brush) {
      const pts = stroke.points; if (!pts.length) continue;
      maskCtx.lineWidth = Math.max(3, stroke.size * width);
      maskCtx.beginPath(); maskCtx.moveTo(pts[0].x * width, pts[0].y * height);
      if (pts.length === 1) { maskCtx.lineTo(pts[0].x * width + 0.1, pts[0].y * height + 0.1); }
      else for (const p of pts.slice(1)) maskCtx.lineTo(p.x * width, p.y * height);
      maskCtx.stroke();
    }
    for (const polygon of this.mask.polygons) {
      if (polygon.length < 3) continue;
      maskCtx.beginPath(); maskCtx.moveTo(polygon[0].x * width, polygon[0].y * height);
      for (const p of polygon.slice(1)) maskCtx.lineTo(p.x * width, p.y * height);
      maskCtx.closePath(); maskCtx.fill();
    }
    if (this.mask.regions?.length) this.addColorRegions(ctx, maskCtx, width, height);
    if (this.mask.ai) this.paintAiMask(this.mask.ai, maskCtx, width, height);
    }
    maskCtx.globalCompositeOperation = 'destination-out';
    for (const stroke of (this.drawing && this.tool === 'eraser' ? this.mask.eraser || [] : [])) {
      const pts = stroke.points; if (!pts.length) continue;
      maskCtx.lineWidth = Math.max(3, stroke.size * width);
      maskCtx.beginPath(); maskCtx.moveTo(pts[0].x * width, pts[0].y * height);
      if (pts.length === 1) maskCtx.lineTo(pts[0].x * width + 0.1, pts[0].y * height + 0.1);
      else for (const p of pts.slice(1)) maskCtx.lineTo(p.x * width, p.y * height);
      maskCtx.stroke();
    }
    const original = ctx.getImageData(0, 0, width, height), mask = maskCtx.getImageData(0, 0, width, height);
    const a = this.opacity, primaryTone = this.hexToRgb(this.color!.hex), secondaryTone = this.hexToRgb(this.appearance.secondColor);
    for (let i = 0; i < original.data.length; i += 4) {
      const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
      let selectedColor = this.color!.hex;
      if (this.appearance.dualTone && y / height >= this.appearance.split) selectedColor = this.appearance.secondColor;
      if (this.appearance.pattern === 'stripes' && Math.floor((x + y) / Math.max(18, width / 18)) % 2) continue;
      if (this.appearance.pattern === 'checks' && (Math.floor(x / Math.max(18, width / 18)) + Math.floor(y / Math.max(18, width / 18))) % 2) continue;
      const coverage = mask.data[i + 3] / 255 * a;
      if (coverage <= 0) continue;
      const lum = (0.2126 * original.data[i] + 0.7152 * original.data[i + 1] + 0.0722 * original.data[i + 2]) / 255;
      const tone = selectedColor === this.appearance.secondColor ? secondaryTone : primaryTone;
      const finishTexture = this.appearance.finish === 'gloss' ? 0.86 + lum * 0.28 : this.appearance.finish === 'satin' ? 0.91 + lum * 0.18 : this.appearance.finish === 'matte' ? 0.78 + lum * 0.32 : 0.84 + lum * 0.28;
      const shade = (0.48 + lum * 0.72) * finishTexture * this.appearance.lighting * this.appearance.calibration;
      original.data[i] = original.data[i] * (1 - coverage) + Math.min(255, tone.r * shade) * coverage;
      original.data[i + 1] = original.data[i + 1] * (1 - coverage) + Math.min(255, tone.g * shade) * coverage;
      original.data[i + 2] = original.data[i + 2] * (1 - coverage) + Math.min(255, tone.b * shade) * coverage;
    }
    ctx.putImageData(original, 0, 0);
  }
  private drawGuides(ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (this.drawing && this.tool === 'eraser' && this.mask.eraser?.length) {
      const stroke = this.mask.eraser[this.mask.eraser.length - 1];
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, stroke.size * width);
      ctx.beginPath(); ctx.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
      if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * width + .1, stroke.points[0].y * height + .1);
      else stroke.points.slice(1).forEach((point) => ctx.lineTo(point.x * width, point.y * height));
      ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, width / 500); ctx.setLineDash([8, 5]);
    for (const polygon of this.mask.polygons) {
      if (!polygon.length) continue; ctx.beginPath(); ctx.moveTo(polygon[0].x * width, polygon[0].y * height);
      polygon.slice(1).forEach((p) => ctx.lineTo(p.x * width, p.y * height)); ctx.closePath(); ctx.stroke();
    }
    if (this.polygonDraft.length) {
      ctx.beginPath(); ctx.moveTo(this.polygonDraft[0].x * width, this.polygonDraft[0].y * height);
      this.polygonDraft.slice(1).forEach((p) => ctx.lineTo(p.x * width, p.y * height)); ctx.stroke();
    }
    ctx.restore();
  }
  private addColorRegions(sourceCtx: CanvasRenderingContext2D, maskCtx: CanvasRenderingContext2D, width: number, height: number) {
    const source = sourceCtx.getImageData(0, 0, width, height), result = maskCtx.getImageData(0, 0, width, height);
    const pixelCount = width * height;
    if (!this.labCache || this.labCache.photo !== this.photo || this.labCache.width !== width || this.labCache.height !== height) {
      const lab = new Float32Array(pixelCount * 3);
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        const offset = pixel * 4;
        const r = this.linearChannel(source.data[offset] / 255), g = this.linearChannel(source.data[offset + 1] / 255), b = this.linearChannel(source.data[offset + 2] / 255);
        const x = (r * .4124564 + g * .3575761 + b * .1804375) / .95047;
        const y = (r * .2126729 + g * .7151522 + b * .072175) / 1;
        const z = (r * .0193339 + g * .119192 + b * .9503041) / 1.08883;
        const fx = this.labPivot(x), fy = this.labPivot(y), fz = this.labPivot(z), dest = pixel * 3;
        lab[dest] = 116 * fy - 16; lab[dest + 1] = 500 * (fx - fy); lab[dest + 2] = 200 * (fy - fz);
      }
      this.labCache = { photo: this.photo, width, height, data: lab };
    }
    const lab = this.labCache.data, visited = new Uint8Array(pixelCount), queue = new Int32Array(pixelCount), tolerance = this.autoTolerance, neighborSteps = [-1, 1, -width, width];
    const edgeTolerance = Math.max(9, tolerance * .62), toleranceSq = tolerance * tolerance, edgeToleranceSq = edgeTolerance * edgeTolerance;
    for (const seed of this.mask.regions || []) {
      visited.fill(0);
      const sx = Math.max(0, Math.min(width - 1, Math.round(seed.x * (width - 1)))), sy = Math.max(0, Math.min(height - 1, Math.round(seed.y * (height - 1))));
      const seedPixel = sy * width + sx, seedLab = seedPixel * 3;
      let head = 0, tail = 0; const start = sy * width + sx; queue[tail++] = start; visited[start] = 1;
      while (head < tail) {
        const pixel = queue[head++], offset = pixel * 4, labOffset = pixel * 3, x = pixel % width, y = (pixel / width) | 0;
        const sdL = lab[labOffset] - lab[seedLab], sdA = lab[labOffset + 1] - lab[seedLab + 1], sdB = lab[labOffset + 2] - lab[seedLab + 2];
        if (sdL * sdL + sdA * sdA + sdB * sdB > toleranceSq) continue;
        result.data[offset + 3] = 255;
        for (const step of neighborSteps) {
          if ((step === -1 && x === 0) || (step === 1 && x === width - 1) || (step === -width && y === 0) || (step === width && y === height - 1)) continue;
          const next = pixel + step;
          if (visited[next]) continue;
          const no = next * 3, dl = lab[no] - lab[labOffset], da = lab[no + 1] - lab[labOffset + 1], db = lab[no + 2] - lab[labOffset + 2];
          const seedDl = lab[no] - lab[seedLab], seedDa = lab[no + 1] - lab[seedLab + 1], seedDb = lab[no + 2] - lab[seedLab + 2];
          if (seedDl * seedDl + seedDa * seedDa + seedDb * seedDb <= toleranceSq && dl * dl + da * da + db * db <= edgeToleranceSq) { visited[next] = 1; queue[tail++] = next; }
        }
      }
    }
    maskCtx.putImageData(result, 0, 0);
  }
  private linearChannel(value: number) { return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4); }
  private labPivot(value: number) { return value > .008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116; }
  private hexToRgb(hex: string) { const value = hex.replace('#', ''); return { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16) }; }
  trackById(_index: number, item: { _id: string }) { return item._id; }
  setView(view: 'home' | 'saved') { this.view = view; this.activeProject = null; this.error = ''; }
  humanDate(date: string) { return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date)); }
  async refreshProjects() { await this.loadHome(); }
  dismissNotice(event: Event) { (event.currentTarget as HTMLElement).parentElement?.remove(); }
  cancelUpload() { this.uploadDialog = false; this.uploadPendingFile = null; if (this.uploadPreviewUrl) URL.revokeObjectURL(this.uploadPreviewUrl); this.uploadPreviewUrl = ''; }
}
