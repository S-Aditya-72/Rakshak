// Starts the RAKSHAK inference service (apps/server) with the project venv, on Windows or macOS/Linux.
// Offline by default after setup: HF_HUB_OFFLINE=1 unless RAKSHAK_ALLOW_DOWNLOAD=1.
// --lan: listen on the network for the Android app, with an access code kept in data/access-token.
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

if (process.argv.includes('--lan')) {
  env.RAKSHAK_HOST ??= '0.0.0.0';
  env.RAKSHAK_ACCESS_TOKEN ??= accessToken(env.RAKSHAK_DATA_DIR ?? join(root, 'data'));
  const port = env.RAKSHAK_PORT ?? '8787';
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
  console.log('\n  RAKSHAK server for phones');
  for (const ip of ips) console.log(`    Server address: http://${ip}:${port}`);
  console.log(`    Access code:    ${env.RAKSHAK_ACCESS_TOKEN}`);
  console.log('  Phones must be on the same Wi-Fi/hotspot. On Windows, allow Python through the firewall');
  console.log('  for Private networks when asked. Remote over the internet: cloudflared tunnel --url http://127.0.0.1:' + port + '\n');
}

const args = process.argv.includes('--test') ? ['-m', 'pytest', '-q', 'tests'] : ['-m', 'rakshak_server'];
const child = spawn(py, args, { cwd: server, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));

/** Reuses the saved code so phones keep working across restarts. Easy to type: no 0/o/1/l/i. */
function accessToken(dataDir) {
  const file = join(dataDir, 'access-token');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''));
  const token = groups.join('-');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, token + '\n');
  return token;
}
