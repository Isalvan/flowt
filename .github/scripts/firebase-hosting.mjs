import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const webVariables = [
  'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID',
];
const accountVariable = 'FIREBASE_SERVICE_ACCOUNT_FLOWT_63536';

export function validateWebConfig(env, projectId) {
  const missing = webVariables.filter(name => !env[name]?.trim());
  if (missing.length) throw new Error(`Configura estas Repository Variables en GitHub: ${missing.join(', ')}`);
  if (webVariables.some(name => env[name] !== env[name].trim() || /^(tu_|\.\.\.)/.test(env[name]))) {
    throw new Error('La configuración web contiene espacios o valores de ejemplo. Copia el SDK real desde Firebase.');
  }
  if (env.VITE_FIREBASE_PROJECT_ID !== projectId) throw new Error('VITE_FIREBASE_PROJECT_ID no coincide con el proyecto de .firebaserc.');
  if (!/^AIza[\w-]{35}$/.test(env.VITE_FIREBASE_API_KEY)) throw new Error('VITE_FIREBASE_API_KEY no tiene el formato esperado.');
  if (!/^[\w.-]+$/.test(env.VITE_FIREBASE_AUTH_DOMAIN)) throw new Error('VITE_FIREBASE_AUTH_DOMAIN debe ser un dominio sin https://.');
  if (!env.VITE_FIREBASE_APP_ID.startsWith(`1:${env.VITE_FIREBASE_MESSAGING_SENDER_ID}:web:`)) {
    throw new Error('VITE_FIREBASE_APP_ID y VITE_FIREBASE_MESSAGING_SENDER_ID no corresponden a la misma aplicación.');
  }
}

export function validateServiceAccount(env, projectId) {
  if (!env[accountVariable]) throw new Error(`Configura el secret ${accountVariable} con el JSON de la cuenta de despliegue.`);
  let account;
  try { account = JSON.parse(env[accountVariable]); }
  catch { throw new Error(`El secret ${accountVariable} debe contener JSON, no base64.`); }
  if (account?.type !== 'service_account' || account.project_id !== projectId ||
      typeof account.client_email !== 'string' || !account.client_email.endsWith('.iam.gserviceaccount.com') ||
      typeof account.private_key !== 'string' || !account.private_key.startsWith('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('La cuenta de despliegue no es válida o pertenece a otro proyecto.');
  }
  return account;
}

const runFirebase = (args, env) => spawnSync(process.execPath, [
  resolve('node_modules/firebase-tools/lib/bin/firebase.js'), ...args,
], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });

export function deployHosting({ env, projectId, channel, run = runFirebase }) {
  validateWebConfig(env, projectId);
  const account = validateServiceAccount(env, projectId);
  if (channel !== 'live' && !/^pr-[1-9]\d*$/.test(channel)) throw new Error('Canal de Hosting no válido.');
  if (!existsSync('dist/index.html')) throw new Error('Falta dist/index.html; compila antes de desplegar.');
  const dir = mkdtempSync(join(tmpdir(), 'flowt-hosting-'));
  const credentials = join(dir, 'credentials.json');
  try {
    writeFileSync(credentials, JSON.stringify(account), { mode: 0o600 });
    const childEnv = { ...env, GOOGLE_APPLICATION_CREDENTIALS: credentials, FIREBASE_DEPLOY_AGENT: 'flowt-github-actions' };
    delete childEnv[accountVariable];
    const args = channel === 'live'
      ? ['deploy', '--only', 'hosting']
      : ['hosting:channel:deploy', channel, '--expires', '7d', '--no-authorized-domains'];
    const result = run([...args, '--project', projectId, '--non-interactive', '--json'], childEnv);
    if (result.error || result.status !== 0) throw new Error('Firebase Hosting no se ha desplegado. Revisa los permisos de la cuenta y el error de Firebase.');
    let response;
    try { response = JSON.parse(result.stdout); }
    catch { throw new Error('Firebase devolvió una respuesta de despliegue no válida.'); }
    if (response.status !== 'success') throw new Error('Firebase no confirmó el despliegue.');
    const hosting = Array.isArray(response.result?.hosting) ? response.result.hosting[0] : response.result?.hosting;
    const site = typeof hosting === 'string' ? /^sites\/([\w-]+)\/versions\/[^/]+$/.exec(hosting)?.[1] : undefined;
    const url = channel === 'live'
      ? (site ? `https://${site}.web.app` : hosting)
      : Object.values(response.result)[0]?.url;
    if (typeof url !== 'string' || !/^https:\/\/[\w.-]+\.(web\.app|firebaseapp\.com)\/?$/.test(url)) {
      throw new Error('Firebase no devolvió una URL de Hosting válida.');
    }
    return url;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function main() {
  const projectId = JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default;
  if (!projectId) throw new Error('Configura projects.default en .firebaserc.');
  if (process.argv[2] === 'check-config') {
    validateWebConfig(process.env, projectId);
    console.log('Configuración de Firebase validada.');
  } else if (process.argv[2] === 'deploy') {
    const channel = process.env.FIREBASE_HOSTING_CHANNEL;
    const url = deployHosting({ env: process.env, projectId, channel });
    const summary = `### Flowt publicado\n\n[${channel === 'live' ? 'Abrir Flowt' : 'Abrir preview'}](${url})\n\nCanal: ${channel}. Solo Firebase Hosting.\n`;
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    if (channel !== 'live') {
      writeFileSync(join(process.env.RUNNER_TEMP || tmpdir(), 'flowt-preview-comment.md'),
        `**Preview de Flowt:** ${url}\n\nCaduca en 7 días. Esta preview usa el proyecto de Firebase de producción; para probar la interfaz con datos ficticios, utiliza el modo demo.\n`);
    }
    console.log(`Hosting publicado: ${url}`);
  } else { throw new Error('Usa check-config o deploy.'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
