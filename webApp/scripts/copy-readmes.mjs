import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(appRoot, '..');
const docsDirectory = resolve(appRoot, 'public', 'docs');

await mkdir(docsDirectory, { recursive: true });
await Promise.all([
  copyFile(resolve(appRoot, 'README.md'), resolve(docsDirectory, 'webapp-readme.md')),
  copyFile(resolve(repositoryRoot, 'FFCH_Puntuacion', 'README.md'), resolve(docsDirectory, 'ffch-puntuacion-readme.md'))
]);
