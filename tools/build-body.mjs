/* Generate deck.body.html from the game.
   ------------------------------------------------------------------
   deck.body.html is the embeddable fragment: the same page without
   the <!doctype>/<html>/<head>/<body> wrapper. It used to be a
   hand-maintained copy of the whole game, which meant two copies of
   the physics that had to be kept in step by hand — the one failure
   the test suite structurally cannot see, since it only reads sim.js.

   Now it is generated. `Weightless Deck.html` + `sim.js` are the only
   sources of truth.

   The fragment inlines sim.js rather than linking it, because an
   embedded fragment cannot rely on the host page serving a sibling
   sim.js from the right path.

     node tools/build-body.mjs           write deck.body.html
     node tools/build-body.mjs --check   verify it is up to date (CI)
*/

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "html version");
const CHECK = process.argv.includes("--check");

const html = readFileSync(join(ROOT, "Weightless Deck.html"), "utf8");
const sim = readFileSync(join(ROOT, "sim.js"), "utf8");

function build() {
  let out = html;

  // inline sim.js so the fragment is self-contained
  const tag = /<script\s+src=["']sim\.js["']\s*><\/script>\n?/;
  if (!tag.test(out)) {
    throw new Error("no <script src=\"sim.js\"> tag in Weightless Deck.html");
  }
  out = out.replace(tag,
    "<script>\n/* --- inlined from sim.js by tools/build-body.mjs --- */\n" +
    sim.trimEnd() + "\n</script>\n");

  // drop the document wrapper; keep title, links, style, markup, scripts
  const start = out.indexOf('<link rel="preconnect"');
  if (start < 0) throw new Error("could not find the head links");
  out = out.slice(start);
  out = out.replace(/^\s*<\/head>\s*$\n?/m, "")
           .replace(/^\s*<body>\s*$\n?/m, "")
           .replace(/^\s*<\/body>\s*$\n?/m, "")
           .replace(/^\s*<\/html>\s*$\n?/m, "");

  return "<title>Weightless Deck</title>\n" + out;
}

const generated = build();
const path = join(ROOT, "deck.body.html");

if (CHECK) {
  let current = "";
  try { current = readFileSync(path, "utf8"); } catch {}
  if (current !== generated) {
    console.error(
      "deck.body.html is out of date.\n" +
      "  It is generated — do not edit it by hand.\n" +
      "  Run: node tools/build-body.mjs"
    );
    process.exit(1);
  }
  console.log("deck.body.html is up to date");
} else {
  writeFileSync(path, generated);
  console.log(`deck.body.html  ${generated.split("\n").length} lines ` +
              `(sim.js inlined, ${(generated.length / 1024).toFixed(1)} KB)`);
}
