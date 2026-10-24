import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// One self-contained file: the build puts the script and the styles inside index.html. Browsers
// refuse to load a separate module script from a file:// page, so this is what lets the page run
// by double-clicking dist/index.html, with no web server. The same file works on any host and at
// any base path.
function singleFile(): Plugin {
  return {
    name: 'd4-tracker-single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName === 'index.html');
      if (!html || html.type !== 'asset') return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk') {
          const tag = new RegExp(`<script type="module" crossorigin src="\\./${file.fileName}"></script>`);
          if (!tag.test(page)) throw new Error(`single-file: no script tag for ${file.fileName}`);
          // A literal "</script" inside the code would end the inline script early.
          const code = file.code.replaceAll('</script', '<\\/script');
          page = page.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.fileName.endsWith('.css')) {
          const tag = new RegExp(`<link rel="stylesheet" crossorigin href="\\./${file.fileName}">`);
          if (!tag.test(page)) throw new Error(`single-file: no stylesheet tag for ${file.fileName}`);
          page = page.replace(tag, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      // The browser enforces what the page promises: nothing loads or connects anywhere but this
      // page's own address. Added at build time only (the dev server injects its own scripts).
      const charset = '<meta charset="utf-8">';
      if (!page.includes(charset)) throw new Error('single-file: no charset meta to place the CSP after');
      page = page.replace(charset, `${charset}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      html.source = page;
    },
  };
}

/** Inline script and styles, a data: icon, and requests only to the page's own origin. */
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

export default defineConfig({
  base: './',
  plugins: [singleFile()],
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
