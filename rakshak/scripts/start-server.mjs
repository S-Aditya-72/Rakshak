// Starts the RAKSHAK inference service (apps/server) with the project venv, on Windows or macOS/Linux.
// Offline by default after setup: HF_HUB_OFFLINE=1 unless RAKSHAK_ALLOW_DOWNLOAD=1.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const server = resolve(import.meta.dirname, '..', 'apps', 'server');
const py = process.platform === 'win32' ? join(server, '.venv', 'Scripts', 'python.exe') : join(server, '.venv', 'bin', 'python');
if (!existsSync(py)) {
  console.error(`No venv at ${py}. Run scripts/setup-server.${process.platform === 'win32' ? 'ps1' : 'sh'} first.`);
  process.exit(1);
}
const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
if (process.env.RAKSHAK_ALLOW_DOWNLOAD !== '1') env.HF_HUB_OFFLINE = '1';
const args = process.argv.includes('--test') ? ['-m', 'pytest', '-q', 'tests'] : ['-m', 'rakshak_server'];
const child = spawn(py, args, { cwd: server, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
