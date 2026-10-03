import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployHosting, validateWebConfig, validateServiceAccount } from './firebase-hosting.mjs';

const projectId = 'demo-flowt-deploy';
const account = {
  type: 'service_account', project_id: projectId,
  client_email: `hosting@${projectId}.iam.gserviceaccount.com`,
  private_key: '-----BEGIN PRIVATE KEY-----\nsynthetic-test-key\n-----END PRIVATE KEY-----\n',
};
const fixture = () => ({
  VITE_FIREBASE_API_KEY: `AIza${'0'.repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
  VITE_FIREBASE_PROJECT_ID: projectId,
  VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.firebasestorage.app`,
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
  VITE_FIREBASE_APP_ID: '1:123456789:web:synthetic',
  FIREBASE_SERVICE_ACCOUNT_FLOWT_63536: JSON.stringify(account),
});
const originalCwd = process.cwd();
let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowt-deploy-test-'));
  process.chdir(dir);
  mkdirSync('dist');
  writeFileSync('dist/index.html', '<html>Datos ficticios</html>');
});
afterEach(() => { process.chdir(originalCwd); rmSync(dir, { recursive: true, force: true }); });

test('fails before publishing for missing variables, placeholders, or the wrong project', () => {
  const env = fixture();
  delete env.VITE_FIREBASE_API_KEY;
  assert.throws(() => validateWebConfig(env, projectId), /VITE_FIREBASE_API_KEY/);
  assert.throws(() => validateWebConfig({ ...fixture(), VITE_FIREBASE_API_KEY: 'tu_firebase_api_key' }, projectId), /ejemplo/);
  assert.throws(() => validateWebConfig(fixture(), 'another-project'), /no coincide/);
  assert.throws(() => validateWebConfig({ ...fixture(), VITE_FIREBASE_APP_ID: '1:999:web:synthetic' }, projectId), /misma aplicación/);
});

test('rejects absent, base64, malformed, or cross-project credentials without exposing them', () => {
  for (const value of [undefined, Buffer.from(JSON.stringify(account)).toString('base64'), '{broken-json',
    JSON.stringify({ ...account, project_id: 'another-project' }), 'null']) {
    assert.throws(() => validateServiceAccount({ FIREBASE_SERVICE_ACCOUNT_FLOWT_63536: value }, projectId));
  }
  assert.deepEqual(validateServiceAccount(fixture(), projectId), account);
});

test('production publishes only Hosting and removes temporary credentials', () => {
  let credentials;
  const url = deployHosting({ env: fixture(), projectId, channel: 'live', run: (args, env) => {
    assert.deepEqual(args, ['deploy', '--only', 'hosting', '--project', projectId, '--non-interactive', '--json']);
    credentials = env.GOOGLE_APPLICATION_CREDENTIALS;
    assert.equal(env.FIREBASE_SERVICE_ACCOUNT_FLOWT_63536, undefined);
    assert.deepEqual(JSON.parse(readFileSync(credentials, 'utf8')), account);
    if (process.platform !== 'win32') assert.equal(statSync(credentials).mode & 0o777, 0o600);
    return { status: 0, stdout: JSON.stringify({ status: 'success', result: { hosting: `https://${projectId}.web.app` } }) };
  } });
  assert.equal(url, `https://${projectId}.web.app`);
  assert.equal(existsSync(credentials), false);
});

test('preview expires after seven days and never updates Firebase Auth domains', () => {
  const url = deployHosting({ env: fixture(), projectId, channel: 'pr-80', run: args => {
    assert.deepEqual(args, ['hosting:channel:deploy', 'pr-80', '--expires', '7d', '--no-authorized-domains', '--project', projectId, '--non-interactive', '--json']);
    return { status: 0, stdout: JSON.stringify({ status: 'success', result: { [projectId]: { url: `https://${projectId}--pr-80-example.web.app` } } }) };
  } });
  assert.match(url, /--pr-80-example\.web\.app$/);
});

test('production reads the version resource returned by Firebase CLI', () => {
  for (const hosting of [
    `sites/${projectId}/versions/release-123`, [`sites/${projectId}/versions/release-123`],
    `projects/123456789/sites/${projectId}/versions/release-123`,
    [`projects/123456789/sites/${projectId}/versions/release-123`],
  ]) {
    const url = deployHosting({ env: fixture(), projectId, channel: 'live', run: () => ({
      status: 0, stdout: JSON.stringify({ status: 'success', result: { hosting } }),
    }) });
    assert.equal(url, `https://${projectId}.web.app`);
  }
});

test('failed Firebase commands and invalid responses clean up credentials without reporting success', () => {
  for (const result of [{ status: 1, stdout: '' }, { status: 0, stdout: '{}' },
    { status: 0, stdout: 'invalid' }, { status: 0, stdout: '{"status":"success","result":{"hosting":"https://unexpected.example"}}' }]) {
    let credentials;
    assert.throws(() => deployHosting({ env: fixture(), projectId, channel: 'live', run: (_args, env) => {
      credentials = env.GOOGLE_APPLICATION_CREDENTIALS;
      return result;
    } }));
    assert.equal(existsSync(credentials), false);
  }
});

test('invalid channels, missing builds and missing credentials never invoke Firebase', () => {
  const run = () => assert.fail('Firebase should not be invoked');
  assert.throws(() => deployHosting({ env: fixture(), projectId, channel: 'live; command', run }), /Canal/);
  const env = fixture(); delete env.FIREBASE_SERVICE_ACCOUNT_FLOWT_63536;
  assert.throws(() => deployHosting({ env, projectId, channel: 'live', run }), /secret/);
  rmSync('dist', { recursive: true });
  assert.throws(() => deployHosting({ env: fixture(), projectId, channel: 'live', run }), /compila/);
});
