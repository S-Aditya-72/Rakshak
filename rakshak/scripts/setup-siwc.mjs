// Optional: installs the official Sign in with ChatGPT DevKit SDK (@siwc/local) for the ChatGPT backend.
// Clones openai/sign-in-with-chatgpt-devkit at a pinned commit into vendor/, builds only packages/local
// (unmodified), then installs the companion's dependencies. Licence: Sign-in with ChatGPT DevKit
// Noncommercial License v1.0 (see vendor/sign-in-with-chatgpt-devkit/LICENSE).
//
//   node scripts/setup-siwc.mjs
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEVKIT = join(ROOT, 'vendor', 'sign-in-with-chatgpt-devkit');
const COMMIT = '0a36fefeb913055c8c7a1a29b63d82b96b2e841a';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

if (!existsSync(DEVKIT)) {
  run('git', ['clone', 'https://github.com/openai/sign-in-with-chatgpt-devkit.git', DEVKIT], ROOT);
}
run('git', ['fetch', '--depth', '1', 'origin', COMMIT], DEVKIT);
run('git', ['checkout', '--detach', COMMIT], DEVKIT);
run(npm, ['ci', '-w', '@siwc/local', '--include-workspace-root', '--ignore-scripts', '--no-audit', '--no-fund'], DEVKIT);
run(npm, ['run', 'build', '-w', '@siwc/local'], DEVKIT);
run(npm, ['install', '--no-audit', '--no-fund'], join(ROOT, 'apps', 'siwc-companion'));
console.log('\nSIWC SDK ready. Start the companion with: npm run companion');
