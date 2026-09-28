// Bundles the CLI into one Node-compatible file that ships in the plugin (dist/csm.js).
import type { BunPlugin } from "bun";

// Ink only loads react-devtools-core when DEV=true, but the bundler hoists it to a static import.
const stubDevtools: BunPlugin = {
  name: "stub-react-devtools",
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: "react-devtools-core", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default {};", loader: "js" }));
  },
};

const result = await Bun.build({
  entrypoints: ["src/cli.tsx"],
  outdir: "dist",
  naming: "csm.js",
  target: "node",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [stubDevtools],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const out of result.outputs) console.log(`${out.path}  ${(out.size / 1024).toFixed(0)} KB`);
