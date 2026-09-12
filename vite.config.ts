import { defineConfig } from "vite";

/* The game lives in src/ and src/index.html is the entry, so root points
   there and the build climbs back out to dist/.

   base:"./" keeps the emitted asset URLs relative, so the built page works
   wherever it is served from — a subpath, an itch.io zip, or the Electron
   shell in step 5, which loads it off disk. */

export default defineConfig({
  root: "src",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022"
  }
});
