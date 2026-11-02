// Převede jednosouborový demo build na stránku pro Claude artefakt (bez vlastní kostry <html>/<head>/<body>).
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../dist-demo/index.html', import.meta.url), 'utf8');
const between = (s, open, close) => {
  const a = s.indexOf(open);
  if (a < 0) throw new Error(`Nenalezeno: ${open}`);
  const b = s.indexOf(close, a + open.length);
  return s.slice(a, b + close.length);
};
const title = between(src, '<title>', '</title>');
const links = [...src.matchAll(/<link [^>]*fonts\.(googleapis|gstatic)[^>]*>/g)].map((m) => m[0]).join('\n');
const scriptOpen = src.indexOf('<script type="module"');
const scriptStart = src.indexOf('>', scriptOpen) + 1;
const scriptEnd = src.indexOf('</script>', scriptStart);
const js = src.slice(scriptStart, scriptEnd);
const styleStart = src.indexOf('<style');
const styleEnd = src.indexOf('</style>', styleStart) + '</style>'.length;
const css = src.slice(styleStart, styleEnd);
const out = [title, links, css, '<div id="root"></div>', `<script type="module">${js}</script>`, ''].join('\n');
writeFileSync(new URL('../dist-demo/postovna-demo.html', import.meta.url), out);
console.log(`postovna-demo.html: ${(out.length / 1024).toFixed(0)} kB`);
