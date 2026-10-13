# Stillroom — Smart Wall Paint Visualizer

A web-only MEAN stack app for testing paint colours on photos of your own rooms. It includes prompt-based AI wall/object segmentation with manual mask tools, a live colour preview, saved trials, PNG export, palette administration, account management, and usage analytics.

## Requirements

- Node.js 20.19 or newer (Node 24 is supported)
- npm
- A MongoDB Atlas database and connection string
- A Cloudinary account for room-photo storage

## Local setup

1. From this directory, install both applications:

   ```sh
   npm run install:all
   ```

2. Create a MongoDB Atlas cluster and database user with read/write access only to the app database. Add your development IP to Atlas Network Access. Copy the Atlas connection string and replace its database name and URL-encode any special characters in the username/password.

3. In Cloudinary, open the **Dashboard** and copy your **Cloud name**, **API Key**, and **API Secret**. Treat the API Secret like a password; do not paste it into Angular/client settings or commit it to Git.
4. Copy `server/.env.example` to `server/.env` (PowerShell: `Copy-Item server/.env.example server/.env`). Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and set that as `JWT_SECRET`. Set `MONGODB_URI`, the three Cloudinary values (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`), a unique `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters. Keep `.env` out of version control. For local development, the app-origin and cookie defaults work at `localhost:4200` and `localhost:4000`.

5. Seed the administrator and starter colour palette:

   ```sh
   npm run seed:admin
   ```

6. Start the API and Angular app in separate terminals:

   ```sh
   npm run dev:server
   npm run dev:client
   ```

7. Open [http://localhost:4200](http://localhost:4200) and sign in with the seeded administrator account, or create a member account.

The API listens on `http://localhost:4000`; `/api/health` reports only whether the service is alive. The Angular development proxy forwards relative `/api` requests to the local API at port 4000. Room photos upload to your Cloudinary account as authenticated assets; MongoDB stores only their Cloudinary identifier and project details. The API checks project ownership before it retrieves a photo and proxies image bytes to the browser. Set `MAX_UPLOAD_MB` to change the image size limit, `UPLOADS_PER_HOUR` to change the per-IP upload limit (default 10), and `CLIENT_ORIGIN` to a comma-separated list of exact browser origins if needed.

## Deploy the client to Vercel and the API to Render

These deployment files are included: `client/vercel.json` configures the Angular production build, forwards `/api` requests to `https://still-room-ar37.onrender.com`, and provides the SPA fallback; the root `render.yaml` describes the Express web service. Angular uses relative `/api` paths in both local development and production, so no API URL variable is needed in Vercel.

### 1. Push the project to GitHub

Push the project folder to a GitHub repository. Confirm `server/.env` is not committed; secrets belong in Render's environment settings.

### 2. Get Cloudinary credentials

1. Sign in to Cloudinary and open the **Dashboard**. Find **Cloud name**, **API Key**, and **API Secret** (the secret may be hidden until you reveal it).
2. Keep the API Secret private. You will add all three values to Render in the next step; never put them in Vercel or in a `client` file.

### 3. Deploy Express on Render

1. In Render, create a **Blueprint** from the GitHub repository and use its root `render.yaml`, or create a Node web service manually with **Root Directory** `server`, **Build Command** `npm ci`, **Start Command** `npm start`, and **Health Check Path** `/api/health`.
2. During Blueprint setup, provide your three Cloudinary values (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`) when Render asks for them. They are required before the API can start. Also set `MONGODB_URI` to the production Atlas connection string, `CLIENT_ORIGIN` to your exact Vercel site origin (`https://smart-wall-paint-visualizer-tau.vercel.app`), and supply a unique `ADMIN_EMAIL` and `ADMIN_PASSWORD` of at least 12 characters. The Blueprint generates `JWT_SECRET`; retain it in Render and do not rotate it casually because rotation signs everyone out. Keep `NODE_ENV=production`, `COOKIE_SAME_SITE=Strict`, and `TRUST_PROXY=1` (the Blueprint includes these Render settings). Requests stay on the Vercel origin in the browser while Vercel proxies them to Render, so the existing Secure, HttpOnly, SameSite cookies remain same-site.
3. Deploy and confirm the API is available at `https://still-room-ar37.onrender.com`. `render.yaml` uses the Render-provided `PORT` and binds Express to `0.0.0.0`.
4. In MongoDB Atlas, allow connections from the Render service's outbound IP addresses where available. Use a dedicated database user with access only to this app's database. A broad `0.0.0.0/0` Atlas allowlist is less restrictive and should be avoided when your Render plan exposes addresses you can allowlist.

### 4. Check the Cloudinary connection

1. In Render, open your API service, then **Environment**, and confirm those three Cloudinary values are saved. If you created a manual service rather than a Blueprint, add them here before deploying.
2. Keep `MAX_UPLOAD_MB=20` and `UPLOADS_PER_HOUR=10` or change them to your needs. The API accepts JPG/PNG, verifies the file signature, requires photo ownership confirmation, and limits authenticated uploads to 10 per IP per hour by default. The limiter is per running API process; for a scaled multi-instance production service, use a shared rate-limit store.
3. Save any changes and redeploy/restart the Render service. Its health endpoint should return `{"ok":true}`. The API uploads room photos directly to Cloudinary using private authenticated delivery, and streams them back only after checking the logged-in user's project access. Deleting a room also deletes its Cloudinary image.

### 5. Deploy Angular on Vercel

1. Import the same GitHub repository as a Vercel project and set **Root Directory** to `client`.
2. `client/vercel.json` builds Angular into `dist/smart-wall-visualizer/browser`, forwards `/api` to Render while preserving the API path, and falls back to `index.html` for frontend routes. No API URL environment variable is needed.
3. The Vercel website URL is `https://smart-wall-paint-visualizer-tau.vercel.app`. If Vercel assigned a different production domain or you use a custom domain, set Render's `CLIENT_ORIGIN` to that exact origin and redeploy the API. To use preview deployments, add their exact origins to Render's comma-separated `CLIENT_ORIGIN` temporarily.
4. Verify the API through `https://smart-wall-paint-visualizer-tau.vercel.app/api/health`; expect `{"ok":true}`. Then test register/login and upload on the Vercel website. The browser sends the same-origin session and CSRF cookies to Vercel, whose rewrite forwards the requests to Render.

### 6. Seed the administrator

After Render and Atlas are connected, run `npm run seed:admin` once using the production `MONGODB_URI`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` values from Render. You can run this from a trusted local checkout with those values temporarily set in `server/.env`, or from Render's Shell if available. Do not add production credentials to GitHub, and do not run the seed command on each deployment; it is a one-time setup (safe to rerun for the same administrator account and starter colours).

### Image storage

Images are stored in the Cloudinary account configured on the Render API, rather than Render's temporary filesystem. MongoDB stores the Cloudinary asset identifier and project metadata. Check your Cloudinary plan's storage and bandwidth limits in its dashboard. Vercel serves the frontend only and does not store uploaded photos.

### Verify the deployment

- Open `https://smart-wall-paint-visualizer-tau.vercel.app/api/health`; expect `{"ok":true}`.
- Register a member and sign in. If sign-in fails, check that Vercel's `/api` rewrite reaches Render and Render `CLIENT_ORIGIN` exactly matches your site origin.
- Upload a JPG/PNG, refresh, open the room, save a paint trial, and check the admin screen using the seeded administrator.
- If API calls return CORS errors, check that Render `CLIENT_ORIGIN` exactly matches the browser's production origin (scheme and hostname, no path or trailing slash). If Vercel returns a 404/502, check both `/api` rewrite destinations and the Render service logs.

### Roles and palette access

- New registrations receive the `user` role and can use every active palette colour.
- The seeded administrator has the `admin` role and can manage palette shades, users, projects, and analytics. Use the admin screen to promote or demote other accounts; never expose an admin password in a browser or shared computer.

The API applies a general 180-request/minute per-IP limit, 12 sign-in attempts per 15 minutes, 6 registrations per hour, and 10 authenticated image uploads per IP per hour by default. Limits return HTTP 429 with retry information. They are in-memory per API process; production must enforce shared limits at the edge or with Redis before running multiple replicas.

## Main flows

- Register or sign in with email and password. Passwords are hashed with bcrypt. A 12-hour JWT is stored in an HttpOnly, SameSite cookie; session state is checked against MongoDB.
- Upload a JPG or PNG after confirming you own the image or have permission to use it. The server checks both declared type and file signature.
- Select walls or objects with AI segmentation by entering a prompt such as `wall`, `sofa`, `curtains`, or `window`. The first use opens a consent/download dialog for the CLIPSeg model files. The model runs locally in the browser through Transformers.js; the room photo stays on the device and there are no per-image API calls or inference fees. Downloads are cached by the browser and show file progress. Internet is needed for the first download or if the browser evicts its cache. Review and apply or discard each AI mask, then refine with brush, erasable/protected strokes, polygon, and eraser. Adjust confidence to trade coverage for precision. Older saved colour-region masks remain viewable.
- Use **Add wall** to create up to 12 independently editable areas in one trial. Each area remembers its own mask, paint colour, opacity, lighting, calibration, finish, pattern, and dual-tone settings. Select a wall area before drawing or changing its controls; switching back restores its settings. Existing saved single-colour trials load as one wall area.
- Leaving the editor or switching paint trials with unsaved edits opens a save/discard/stay prompt. Closing or refreshing the browser with unsaved work also triggers the browser’s built-in warning.
- The editor sidebar lists every tool and highlights the active one. Save changes is available beside the fixed canvas; Ctrl+S also saves. The image panel stays in view while the tools scroll and can be opened fullscreen with an exit control. Use zoom-to-point, zoom controls, or Ctrl+scroll to magnify and scrollbars to pan. Undo reverses recent selection, colour, and appearance edits; Ctrl+Z works too.
- Tune the preview with room-lighting and display-calibration controls, choose matte, eggshell, satin, or gloss finish, and apply stripe/check patterns or a two-tone split. These are visual approximations intended for comparison; display settings and real room lighting still affect perceived paint colour.
- Save multiple paint trials for one photo, switch between them, submit an optional 1–5 satisfaction rating, and download the current preview as PNG.
- Admins can add, edit, and permanently delete paint shades, inspect accounts and recent room uploads, change member/admin roles, and view metrics. Deleting a shade removes it from the palette; saved trials retain their recorded colour values. Analytics refresh automatically every minute while the admin screen is open.
- All signed-in members can use every active colour, including shades created by admins. Role checks protect admin endpoints. The server validates primary and dual-tone colours against the active palette when a trial is saved.
- Room cards let owners download the original upload or permanently delete the room and source image. Saved designs can be exported as painted PNGs or deleted individually.

## API overview

All API routes are under `/api`. Authenticated routes use the HttpOnly session cookie; unsafe requests also need the CSRF token returned by `GET /auth/csrf` in the `X-CSRF-Token` header. Angular handles these automatically.

| Route | Purpose |
| --- | --- |
| `GET /auth/csrf`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | CSRF bootstrap, accounts and sign-in |
| `POST /auth/session/ping`, `POST /auth/session/end` | Session activity tracking |
| `GET /projects`, `POST /projects/upload`, `GET /projects/:id` | Owned rooms and uploads |
| `GET /projects/:id/image` | Owner-checked image access; admins can inspect room thumbnails |
| `PUT /projects/:id/trials/:trialId` | Save or update a paint trial |
| `DELETE /projects/:id/trials/:trialId` | Delete an owned saved design |
| `POST /projects/:id/trials/:trialId/feedback` | Save a satisfaction rating |
| `GET /colors`, `POST /colors`, `PATCH /colors/:id`, `DELETE /colors/:id` | Paint palette; writes require admin |
| `GET /admin/users`, `PATCH /admin/users/:id/role`, `GET /admin/projects`, `GET /admin/analytics` | Admin operations |

Project documents store owner, room photo metadata and trials with up to 12 independently coloured wall layers. Each layer stores normalized brush/polygon points or a compact AI segmentation mask and its own appearance settings. Original image files are stored on the API server’s local filesystem and are served only through the authenticated owner/admin image route. MongoDB stores user accounts, project/trial data, paint colors, and session records.

## Production notes

This project is configured for local development and is not a security certification or turnkey production deployment. Before production:

- Set `NODE_ENV=production`, use a unique secret from a cryptographic generator for `JWT_SECRET`, exact HTTPS `CLIENT_ORIGIN` entries, and HTTPS hosting. Serve Angular and the API on one origin where possible, routing `/api` to Express at the edge. Keep secrets in the hosting platform's secret manager, rotate them if exposed, and never commit `.env`.
- Cookies default to `SameSite=Strict` and `Secure` in production. Keep frontend and API on the same site when possible. If they must be cross-site, set `COOKIE_SAME_SITE=None` only with HTTPS on both, and configure exact CORS origins. Never use wildcard origins with credentialed cookies.
- Set `TRUST_PROXY` only to the exact trusted proxy hop/IP configuration for your host; incorrect proxy trust makes IP-based rate limits spoofable. The included in-memory rate limiter protects a single API process only. Put a shared Redis or managed WAF/API gateway limiter in front of production and share limits across replicas.
- Use a dedicated least-privilege Atlas database user, network allowlisting, TLS, automated backups, and tested restore procedures. Restrict filesystem access to the private media directory; use durable private object storage if instances are ephemeral. Apply upload malware scanning and retention policies appropriate to your deployment.
- Add production monitoring, dependency update/scanning, incident response, privacy/retention notices, and deployment-specific security review. Do not expose stack traces or database credentials in logs.

The preview cannot calibrate a physical monitor or reproduce actual paint sheen. Pattern rendering and dual-tone splits are simplified screen previews.

### Optional AI wall and object detection

The editor uses [`Xenova/clipseg-rd64-refined`](https://huggingface.co/Xenova/clipseg-rd64-refined), an ONNX-compatible CLIPSeg segmentation model, with [Transformers.js](https://huggingface.co/docs/transformers.js/en/pipelines) in the browser. The first-use dialog obtains model files from the public Hugging Face Hub only after the user chooses to continue. The runtime caches model files in the browser Cache API; no inference endpoint, API key, model server, or paid request quota is required. First load needs internet and can take time; subsequent loads normally use that browser cache. Inference uses client CPU/WASM and can be slower on low-memory devices. Auto-generated masks are suggestions and should be reviewed and corrected with the included manual tools. The app does not claim pixel-perfect accuracy for every photo.
