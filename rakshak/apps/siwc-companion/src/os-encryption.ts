// OS-backed CredentialEncryption for the @siwc/local SDK in a plain Node process (no Electron).
// A random 256-bit data key encrypts the SDK's credential file with AES-256-GCM. The data key itself is
// protected by the operating system: DPAPI (Windows, current user), Keychain (macOS) or libsecret (Linux).
// The key never appears in process arguments, logs or the browser. There is no plaintext fallback.

import type { CredentialEncryption } from '@siwc/local';
import { execFile, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SERVICE = 'rakshak-siwc-companion';
const ACCOUNT = 'credential-key';

function run(cmd: string, args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 200)}`))));
    child.stdin.end(stdin ?? '');
  });
}

const PS_PROTECT =
  "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); " +
  "[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser')))";
const PS_UNPROTECT =
  "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); " +
  "[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser')))";

async function loadOrCreateKey(dir: string): Promise<Buffer> {
  if (process.platform === 'win32') {
    const file = join(dir, 'credential-key.dpapi');
    const ps = ['-NoProfile', '-NonInteractive', '-Command'];
    if (existsSync(file)) {
      const protectedB64 = (await readFile(file, 'utf8')).trim();
      return Buffer.from((await run('powershell.exe', [...ps, PS_UNPROTECT], protectedB64)).trim(), 'base64');
    }
    const key = randomBytes(32);
    const protectedB64 = (await run('powershell.exe', [...ps, PS_PROTECT], key.toString('base64'))).trim();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, protectedB64, { mode: 0o600 });
    return key;
  }
  if (process.platform === 'darwin') {
    try {
      const hex = await new Promise<string>((res, rej) =>
        execFile('security', ['find-generic-password', '-a', ACCOUNT, '-s', SERVICE, '-w'], (e, out) => (e ? rej(e) : res(out.trim()))),
      );
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    } catch {
      /* not created yet */
    }
    const key = randomBytes(32);
    // `security -i` reads the command from stdin, keeping the key out of argv.
    await run('security', ['-i'], `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE} -w ${key.toString('hex')}\n`);
    return key;
  }
  // Linux: libsecret via secret-tool (secret read from stdin).
  try {
    const hex = (await run('secret-tool', ['lookup', 'service', SERVICE, 'account', ACCOUNT])).trim();
    if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
  } catch {
    /* not created yet */
  }
  const key = randomBytes(32);
  await run('secret-tool', ['store', '--label=RAKSHAK SIWC companion', 'service', SERVICE, 'account', ACCOUNT], key.toString('hex'));
  return key;
}

export async function createOsCredentialEncryption(dir: string): Promise<CredentialEncryption & { error: string | null }> {
  let key: Buffer | null = null;
  let error: string | null = null;
  try {
    key = await loadOrCreateKey(dir);
    if (key.length !== 32) throw new Error('unexpected key length');
  } catch (e) {
    error = `OS credential store unavailable (${(e as Error).message.split(':')[0]})`;
    key = null;
  }
  const need = () => {
    if (!key) throw new Error('OS credential encryption is unavailable.');
    return key;
  };
  return {
    id: `rakshak-os-aesgcm-v1-${process.platform}`,
    error,
    isAvailable: () => key !== null,
    encrypt(plaintext: string) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', need(), iv);
      const body = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return new Uint8Array(Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]));
    },
    decrypt(ciphertext: Uint8Array) {
      const b = Buffer.from(ciphertext);
      if (b[0] !== 1 || b.length < 29) throw new Error('unsupported ciphertext');
      const d = createDecipheriv('aes-256-gcm', need(), b.subarray(1, 13));
      d.setAuthTag(b.subarray(13, 29));
      return Buffer.concat([d.update(b.subarray(29)), d.final()]).toString('utf8');
    },
  };
}
