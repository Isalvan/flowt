// Copia flowt.config.json a todos los archivos que necesitan esos valores escritos tal cual
// (reglas de Firestore, CSP, Worker, app Android...). Así la configuración de una instalación
// vive en un solo sitio.
//
//   node scripts/apply-config.mjs           aplica la configuración
//   node scripts/apply-config.mjs --check   solo comprueba que todo está sincronizado (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONFIG_FILE = 'flowt.config.json';

export function readConfig(root = '.') {
  return JSON.parse(readFileSync(resolve(root, CONFIG_FILE), 'utf8'));
}

export function validateConfig(config) {
  const errors = [];
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.firebaseProjectId ?? '')) errors.push('firebaseProjectId no es un ID de proyecto de Firebase válido.');
  if (!/^[a-z0-9-]+$/.test(config.firestoreLocation ?? '')) errors.push('firestoreLocation debe ser una ubicación de Firestore, por ejemplo eur3 o nam5.');
  if (!/^https:\/\/[\w.-]+$/.test(config.appUrl ?? '')) errors.push('appUrl debe ser https://dominio, sin barra final.');
  if (config.workerUrl !== '' && !/^https:\/\/[\w.-]+$/.test(config.workerUrl ?? '')) errors.push('workerUrl debe estar vacío o ser https://dominio, sin barra final.');
  if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(config.androidAppId ?? '')) errors.push('androidAppId debe ser un paquete Java, por ejemplo com.tunombre.flowt.');
  if (!Array.isArray(config.allowedUids) || config.allowedUids.some((uid) => !/^[A-Za-z0-9]{1,128}$/.test(uid))) {
    errors.push('allowedUids debe ser una lista de UIDs de Firebase.');
  }
  if (errors.length) throw new Error(`${CONFIG_FILE} no es válido:\n- ${errors.join('\n- ')}`);
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const uidList = (uids) => `[${uids.map((uid) => JSON.stringify(uid)).join(', ')}]\n`;

function replaceOnce(text, pattern, replacement, what) {
  if (!pattern.test(text)) throw new Error(`No encuentro ${what}; ¿se ha cambiado el formato del archivo?`);
  return text.replace(pattern, replacement);
}

// The Worker origin goes right after 'self' in connect-src; everything else stays as it is.
const CSP_CONNECT = /(connect-src 'self')(.*?)( https:\/\/\*\.firebaseio\.com)/;
const withWorker = (csp, workerUrl) =>
  replaceOnce(csp, CSP_CONNECT, `$1${workerUrl ? ` ${workerUrl}` : ''}$3`, 'connect-src en la CSP');

/** Each target rewrites one file from the config. They must be no-ops when already in sync. */
export const targets = [
  ['.firebaserc', (text, c) => {
    const rc = JSON.parse(text);
    rc.projects = { ...rc.projects, default: c.firebaseProjectId };
    return json(rc);
  }],
  ['firebase.json', (text, c) => {
    const fb = JSON.parse(text);
    fb.firestore.location = c.firestoreLocation;
    for (const rule of fb.hosting.headers) {
      for (const header of rule.headers) {
        if (header.key === 'Content-Security-Policy') header.value = withWorker(header.value, c.workerUrl);
      }
    }
    return json(fb);
  }],
  ['index.html', (text, c) => withWorker(text, c.workerUrl)],
  ['wrangler.json', (text, c) => {
    const wrangler = JSON.parse(text);
    wrangler.vars = { ...wrangler.vars, FIREBASE_PROJECT_ID: c.firebaseProjectId, APP_URL: c.appUrl };
    return json(wrangler);
  }],
  ['firestore.rules', (text, c) => replaceOnce(text,
    /(function isAllowedUser\(\) \{\s*return request\.auth\.uid in )\[[^\]]*\]/,
    `$1[${c.allowedUids.map((uid) => `'${uid}'`).join(', ')}]`, 'isAllowedUser() en firestore.rules')],
  ['src/shared/allowedUids.json', (_text, c) => uidList(c.allowedUids)],
  ['tracker-backend/prompts/allowed_uids.json', (_text, c) => uidList(c.allowedUids)],
  ['capacitor.config.ts', (text, c) => {
    const withId = replaceOnce(text, /appId: '[^']*'/, `appId: '${c.androidAppId}'`, 'appId en capacitor.config.ts');
    return replaceOnce(withId, /hostname: '[^']*'/, `hostname: '${new URL(c.appUrl).host}'`, 'hostname en capacitor.config.ts');
  }],
  ['android/app/build.gradle', (text, c) =>
    replaceOnce(text, /applicationId "[^"]*"/, `applicationId "${c.androidAppId}"`, 'applicationId en build.gradle')],
  ['.github/workflows/firebase-hosting-merge.yml', (text, c) =>
    replaceOnce(text, /(name: production\n\s+url: ).*/, `$1${c.appUrl}`, 'la URL del environment production')],
  ['public/landing/index.html', (text, c) =>
    replaceOnce(text, /content="https:\/\/[^"/]+\/landing\//g, `content="${c.appUrl}/landing/`, 'og:url en la landing')],
];

/** Returns the files whose content differs from the config; writes them unless `check`. */
export function applyConfig({ root = '.', check = false, config = readConfig(root) } = {}) {
  validateConfig(config);
  const changed = [];
  for (const [file, transform] of targets) {
    const path = resolve(root, file);
    const before = readFileSync(path, 'utf8');
    const after = transform(before, config);
    if (after === before) continue;
    changed.push(file);
    if (!check) writeFileSync(path, after);
  }
  return changed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const check = process.argv.includes('--check');
  try {
    const changed = applyConfig({ check });
    if (check && changed.length) {
      console.error(`Estos archivos no coinciden con ${CONFIG_FILE}:\n  ${changed.join('\n  ')}\nEjecuta: npm run config:apply`);
      process.exitCode = 1;
    } else if (check) {
      console.log(`Todo coincide con ${CONFIG_FILE}.`);
    } else {
      console.log(changed.length ? `Actualizado:\n  ${changed.join('\n  ')}` : `Nada que cambiar: todo coincide con ${CONFIG_FILE}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
