import fs from 'node:fs';
import path from 'node:path';

const [, , tag, changelogPath = 'CHANGELOG.md', outputPath = 'RELEASE_NOTES.md'] = process.argv;

if (!tag) {
  console.error('Missing tag name.');
  process.exit(1);
}

const version = tag.startsWith('v') ? tag.slice(1) : tag;
const content = fs.readFileSync(changelogPath, 'utf8');
const heading = `## ${version}`;
const start = content.indexOf(heading);

if (start === -1) {
  console.error(`Could not find changelog section for ${heading}.`);
  process.exit(1);
}

const rest = content.slice(start + heading.length);
const nextHeadingMatch = rest.match(/\n##\s+/);
const end = nextHeadingMatch ? start + heading.length + nextHeadingMatch.index : content.length;
const notes = content.slice(start + heading.length, end).replace(/^\r?\n+/, '').trimEnd() + '\n';

fs.writeFileSync(path.resolve(outputPath), notes, 'utf8');
