# Stillroom — Smart Wall Paint Visualizer

A web-only MEAN stack app for testing paint colours on photos of your own rooms. It includes prompt-based AI wall/object segmentation with manual mask tools, a live colour preview, saved trials, PNG export, palette administration, account management, and usage analytics.

## Requirements

- Node.js 20.19 or newer (Node 24 is supported)
- npm
- A MongoDB Atlas database and connection string

## Local setup

1. From this directory, install both applications:

   ```sh
   npm run install:all
   ```

2. Create a MongoDB Atlas cluster and database user with read/write access only to the app database. Add your development IP to Atlas Network Access. Copy the Atlas connection string and replace its database name and URL-encode any special characters in the username/password.

3. Copy `server/.env.example` to `server/.env` (PowerShell: `Copy-Item server/.env.example server/.env`). Generate a secret with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and set that as `JWT_SECRET`. Set `MONGODB_URI`, a unique `ADMIN_EMAIL`, and an `ADMIN_PASSWORD` of at least 12 characters. Keep `.env` out of version control. For local development, the app-origin and cookie defaults work at `localhost:4200` and `localhost:4000`.

4. Seed the administrator and starter colour palette:

   ```sh
   npm run seed:admin
   ```

5. Start the API and Angular app in separate terminals:

   ```sh
   npm run dev:server
   npm run dev:client
   ```

6. Open [http://localhost:4200](http://localhost:4200) and sign in with the seeded administrator account, or create a member account.

The API listens on `http://localhost:4000`; `/api/health` reports only whether the service is alive. The Angular dev server proxies `/api` to port 4000 so the browser can use secure same-site cookies without cross-origin auth. Uploaded images go to `server/media` by default; `MEDIA_DIR` can point to another persistent local directory. Set `MAX_UPLOAD_MB` to change the upload limit and `CLIENT_ORIGIN` to a comma-separated list of exact browser origins if needed.

### Roles and palette access

- New registrations receive the `user` role and can use every active palette colour.
- The seeded administrator has the `admin` role and can manage palette shades, users, projects, and analytics. Use the admin screen to promote or demote other accounts; never expose an admin password in a browser or shared computer.

The API applies a general 180-request/minute per-IP limit, 12 sign-in attempts per 15 minutes, and 6 registrations per hour. Limits return HTTP 429 with retry information. They are in-memory per API process; production must enforce shared limits at the edge or with Redis before running multiple replicas.

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
