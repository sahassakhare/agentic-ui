/** Copy the collection manifest, schema, and template files into dist/ so the
 *  compiled schematic can resolve `./scaffold/index`, its schema, and `./files`. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(PKG, 'dist');

async function main() {
  await fs.mkdir(path.join(DIST, 'scaffold'), { recursive: true });
  await fs.copyFile(path.join(PKG, 'collection.json'), path.join(DIST, 'collection.json'));
  await fs.copyFile(path.join(PKG, 'src/scaffold/schema.json'), path.join(DIST, 'scaffold/schema.json'));
  await fs.cp(path.join(PKG, 'src/scaffold/files'), path.join(DIST, 'scaffold/files'), { recursive: true });
  console.log('✓ Copied collection.json, schema.json and files/ into dist/');
}
main().catch((e) => { console.error(e); process.exit(1); });
