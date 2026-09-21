/**
 * Collect the licence notices of everything the app ships.
 *
 * MIT and Apache-2.0 both require the copyright and permission notice to travel
 * with the copies you distribute. A minified bundle is a copy, and the minifier
 * strips comments, so without this the deployed site carries none of them.
 *
 * Written at build time into the output directory rather than committed, because
 * it is a property of the dependency tree that produced this build: a file in the
 * repository would be right only until the next `pnpm update`.
 *
 * Usage: node scripts/third-party-notices.mjs <outDir>
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2];
if (OUT === undefined) {
  console.error('usage: node scripts/third-party-notices.mjs <outDir>');
  process.exit(1);
}

/** Names a package may give its licence text, in the order worth trying. */
const LICENCE_FILES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENSE-MIT',
  'COPYING',
  'COPYING.md',
];

/** Apache-2.0 additionally requires any NOTICE file to be carried along. */
const NOTICE_FILES = ['NOTICE', 'NOTICE.md', 'NOTICE.txt'];

/** Every production dependency of the workspace, as pnpm resolves them. */
function dependencies() {
  const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const byLicence = JSON.parse(raw);
  const packages = [];
  for (const [licence, entries] of Object.entries(byLicence)) {
    for (const entry of entries) {
      // Workspace packages are ours and are covered by the repository's own licence.
      if (entry.name.startsWith('@vibeamp/')) continue;
      packages.push({
        name: entry.name,
        versions: entry.versions ?? [],
        licence,
        author: entry.author ?? null,
        homepage: entry.homepage ?? null,
        path: entry.paths?.find((p) => p !== '' && existsSync(p)) ?? null,
        repository: null,
      });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

/** The first file in `names` that the package ships, read whole. */
function textFrom(path, names) {
  if (path === null) return null;
  let entries;
  try {
    entries = readdirSync(path);
  } catch {
    return null;
  }

  for (const name of names) {
    const match = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
    if (match === undefined) continue;
    try {
      const text = readFileSync(join(path, match), 'utf8').trim();
      if (text.length > 0) return text;
    } catch {
      // Unreadable is the same as absent for this purpose.
    }
  }
  return null;
}

/**
 * What to say about a package that ships no licence text.
 *
 * Its declared licence and where the terms live, rather than a reconstruction:
 * writing out a copyright line the publisher never published would be inventing
 * the very notice this file exists to preserve.
 */
function noLicenceFile(pkg) {
  return [
    `This package ships no licence file. It declares ${pkg.licence}`,
    pkg.author === null ? '' : ` and names ${pkg.author} as its author`,
    '.',
    pkg.homepage === null ? '' : `\nThe terms are published at ${pkg.homepage}`,
  ].join('');
}

const packages = dependencies();
const missing = [];
const sections = [];

for (const pkg of packages) {
  const licence = textFrom(pkg.path, LICENCE_FILES);
  const notice = textFrom(pkg.path, NOTICE_FILES);
  if (licence === null) missing.push(pkg);

  const header = [
    pkg.name + (pkg.versions.length > 0 ? ` ${pkg.versions.join(', ')}` : ''),
    `License: ${pkg.licence}`,
    pkg.author === null ? null : `Author: ${pkg.author}`,
    pkg.homepage === null ? null : pkg.homepage,
  ].filter((line) => line !== null);

  sections.push(
    [
      '-'.repeat(78),
      ...header,
      '',
      licence ?? noLicenceFile(pkg),
      notice === null ? null : `\nNOTICE\n\n${notice}`,
    ]
      .filter((part) => part !== null)
      .join('\n'),
  );
}

const preamble = `Third-party notices for vibeamp
${'='.repeat(78)}

vibeamp itself is MIT licensed; see LICENSE in the repository.

This build includes the open source packages below. Their licences are reproduced
in full, which is what MIT and Apache-2.0 ask of anyone distributing a copy — and a
minified bundle is a copy.

Generated from the production dependency tree at build time by
scripts/third-party-notices.mjs. ${packages.length} packages.

No audio ever leaves the device, so nothing here covers the music you play.
`;

writeFileSync(join(OUT, 'THIRD-PARTY-NOTICES.txt'), `${preamble}\n${sections.join('\n\n')}\n`);

console.log(`third-party notices: ${packages.length} packages`);
if (missing.length > 0) {
  // Not fatal: a package that ships no licence file is upstream's omission, and
  // recording the declared licence plus where it came from is the best available.
  console.warn(
    `  ${missing.length} ship no licence file: ${missing.map((p) => p.name).join(', ')}`,
  );
}
