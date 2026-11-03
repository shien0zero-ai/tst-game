import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
let html = await readFile(new URL('index.html', dist), 'utf8');

// Bundle the built assets into one HTML document so file:// needs no server,
// module imports, CDN, or network requests.
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
if (scripts.length !== 1) throw new Error('Expected one built JavaScript entry point');
for (const [tag, path] of scripts) {
  const code = await readFile(new URL(path.replace(/^\//, ''), dist), 'utf8');
  const escaped = code.replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, () => `<script type="module">\n${escaped}\n</script>`);
}

const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
if (styles.length === 0) throw new Error('Expected a built stylesheet');
for (const [tag, path] of styles) {
  const css = await readFile(new URL(path.replace(/^\//, ''), dist), 'utf8');
  html = html.replace(tag, () => `<style>\n${css}\n</style>`);
}

const favicon = await readFile(new URL('public/favicon.svg', root));
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${favicon.toString('base64')}"`);
html = html.replace('class="brand" href="./"', 'class="brand" href="#"');

const output = new URL('artifacts/fieldcraft.html', root);
await mkdir(new URL('./', output), { recursive: true });
await writeFile(output, html);
console.log(`Standalone game: ${fileURLToPath(output)} (${Buffer.byteLength(html)} bytes)`);
