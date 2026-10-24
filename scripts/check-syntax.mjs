import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skippedDirectories = new Set(['.git', 'node_modules']);

async function collectJavaScript(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...await collectJavaScript(join(directory, entry.name)));
    } else if (/\.(?:mjs|js)$/.test(entry.name)) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

const files = await collectJavaScript(root);
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) failures.push({ file, output: `${result.stdout}${result.stderr}`.trim() });
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`Syntax error in ${failure.file}\n${failure.output}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Syntax OK: ${files.length} JavaScript files checked.`);
}
