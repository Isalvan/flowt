#!/usr/bin/env node
// Asistente de instalación de Flowt: npm run setup
//
// Monta una copia propia de Flowt paso a paso: proyecto de Firebase, web publicada, tu cuenta
// como única permitida y, si quieres, el lector de tickets (Cloudflare + Gemini), la app de
// Android, el despliegue automático desde GitHub y el lector de correos del banco.
// Se puede volver a ejecutar: lo que ya esté hecho se detecta y se puede saltar.
// La guía para personas está en docs/INSTALAR.md.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { applyConfig, readConfig, CONFIG_FILE } from './apply-config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const isWin = process.platform === 'win32';
const WORK = '.flowt-setup'; // credenciales locales; está en .gitignore
const STATE_FILE = join(WORK, 'estado.json');
const SERVICE_ACCOUNT = join(WORK, 'cuenta-de-servicio.json');
const KEYSTORE = join(WORK, 'flowt.jks');
const FIREBASE_BIN = join('node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js');
const WRANGLER = 'wrangler@4';
const WEB_KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID'];
const ORIGINAL_PROJECT = 'flowt-63536';

// ───────────────────────── utilidades de consola ─────────────────────────

const bold = (text) => (process.stdout.isTTY ? `\x1b[1m${text}\x1b[0m` : text);
const green = (text) => (process.stdout.isTTY ? `\x1b[32m${text}\x1b[0m` : text);
const yellow = (text) => (process.stdout.isTTY ? `\x1b[33m${text}\x1b[0m` : text);
const red = (text) => (process.stdout.isTTY ? `\x1b[31m${text}\x1b[0m` : text);
const ok = (text) => console.log(green(`✔ ${text}`));
const warn = (text) => console.log(yellow(`! ${text}`));
const info = (text) => console.log(`  ${text}`);

let stepNumber = 0;
function title(text) {
  stepNumber += 1;
  console.log(`\n${bold(`━━ Paso ${stepNumber}. ${text} ━━`)}`);
}

class Stop extends Error {}

async function ask(question, fallback = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${bold('?')} ${question}${fallback ? ` [${fallback}]` : ''}: `)).trim();
    return answer || fallback;
  } finally { rl.close(); }
}

async function yes(question, byDefault = true) {
  const answer = (await ask(`${question} (${byDefault ? 'S/n' : 's/N'})`)).toLowerCase();
  return answer ? answer.startsWith('s') || answer.startsWith('y') : byDefault;
}

const pause = (text = 'Pulsa Intro cuando lo tengas') => ask(text);

function openUrl(url) {
  console.log(`  ${bold('Abre:')} ${url}`);
  const [cmd, args] = isWin ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* se ve el enlace */ }
}

/** Path pasted or dragged into the terminal, without quotes. */
async function askFile(question) {
  for (;;) {
    const raw = await ask(question);
    // Dragging a file into PowerShell pastes & 'C:\ruta\archivo.json'.
    const path = raw.replace(/^&\s*/, '').replace(/^['"]|['"]$/g, '').trim();
    if (path && existsSync(path)) return path;
    warn('No encuentro ese archivo. Puedes arrastrarlo a esta ventana para pegar su ruta.');
  }
}

// ───────────────────────── ejecutar comandos ─────────────────────────

const quote = (arg) => (isWin && /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);

/** Runs a command. `show` lets the person see and answer it; otherwise output is captured. */
function run(cmd, args, { show = false, input, allowFail = false, cwd } = {}) {
  // npm and npx are .cmd launchers on Windows and only start through the shell.
  const needsShell = isWin && ['npm', 'npx'].includes(cmd);
  const result = spawnSync(cmd, needsShell ? args.map(quote) : args, {
    cwd, input, shell: needsShell, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: show ? (input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit']) : ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) {
    if (allowFail) return result;
    throw new Error(`No se pudo ejecutar ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFail) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(-8).join('\n');
    const shown = cmd === process.execPath ? `firebase ${args.slice(1).join(' ')}` : `${cmd} ${args.join(' ')}`;
    throw new Error(`Falló: ${shown}${detail ? `\n${detail}` : ''}`);
  }
  return result;
}

/** Like run with output visible, but also returns what was printed (for wrangler deploy). */
function runTee(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const needsShell = isWin && ['npm', 'npx'].includes(cmd);
    const child = spawn(cmd, needsShell ? args.map(quote) : args, { shell: needsShell, stdio: ['inherit', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (status) => (status === 0 ? resolvePromise(output) : reject(new Error(`Falló: ${cmd} ${args.join(' ')}`))));
  });
}

const firebase = (args, options) => run(process.execPath, [FIREBASE_BIN, ...args], options);

function firebaseJson(args, { allowFail = false } = {}) {
  const result = firebase([...args, '--json'], { allowFail: true });
  let parsed;
  try { parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))); } catch { parsed = undefined; }
  if (parsed?.status === 'success') return parsed.result;
  if (allowFail) return undefined;
  throw new Error(`Firebase: ${parsed?.error ?? (result.stderr || result.stdout || 'error desconocido').trim()}`);
}

function has(cmd, args = ['--version']) {
  const result = run(cmd, args, { allowFail: true });
  return !result.error && result.status === 0;
}

// ───────────────────────── estado y archivos ─────────────────────────

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function saveConfig(changes) {
  const config = { ...readConfig(), ...changes };
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2).replace(/\[\n\s+("[^\]]*?")\n\s+\]/g,
    (_, items) => `[${items.split(/,\n\s+/).join(', ')}]`)}\n`);
  const changed = applyConfig();
  if (changed.length) info(`Actualizado: ${changed.join(', ')}`);
  return readConfig();
}

function readEnvLocal() {
  const env = {};
  if (!existsSync('.env.local')) return env;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]] = match[2];
  }
  return env;
}
function writeEnvLocal(values) {
  const env = { ...readEnvLocal(), ...values };
  const lines = ['# Generado por npm run setup. No lo subas a GitHub (está en .gitignore).',
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`)];
  writeFileSync('.env.local', `${lines.join('\n')}\n`);
}

function readServiceAccount(projectId) {
  if (!existsSync(SERVICE_ACCOUNT)) return undefined;
  const account = JSON.parse(readFileSync(SERVICE_ACCOUNT, 'utf8'));
  return account.project_id === projectId ? account : undefined;
}

async function ensureServiceAccount(projectId) {
  const existing = readServiceAccount(projectId);
  if (existing) return existing;
  console.log('\n  Hace falta una clave de la cuenta de servicio de Firebase (un archivo .json).');
  info('En la página que se abre, pulsa "Generar nueva clave privada" y guarda el archivo.');
  openUrl(`https://console.firebase.google.com/project/${projectId}/settings/serviceaccounts/adminsdk`);
  for (;;) {
    const path = await askFile('Ruta del archivo .json descargado');
    try {
      const account = JSON.parse(readFileSync(path, 'utf8'));
      if (account.type !== 'service_account' || account.project_id !== projectId) {
        warn(`Ese archivo no es una clave de cuenta de servicio del proyecto ${projectId}.`);
        continue;
      }
      mkdirSync(WORK, { recursive: true });
      copyFileSync(path, SERVICE_ACCOUNT);
      ok(`Clave guardada en ${SERVICE_ACCOUNT}. Ya puedes borrar el archivo descargado.`);
      return account;
    } catch { warn('Ese archivo no es un JSON válido.'); }
  }
}

async function ensureGeminiKey(state) {
  if (state.geminiKey) return state.geminiKey;
  console.log('\n  Hace falta una clave de Gemini (gratis). Crea una con "Create API key" y cópiala.');
  openUrl('https://aistudio.google.com/apikey');
  for (;;) {
    const key = await ask('Pega aquí la clave de Gemini');
    if (/^[\w-]{30,}$/.test(key)) {
      state.geminiKey = key; // solo en .flowt-setup/, para no pedirla otra vez
      saveState(state);
      return key;
    }
    warn('No parece una clave de Gemini (suele empezar por AIza).');
  }
}

function buildWeb() {
  info('Compilando la web...');
  run('npm', ['run', 'build'], { show: true });
}

// ───────────────────────── pasos ─────────────────────────

async function stepRequirements() {
  title('Comprobar lo necesario');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Stop(`Necesitas Node.js 22 o más nuevo (tienes ${process.versions.node}). Descárgalo de https://nodejs.org`);
  ok(`Node.js ${process.versions.node}`);
  if (!existsSync(FIREBASE_BIN)) {
    info('Instalando las dependencias (la primera vez tarda unos minutos)...');
    run('npm', ['ci'], { show: true });
  }
  ok('Dependencias instaladas');
}

async function stepFirebaseLogin() {
  title('Entrar en Firebase con tu cuenta de Google');
  const accounts = firebaseJson(['login:list'], { allowFail: true });
  const current = Array.isArray(accounts) ? accounts[0]?.user?.email : undefined;
  if (current && await yes(`Ya has entrado como ${current}. ¿Usar esa cuenta?`)) return;
  info('Se abrirá el navegador para que elijas tu cuenta de Google.');
  firebase(['login', '--reauth'], { show: true });
  ok('Sesión iniciada en Firebase');
}

async function stepProject(state) {
  title('Proyecto de Firebase');
  let config = readConfig();
  const mine = config.firebaseProjectId !== ORIGINAL_PROJECT || state.projectConfirmed;
  if (mine && await yes(`Usar el proyecto ${bold(config.firebaseProjectId)}?`)) return config;

  info('Firebase guarda tus datos y publica la web. Es gratis para un uso personal.');
  const projects = firebaseJson(['projects:list']) ?? [];
  if (projects.length) info(`Tus proyectos: ${projects.map((project) => project.projectId).join(', ')}`);
  const suggestion = `flowt-${randomBytes(3).toString('hex')}`;
  let projectId;
  for (;;) {
    projectId = (await ask('ID del proyecto (uno de los tuyos, o uno nuevo para crearlo)', suggestion)).toLowerCase();
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) { warn('Solo minúsculas, números y guiones; entre 6 y 30 caracteres.'); continue; }
    if (projects.some((project) => project.projectId === projectId)) break;
    info(`Creando el proyecto ${projectId}...`);
    const created = firebase(['projects:create', projectId, '--display-name', 'Flowt'], { show: true, allowFail: true });
    if (created.status === 0) break;
    warn('No se pudo crear. Puede que el ID esté cogido o que Firebase te pida aceptar sus condiciones primero.');
    info('Créalo desde la consola ("Crear un proyecto", sin Google Analytics) y escribe aquí su ID.');
    openUrl('https://console.firebase.google.com/');
  }

  const location = (await ask('¿Dónde guardar los datos? eur3 = Europa, nam5 = EE. UU.',
    config.firebaseProjectId === projectId ? config.firestoreLocation : 'eur3')).toLowerCase();
  const changed = config.firebaseProjectId !== projectId;
  config = saveConfig({
    firebaseProjectId: projectId,
    firestoreLocation: location,
    appUrl: `https://${projectId}.web.app`,
    ...(changed ? {
      workerUrl: '',
      allowedUids: [],
      androidAppId: `com.flowt.${projectId.replace(/[^a-z0-9]/g, '')}`,
    } : {}),
  });
  if (changed) writeEnvLocal({ VITE_REVIEW_API_URL: '' });
  state.projectConfirmed = true;
  saveState(state);
  ok(`Proyecto ${projectId} guardado en ${CONFIG_FILE}`);
  return config;
}

async function stepWebApp(config) {
  title('Registrar la web en Firebase');
  const projectId = config.firebaseProjectId;
  if (readEnvLocal().VITE_FIREBASE_PROJECT_ID === projectId && readEnvLocal().VITE_FIREBASE_API_KEY) {
    ok('La web ya está registrada (.env.local)');
    return;
  }
  const apps = firebaseJson(['apps:list', 'WEB', '--project', projectId]) ?? [];
  const appId = apps[0]?.appId ?? firebaseJson(['apps:create', 'WEB', 'Flowt', '--project', projectId]).appId;
  const sdk = firebaseJson(['apps:sdkconfig', 'WEB', appId, '--project', projectId]);
  const web = sdk.sdkConfig ?? JSON.parse(/\{[\s\S]*\}/.exec(sdk.fileContents)[0]);
  writeEnvLocal({
    VITE_FIREBASE_API_KEY: web.apiKey,
    VITE_FIREBASE_AUTH_DOMAIN: web.authDomain ?? `${projectId}.firebaseapp.com`,
    VITE_FIREBASE_PROJECT_ID: web.projectId ?? projectId,
    VITE_FIREBASE_STORAGE_BUCKET: web.storageBucket ?? `${projectId}.firebasestorage.app`,
    VITE_FIREBASE_MESSAGING_SENDER_ID: web.messagingSenderId,
    VITE_FIREBASE_APP_ID: web.appId,
  });
  ok('Configuración de la web guardada en .env.local');
}

async function stepGoogleLogin(config, state) {
  title('Activar el inicio de sesión con Google');
  if (state.googleEnabled === config.firebaseProjectId && !await yes('Ya lo activaste antes. ¿Revisarlo otra vez?', false)) return;
  info('Firebase no deja activarlo desde aquí, así que es un paso a mano (un minuto):');
  info('1. Pulsa "Comenzar" si aparece.');
  info('2. En "Proveedores de acceso" elige Google → Habilitar.');
  info('3. Elige tu correo como "correo de asistencia" y pulsa Guardar.');
  openUrl(`https://console.firebase.google.com/project/${config.firebaseProjectId}/authentication/providers`);
  await pause();
  state.googleEnabled = config.firebaseProjectId;
  saveState(state);
}

function deploy(config, only) {
  info(`Publicando (${only})...`);
  firebase(['deploy', '--only', only, '--project', config.firebaseProjectId], { show: true });
}

async function stepDeploy(config, state) {
  title('Publicar la web y la base de datos');
  if (state.deployed === config.firebaseProjectId && !await yes('Ya está publicada. ¿Publicarla otra vez?', false)) return;
  // Projects created recently have no Hosting site until one is created; a second attempt just fails.
  firebase(['hosting:sites:create', config.firebaseProjectId, '--project', config.firebaseProjectId], { allowFail: true });
  buildWeb();
  deploy(config, 'firestore,hosting');
  state.deployed = config.firebaseProjectId;
  saveState(state);
  ok(`Flowt está publicado en ${config.appUrl}`);
}

async function stepOwner(config) {
  title('Hacer que tu cuenta sea la única que puede entrar');
  if (config.allowedUids.length && !await yes('Ya hay cuentas permitidas. ¿Añadir o cambiar alguna?', false)) return config;
  info('Flowt es privado: solo entran las cuentas de la lista. Para saber cuál es la tuya:');
  info(`1. Abre ${config.appUrl} y pulsa "Continuar con Google".`);
  info('2. Te dirá que no tienes acceso. Es normal: aún no estás en la lista.');
  openUrl(config.appUrl);
  for (;;) {
    await pause('Pulsa Intro cuando hayas intentado entrar');
    const file = join(WORK, 'usuarios.json');
    mkdirSync(WORK, { recursive: true });
    firebase(['auth:export', file, '--format=json', '--project', config.firebaseProjectId]);
    const users = (JSON.parse(readFileSync(file, 'utf8')).users ?? []).filter((user) => user.localId);
    if (!users.length) { warn('Todavía no veo a nadie. Intenta entrar en la web con Google y vuelve aquí.'); continue; }
    users.forEach((user, index) => info(`${index + 1}. ${user.email ?? '(sin correo)'}  ${user.localId}`));
    const answer = users.length === 1 ? '1' : await ask('¿Qué cuentas pueden entrar? Números separados por comas', '1');
    const picked = answer.split(',').map((n) => users[Number(n.trim()) - 1]).filter(Boolean);
    if (!picked.length) { warn('No he entendido la elección.'); continue; }
    config = saveConfig({ allowedUids: [...new Set(picked.map((user) => user.localId))] });
    break;
  }
  buildWeb();
  deploy(config, 'firestore:rules,hosting');
  ok(`Listo. Recarga ${config.appUrl} y entra con Google.`);
  return config;
}

async function stepWorker(config, state) {
  title('Opcional: lector de tickets y conexión con asistentes (Cloudflare + Gemini)');
  info('Permite leer tickets con la cámara y conectar Flowt con asistentes como Claude.');
  info('Necesita una cuenta gratuita de Cloudflare (https://dash.cloudflare.com/sign-up).');
  if (!await yes(config.workerUrl ? `Ya está en ${config.workerUrl}. ¿Volver a publicarlo?` : '¿Configurarlo ahora?', !config.workerUrl)) return config;

  const account = await ensureServiceAccount(config.firebaseProjectId);
  const geminiKey = await ensureGeminiKey(state);
  info('Entrando en Cloudflare (se abrirá el navegador)...');
  run('npx', ['--yes', WRANGLER, 'login'], { show: true });
  info('Publicando el Worker. Si Cloudflare te pide elegir un subdominio workers.dev, elige el que quieras.');
  const output = await runTee('npx', ['--yes', WRANGLER, 'deploy']);
  let workerUrl = /https:\/\/[\w.-]+\.workers\.dev/.exec(output)?.[0];
  if (!workerUrl) workerUrl = (await ask('Pega la URL del Worker que aparece arriba (https://...workers.dev)')).replace(/\/$/, '');
  info('Guardando los secretos del Worker...');
  run('npx', ['--yes', WRANGLER, 'secret', 'put', 'FIREBASE_SERVICE_ACCOUNT'], { input: JSON.stringify(account), show: true });
  run('npx', ['--yes', WRANGLER, 'secret', 'put', 'GEMINI_API_KEY'], { input: geminiKey, show: true });

  config = saveConfig({ workerUrl });
  writeEnvLocal({ VITE_REVIEW_API_URL: workerUrl });
  try {
    const health = await fetch(`${workerUrl}/health`);
    if (health.ok) ok(`Worker funcionando en ${workerUrl}`); else warn(`El Worker responde ${health.status}; revisa el paso.`);
  } catch { warn('No he podido comprobar el Worker todavía; a veces tarda un minuto en estar disponible.'); }
  buildWeb();
  deploy(config, 'hosting');
  ok('La web ya usa el lector de tickets');
  return config;
}

function findKeytool() {
  const candidates = [process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin', isWin ? 'keytool.exe' : 'keytool'), 'keytool'];
  if (isWin) candidates.push('C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe');
  return candidates.find((candidate) => candidate && has(candidate, ['-help']));
}

async function stepAndroid(config, state) {
  title('Opcional: app de Android');
  info('GitHub compilará el APK por ti. Aquí se crean la clave de firma y la app en Firebase.');
  const done = state.androidProject === config.firebaseProjectId;
  if (!await yes(done ? 'Ya está preparada. ¿Repetirlo?' : '¿Preparar la app de Android?', !done)) return config;
  const keytool = findKeytool();
  if (!keytool) {
    warn('Falta Java (el comando keytool). Instala Java 21 desde https://adoptium.net y vuelve a ejecutar npm run setup.');
    return config;
  }
  const pkg = await ask('Nombre del paquete de la app (no lo cambies después)', config.androidAppId);
  config = saveConfig({ androidAppId: pkg });

  mkdirSync(WORK, { recursive: true });
  if (!existsSync(KEYSTORE)) {
    state.keystorePassword = randomBytes(18).toString('base64url');
    saveState(state);
    run(keytool, ['-genkeypair', '-keystore', KEYSTORE, '-alias', 'flowt', '-keyalg', 'RSA', '-keysize', '2048',
      '-validity', '10000', '-storepass', state.keystorePassword, '-keypass', state.keystorePassword, '-dname', 'CN=Flowt']);
    ok(`Clave de firma creada en ${KEYSTORE}`);
    warn(`Haz una copia de la carpeta ${WORK}: sin esa clave no podrás actualizar la app instalada.`);
  }
  const listing = run(keytool, ['-list', '-v', '-keystore', KEYSTORE, '-alias', 'flowt', '-storepass', state.keystorePassword]).stdout;
  const sha1 = /SHA1:\s*([0-9A-F:]{59})/i.exec(listing)?.[1];
  if (!sha1) throw new Error('No he podido leer el SHA-1 de la clave de firma.');

  const projectId = config.firebaseProjectId;
  const apps = firebaseJson(['apps:list', 'ANDROID', '--project', projectId]) ?? [];
  const appId = apps.find((app) => app.packageName === pkg)?.appId
    ?? firebaseJson(['apps:create', 'ANDROID', 'Flowt', '--package-name', pkg, '--project', projectId]).appId;
  firebaseJson(['apps:android:sha:create', appId, sha1, '--project', projectId], { allowFail: true });
  const googleServices = firebaseJson(['apps:sdkconfig', 'ANDROID', appId, '--project', projectId]).fileContents;
  writeFileSync(join(WORK, 'google-services.json'), googleServices);
  writeFileSync(join('android', 'app', 'google-services.json'), googleServices);
  if (!/"client_type":\s*3/.test(googleServices)) {
    warn('google-services.json aún no trae el cliente de Google. Comprueba que activaste Google en el paso de inicio de sesión y repite este paso en unos minutos.');
  }
  state.androidProject = projectId;
  saveState(state);
  ok('App de Android registrada en Firebase');
  return config;
}

async function stepGitHub(config, state) {
  title('Opcional: publicar solo desde GitHub');
  info('Con esto, cada cambio que subas a main se publica solo, y se compila el APK de Android.');
  info('Necesitas tu propia copia del repositorio en GitHub (un fork) y GitHub CLI (https://cli.github.com).');
  if (!await yes('¿Configurar GitHub ahora?')) return;
  if (!has('gh')) { warn('No encuentro GitHub CLI (gh). Instálalo y vuelve a ejecutar npm run setup.'); return; }
  if (run('gh', ['auth', 'status'], { allowFail: true }).status !== 0) run('gh', ['auth', 'login', '--web'], { show: true });
  const detected = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { allowFail: true }).stdout?.trim();
  const repo = await ask('Repositorio (usuario/nombre)', detected);
  if (/^isalvan\/flowt$/i.test(repo) && config.firebaseProjectId !== ORIGINAL_PROJECT) {
    warn('Ese es el repositorio original. Haz un fork en GitHub y ejecuta esto dentro de tu copia.');
    return;
  }
  const variable = (name, value) => run('gh', ['variable', 'set', name, '--repo', repo, '--body', value]);
  const secret = (name, value) => run('gh', ['secret', 'set', name, '--repo', repo], { input: value });

  const env = readEnvLocal();
  for (const key of WEB_KEYS) variable(key, env[key]);
  if (env.VITE_REVIEW_API_URL) variable('VITE_REVIEW_API_URL', env.VITE_REVIEW_API_URL);
  ok('Variables de la web guardadas en GitHub');

  const account = await ensureServiceAccount(config.firebaseProjectId);
  secret('FIREBASE_SERVICE_ACCOUNT', JSON.stringify(account));
  ok('Permiso para publicar en Firebase guardado en GitHub');

  if (existsSync(KEYSTORE) && existsSync(join(WORK, 'google-services.json'))) {
    secret('GOOGLE_SERVICES_JSON', readFileSync(join(WORK, 'google-services.json'), 'utf8'));
    secret('ANDROID_KEYSTORE_BASE64', readFileSync(KEYSTORE).toString('base64'));
    secret('ANDROID_KEYSTORE_PASSWORD', state.keystorePassword);
    ok('Secretos de Android guardados en GitHub');
  }
  state.githubRepo = repo;
  saveState(state);

  const status = run('git', ['status', '--porcelain'], { allowFail: true }).stdout ?? '';
  if (status.trim() && await yes('¿Guardar tu configuración en Git y subirla (commit + push)?')) {
    run('git', ['add', '-A'], { show: true });
    run('git', ['commit', '-m', 'Configurar mi instalación de Flowt'], { show: true });
    run('git', ['push'], { show: true });
    ok('Subido. GitHub publicará la web y el APK en unos minutos.');
  }
  info(`Si es un fork, activa Actions una vez: https://github.com/${repo}/actions`);
}

function findPython() {
  for (const [cmd, args] of [['python3', []], ['python', []], ['py', ['-3']]]) {
    const result = run(cmd, [...args, '--version'], { allowFail: true });
    if (!result.error && result.status === 0 && /Python 3\.(1[1-9]|[2-9]\d)/.test(result.stdout + result.stderr)) return [cmd, args];
  }
  return undefined;
}

async function stepGmail(config, state) {
  title('Opcional: leer los avisos del banco desde Gmail');
  info('Flowt puede apuntar solo tus gastos leyendo los correos que te manda el banco.');
  info('Es el paso más largo (unos 15 minutos) y necesita Python 3.11 o más nuevo y el paso de GitHub hecho.');
  if (!await yes('¿Configurarlo ahora?', false)) return;
  if (!state.githubRepo || !has('gh')) { warn('Primero completa el paso de GitHub.'); return; }
  const python = findPython();
  if (!python) { warn('Falta Python 3.11+ (https://www.python.org/downloads/). Instálalo y repite.'); return; }
  const projectId = config.firebaseProjectId;

  const credentials = join('tracker-backend', 'credentials.json');
  if (!existsSync(credentials)) {
    info('1. Activa la API de Gmail:');
    openUrl(`https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=${projectId}`);
    await pause();
    info('2. Configura la pantalla de consentimiento: tipo "Externo", tu correo como usuario de prueba.');
    info('   Después, en "Público", pulsa "Publicar app" para que el permiso no caduque cada 7 días.');
    openUrl(`https://console.cloud.google.com/auth/overview?project=${projectId}`);
    await pause();
    info('3. Crea un cliente OAuth de tipo "App de escritorio" y descarga su JSON.');
    openUrl(`https://console.cloud.google.com/auth/clients/create?project=${projectId}`);
    copyFileSync(await askFile('Ruta del JSON del cliente OAuth'), credentials);
  }

  const venv = join(WORK, 'venv');
  const venvPython = join(venv, isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
  if (!existsSync(venvPython)) run(python[0], [...python[1], '-m', 'venv', venv], { show: true });
  info('Instalando lo que necesita el lector (un par de minutos)...');
  run(venvPython, ['-m', 'pip', 'install', '-q', '-r', join('tracker-backend', 'requirements.txt')], { show: true });
  info('Se abrirá el navegador para que des permiso de lectura a tu Gmail.');
  info('Si avisa de que la app no está verificada: "Configuración avanzada" → "Ir a ...". La app es tuya.');
  run(venvPython, ['-c', 'from gmail_client import get_gmail_service; import sys; sys.exit(0 if get_gmail_service() else 1)'],
    { show: true, cwd: 'tracker-backend' });
  const token = join('tracker-backend', 'token.json');
  if (!existsSync(token)) throw new Error('No se generó token.json; repite el paso.');

  const sender = await ask('Correo desde el que te escribe el banco (varios separados por comas)');
  const owner = config.allowedUids.length > 1
    ? await ask(`UID de la cuenta a la que van los movimientos (${config.allowedUids.join(', ')})`, config.allowedUids[0])
    : config.allowedUids[0];
  const account = await ensureServiceAccount(projectId);
  const geminiKey = await ensureGeminiKey(state);
  const base64 = (path) => readFileSync(path).toString('base64');
  const secret = (name, value) => run('gh', ['secret', 'set', name, '--repo', state.githubRepo], { input: value });
  secret('GMAIL_CREDENTIALS_BASE64', base64(credentials));
  secret('GMAIL_TOKEN_BASE64', base64(token));
  secret('FIREBASE_SERVICE_ACCOUNT_BASE64', Buffer.from(JSON.stringify(account)).toString('base64'));
  secret('BANK_SENDER', sender);
  secret('UID_PROPIETARIO', owner);
  secret('GEMINI_API_KEY', geminiKey);
  secret('AI_MODEL', 'gemini-3.5-flash');
  ok('Lector de Gmail configurado. Se ejecuta cada 30 minutos desde GitHub Actions.');
  info(`Para probarlo ya: https://github.com/${state.githubRepo}/actions/workflows/run_tracker.yml → Run workflow`);
}

// ───────────────────────── programa ─────────────────────────

async function main() {
  console.log(bold('\nInstalación de Flowt'));
  console.log('Te guiaré para montar tu propio Flowt. Puedes parar con Ctrl+C y volver a ejecutar');
  console.log('npm run setup cuando quieras: lo que ya esté hecho se detecta.');
  console.log(`Las claves que se creen se guardan en la carpeta ${WORK} (no se sube a GitHub).`);
  const state = loadState();

  await stepRequirements();
  await stepFirebaseLogin();
  let config = await stepProject(state);
  await stepWebApp(config);
  await stepGoogleLogin(config, state);
  await stepDeploy(config, state);
  config = await stepOwner(config);
  config = await stepWorker(config, state);
  config = await stepAndroid(config, state);
  await stepGitHub(config, state);
  await stepGmail(config, state);

  console.log(`\n${green(bold('¡Hecho!'))} Tu Flowt está en ${bold(config.appUrl)}`);
  info(`Guarda una copia de la carpeta ${WORK}: contiene tus claves.`);
}

main().catch((error) => {
  console.error(`\n${red(error instanceof Stop ? error.message : `Algo ha fallado: ${error.message}`)}`);
  if (!(error instanceof Stop)) console.error('Corrige lo que indica y vuelve a ejecutar npm run setup; seguirá donde lo dejaste.');
  process.exitCode = 1;
});
