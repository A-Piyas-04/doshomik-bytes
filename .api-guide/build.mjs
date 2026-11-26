// Writes docs/api-guide.html from template.html, facts.json (made by extract.mts) and guide.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'docs', 'api-guide.html');
const read = (f) => readFileSync(path.join(HERE, f), 'utf8');

// Inside <script type="application/json">, only "</" needs escaping.
const embed = (json) => JSON.stringify(JSON.parse(json)).replace(/<\//g, '<\/');

const html = read('template.html')
  .replace('__FACTS__', () => embed(read('facts.json')))
  .replace('__GUIDE__', () => embed(read('guide.json')));
writeFileSync(OUT, html);
console.log(`docs/api-guide.html: ${(html.length / 1024).toFixed(0)} KB`);
