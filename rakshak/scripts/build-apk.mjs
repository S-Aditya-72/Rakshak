// Builds the Android app (debug APK) from apps/web: web build → Capacitor sync → Gradle.
// Output: rakshak/apk/RAKSHAK-debug.apk. Needs Android Studio (for its Java 21 and the Android SDK).
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = join(root, 'apps', 'web');
const win = process.platform === 'win32';

const javaHome =
  process.env.RAKSHAK_JAVA_HOME ??
  [
    'C:/Program Files/Android/Android Studio/jbr',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/opt/android-studio/jbr',
    join(homedir(), 'android-studio', 'jbr'),
  ].find((p) => existsSync(p));
const sdk =
  process.env.ANDROID_HOME ??
  [join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'), join(homedir(), 'Library', 'Android', 'sdk'), join(homedir(), 'Android', 'Sdk')].find((p) => existsSync(p));
if (!javaHome || !sdk) {
  console.error(`Android Studio not found (java: ${javaHome ?? 'missing'}, sdk: ${sdk ?? 'missing'}). Set RAKSHAK_JAVA_HOME / ANDROID_HOME.`);
  process.exit(1);
}

// Android Studio's bundled Java, not the system one: Gradle does not support every new JDK yet.
// IPv4 first: on networks with broken IPv6, Gradle's own downloads otherwise time out.
const ipv4 = '-Djava.net.preferIPv4Stack=true';
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, JAVA_OPTS: `${process.env.JAVA_OPTS ?? ''} ${ipv4}`.trim() };
const run = (cmd, args, cwd) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd, env, stdio: 'inherit', shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('npm', ['run', 'build'], web);
run('npx', ['cap', 'sync', 'android'], web);
// The Gradle daemon does the dependency downloads, so it needs the flag too. Quoted for cmd.exe (shell: true).
const jvmArgs = `-Dorg.gradle.jvmargs=${ipv4} -Xmx2g`;
// Absolute path: cmd.exe may be configured not to run programs from the current folder.
const android = join(web, 'android');
const gradlew = join(android, win ? 'gradlew.bat' : 'gradlew');
run(win ? `"${gradlew}"` : gradlew, ['assembleDebug', '--console=plain', win ? `"${jvmArgs}"` : jvmArgs], android);

const out = join(root, 'apk');
mkdirSync(out, { recursive: true });
copyFileSync(join(web, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), join(out, 'RAKSHAK-debug.apk'));
console.log(`\nAPK ready: ${join(out, 'RAKSHAK-debug.apk')}`);
