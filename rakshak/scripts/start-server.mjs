// Starts the RAKSHAK inference service (apps/server) with the project venv, on Windows or macOS/Linux.
// Offline by default after setup: HF_HUB_OFFLINE=1 unless RAKSHAK_ALLOW_DOWNLOAD=1.
// --lan: listen on the network for the Android app, with an access code kept in data/access-token.
// --tunnel: also reachable over the internet through a Cloudflare quick tunnel (phones anywhere), with the same code.
// With either, the web app is built first and served by the server too: a phone without the RAKSHAK app scans the
// connect QR with its camera and gets the same app in its browser (RAKSHAK_SKIP_WEB_BUILD=1 skips the build).
import { spawn, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const server = join(root, 'apps', 'server');
const py = process.platform === 'win32' ? join(server, '.venv', 'Scripts', 'python.exe') : join(server, '.venv', 'bin', 'python');
if (!existsSync(py)) {
  console.error(`No venv at ${py}. Run scripts/setup-server.${process.platform === 'win32' ? 'ps1' : 'sh'} first.`);
  process.exit(1);
}
const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
if (process.env.RAKSHAK_ALLOW_DOWNLOAD !== '1') env.HF_HUB_OFFLINE = '1';

const lan = process.argv.includes('--lan');
const tunnel = process.argv.includes('--tunnel');
const dataDir = env.RAKSHAK_DATA_DIR ?? join(root, 'data');
const port = env.RAKSHAK_PORT ?? '8787';
const publicFile = join(dataDir, 'public-url');
rmSync(publicFile, { force: true }); // an address from an earlier run is dead

if (lan || tunnel) env.RAKSHAK_ACCESS_TOKEN ??= accessToken(dataDir);
if (lan) {
  env.RAKSHAK_HOST ??= '0.0.0.0';
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  console.log('\n  RAKSHAK server for phones');
  for (const ip of ips) console.log(`    Server address: http://${ip}:${port}`);
  console.log(`    Access code:    ${env.RAKSHAK_ACCESS_TOKEN}`);
  console.log('  Phones must be on the same Wi-Fi/hotspot. On Windows, allow Python through the firewall');
  console.log('  for Private networks when asked. Phones elsewhere: npm run server:remote\n');
}

if ((lan || tunnel) && !process.argv.includes('--test') && process.env.RAKSHAK_SKIP_WEB_BUILD !== '1') {
  console.log('  Building the web app for phone browsers (about 15 s)…');
  const b = spawnSync('npm', ['run', 'build', '-w', '@rakshak/web'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  console.log(b.status === 0 ? '  Web app ready: phones without the RAKSHAK app can open it from the QR code.' : '  The web app did not build; phones can still use the RAKSHAK app.');
}

const args = process.argv.includes('--test') ? ['-m', 'pytest', '-q', 'tests'] : ['-m', 'rakshak_server'];
const child = spawn(py, args, { cwd: server, env, stdio: 'inherit' });
let cf = null;
child.on('exit', (code) => {
  cf?.kill();
  rmSync(publicFile, { force: true });
  process.exit(code ?? 0);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => (cf?.kill(), child.kill(sig)));

if (tunnel) startTunnel();

/**
 * Cloudflare quick tunnel: no account, a new https://….trycloudflare.com address every run. The server stays on this
 * machine; the tunnel forwards to it, and the server treats tunnelled requests as remote (access code required).
 */
function startTunnel() {
  const exe = findCloudflared();
  if (!exe) {
    console.error('\n  cloudflared is not installed. Install it once, then run this again:');
    console.error('    winget install Cloudflare.cloudflared      (macOS: brew install cloudflared)\n');
    child.kill();
    return;
  }
  console.log('\n  Opening an internet tunnel to this server (Cloudflare)…');
  cf = spawn(exe, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let found = false;
  const read = (buf) => {
    const m = !found && String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m) return;
    found = true;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(publicFile, m[0] + '\n');
    console.log('\n  RAKSHAK over the internet');
    console.log(`    Address:     ${m[0]}`);
    console.log(`    Access code: ${env.RAKSHAK_ACCESS_TOKEN}`);
    console.log('  Phones anywhere: open http://127.0.0.1:5280/#/engine on this laptop → Connect phones → scan the QR');
    console.log('  (share the screen in a call, or send a photo of it) with the phone camera, or the RAKSHAK app.');
    console.log('  The address changes every time this starts.\n');
  };
  cf.stdout.on('data', read);
  cf.stderr.on('data', read);
  cf.on('exit', (code) => {
    rmSync(publicFile, { force: true });
    if (code) console.error(`\n  The internet tunnel stopped (cloudflared exit ${code}). Phones on the internet are disconnected.\n`);
  });
  setTimeout(() => !found && console.error('\n  Still waiting for the tunnel address. Check this laptop is online (some networks block Cloudflare tunnels).\n'), 30_000);
}

function findCloudflared() {
  const names = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared'];
  const dirs = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  if (process.platform === 'win32') {
    dirs.push(
      join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared'),
    );
  } else dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  for (const d of dirs) for (const n of names) if (d && existsSync(join(d, n))) return join(d, n);
  return null;
}

/** Reuses the saved code so phones keep working across restarts. Easy to type: no 0/o/1/l/i. */
function accessToken(dir) {
  const file = join(dir, 'access-token');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''));
  const token = groups.join('-');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, token + '\n');
  return token;
}
