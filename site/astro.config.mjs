// @ts-check
/*
 * The documentation site.
 *
 * docs/*.md stays the CANONICAL source: readable in the repo, readable on
 * a git host, and the thing contributors edit. This site consumes it --
 * `bun run docs:sync` copies those files in and adds the frontmatter
 * Starlight wants, so nothing is written twice and the two can never
 * drift apart. Everything under src/content/docs/ is generated; edit
 * ../docs instead.
 */
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Starlight refuses to build when the sidebar names a page that is not
   there, so the sidebar is filtered against what docs/ actually holds.
   A doc added or removed upstream therefore needs no edit here, and a
   half-written documentation set still builds. */
const CONTENT = fileURLToPath(new URL('./src/content/docs/', import.meta.url));
const have = existsSync(CONTENT)
  ? new Set(readdirSync(CONTENT)
      .filter((f) => f.endsWith('.md') || f.endsWith('.mdx'))
      .map((f) => f.replace(/\.mdx?$/, '')))
  : new Set();

/* `link` rather than `slug`: Starlight validates slugs against the content
   collection at config time, which a GENERATED collection loses races
   with. A plain path is resolved at render and needs no such handshake. */
function group(label, items) {
  const kept = items
    .filter((i) => have.has(i.slug))
    .map((i) => ({ label: i.label, link: i.slug === 'index' ? '/' : '/' + i.slug + '/' }));
  return kept.length ? [{ label, items: kept }] : [];
}

/* anything synced but not placed in a group below still gets a home,
   rather than being silently unreachable */
function leftovers(placed) {
  const rest = [...have].filter((s) => s !== 'index' && !placed.has(s)).sort();
  return rest.length
    ? [{ label: 'More', items: rest.map((slug) => ({ label: slug, link: '/' + slug + '/' })) }]
    : [];
}

/* A static host resolves /viewer/ to /viewer/index.html; `astro dev`
   does not, for anything sitting in public/. So the hand-written pages
   there — the figure viewer and the landing-page candidates — 404 in dev
   and work once built, which is the worst way round: you test a link,
   see it fail, and go looking for a bug that is not there.

   This makes dev behave like the host. Dev only; the build output already
   has the right shape. */
function publicDirIndexes() {
  return {
    name: 'mjsx:public-dir-indexes',
    hooks: {
      'astro:server:setup': ({ server }) => {
        const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
        server.middlewares.use((req, res, next) => {
          const [path, rest] = req.url.split(/(?=[?#])/);
          if (path === '/') return next();

          /* /landing -> /landing/ as a REDIRECT, not a rewrite. The chooser
             links to its siblings relatively (`oscilloscope/`), and a
             relative href on a slashless URL resolves against the PARENT:
             serving the page at /landing would send those links to
             /oscilloscope/. A static host redirects here for the same
             reason, so dev matching it keeps the two honest. */
          if (!path.endsWith('/') && existsSync(join(PUBLIC, path, 'index.html'))) {
            res.statusCode = 301;
            res.setHeader('Location', path + '/' + (rest || ''));
            res.end();
            return;
          }
          /* and /landing/ -> /landing/index.html, which `astro dev` does
             not do for anything under public/ */
          if (path.endsWith('/')) {
            const candidate = join(PUBLIC, path, 'index.html');
            if (existsSync(candidate)) req.url = path + 'index.html' + (rest || '');
          }
          next();
        });
      },
    },
  };
}

/* WIDE TABLES.
 * docs/consistency.md is mostly matrices — one has ten columns — and
 * Starlight drops a table straight into a 45rem prose column with no
 * scroll container. The table then obeys the column instead of its own
 * content: cells were crushed to 45px and `clear` came out as "cl / ea / r"
 * stacked vertically, three characters wide. Unreadable, and the columns
 * past the eighth were simply off the page.
 *
 * A table is not prose and should not be measured like prose. This wraps
 * every one in its own scroll container so it can be as wide as its
 * content needs and scroll sideways inside the article, and marks the wide
 * ones so their cells stop wrapping.
 */
function wrapTables() {
  return function (tree) {
    walk(tree, null, null);
  };
  function walk(node, parent, index) {
    if (!node || !node.children) return;
    for (let i = node.children.length - 1; i >= 0; i--) {
      walk(node.children[i], node, i);
    }
    if (node.tagName !== 'table' || !parent) return;
    if (parent.properties && String(parent.properties.className || '').includes('table-scroll')) return;

    /* the widest row decides: a matrix's header is the honest count, but
       read the body too in case a header is missing */
    let cols = 0;
    const countRow = (n) => {
      if (!n || !n.children) return;
      if (n.tagName === 'tr') {
        const c = n.children.filter((k) => k.tagName === 'th' || k.tagName === 'td').length;
        if (c > cols) cols = c;
      }
      n.children.forEach(countRow);
    };
    countRow(node);

    parent.children[index] = {
      type: 'element',
      tagName: 'div',
      properties: { className: cols > 5 ? ['table-scroll', 'is-wide'] : ['table-scroll'],
                    'data-cols': String(cols) },
      children: [node]
    };
  }
}

export default defineConfig({
  markdown: { rehypePlugins: [wrapTables] },
  site: 'https://example.invalid/mjsx',
  base: '/',
  outDir: './dist',
  integrations: [
    publicDirIndexes(),
    starlight({
      title: 'mjsx',
      description:
        'JSX for microcontrollers, Raspberry Pi, desktop and the browser — one core, several backends.',
      /* No repo link: this project is not published yet, and a dead
         "edit this page" link is worse than none. */
      customCss: ['./src/styles/mjsx.css'],
      /* An embedded simulator measures itself and posts its height; this
         resizes the frame to match, so a live simulator in an article never
         has its own scrollbar and never leaves a gap. Same-origin only —
         the message is ignored otherwise. */
      head: [{
        tag: 'script',
        content:
          /* an embedded simulator measures itself and posts its height;
             resize the frame to match, so it never has its own scrollbar */
          "addEventListener('message',function(e){" +
          "if(e.origin!==location.origin)return;" +
          "var d=e.data;if(!d||d.mjsx!=='sim-height')return;" +
          "var f=document.querySelectorAll('iframe.sim-embed');" +
          "for(var i=0;i<f.length;i++){if(f[i].contentWindow===e.source)" +
          "f[i].style.height=d.height+'px';}});" +
          /* A "Run it" link on a page that ALREADY has a simulator should
             load it there, not throw the reader onto another page and lose
             their place. With no simulator on the page the link navigates,
             which is what it always did. */
          "addEventListener('click',function(e){" +
          "var a=e.target.closest&&e.target.closest('a.run-example');if(!a)return;" +
          "var h=a.getAttribute('href');var i=h.indexOf('#');if(i<0)return;" +
          "e.preventDefault();" +
          "var f=document.querySelector('iframe.sim-embed');" +
          /* No simulator on this page yet: put a compact one right where
             the reader clicked, rather than sending them somewhere else to
             see a thing they asked to see HERE. Created on demand, so a
             page nobody runs anything on carries no extra weight. */
          "if(!f){f=document.createElement('iframe');" +
          "f.className='sim-embed compact';f.title='mjsx simulator';" +
          "f.setAttribute('loading','lazy');" +
          "(a.parentNode||document.body).insertBefore(f,a.nextSibling);}" +
          "var base=(f.getAttribute('src')||'/play/?embed=1&compact=1').split('#')[0];" +
          "f.src=base+h.slice(i);" +
          "f.scrollIntoView({block:'center',behavior:'smooth'});});"
      }],
      sidebar: [
        ...group('Start here', [
          { label: 'Overview', slug: 'index' },
          { label: 'Getting started', slug: 'getting-started' },
        ]),
        ...group('Try it', [
          { label: 'The simulator', slug: 'simulator' },
        ]),
        ...group('Building a UI', [
          { label: 'The UI API', slug: 'ui' },
          { label: 'Layout', slug: 'layout' },
          { label: 'Fonts and text', slug: 'fonts' },
          { label: 'Components', slug: 'components' },
          { label: 'Every shape', slug: 'shapes' },
        ]),
        ...group('Text entry', [
          { label: 'Keyboards', slug: 'keyboards' },
          { label: 'Inputs', slug: 'input' },
        ]),
        ...group('Devices', [
          { label: 'Boards and flashing', slug: 'devices' },
          { label: 'Round displays', slug: 'round' },
          { label: 'Sensors', slug: 'sensors' },
          { label: 'Hardware API', slug: 'hardware-api' },
        ]),
        ...group('Reference', [
          { label: 'The backend contract', slug: 'contract' },
          { label: 'Backend consistency', slug: 'consistency' },
          { label: 'How the figures are made', slug: 'shots' },
        ]),
        /* Anything synced but not placed above still gets a home rather
           than being unreachable — but it lands under a raw slug, which is
           how `shapes` and `shots` sat in the sidebar as lowercase
           filenames next to written labels. A page appearing here is a
           prompt to give it a group, not a resting place. */
        ...leftovers(new Set([
          'index', 'getting-started', 'simulator', 'ui', 'layout', 'fonts', 'components',
          'shapes', 'keyboards', 'input', 'devices', 'round', 'sensors', 'hardware-api',
          'contract', 'consistency', 'shots',
        ])),
      ],
    }),
  ],
});
