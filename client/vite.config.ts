import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import tsconfigPaths from "vite-tsconfig-paths";
import { version } from "./package.json";

// Audio worklet / WASM assets that aren't imported as modules (Web Audio
// and ONNX Runtime load them by URL at runtime) so Vite can't see them.
// Copy each into build output under /audio flat so the paths in voice.ts
// stay short.
//
// rename: { stripBase: true } flattens each match to dest/<basename> instead
// of dest/<full-source-path>/<basename> (the plugin's default when src
// includes a glob or a multi-segment path). `stripBase: true as const` is
// required because the plugin's type def accepts literal `true`, not
// `boolean`.
const flat = (src: string) => ({ src, dest: "audio", rename: { stripBase: true as const } });

const audioAssetCopies = [
  // RenameObject with both name + stripBase — name sets the basename,
  // stripBase prevents the plugin from nesting under the source path.
  { src: "node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise/workletProcessor.js", dest: "audio", rename: { name: "rnnoise-worklet.js", stripBase: true as const } },
  flat("node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise.wasm"),
  flat("node_modules/@sapphi-red/web-noise-suppressor/dist/rnnoise_simd.wasm"),
  flat("node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js"),
  flat("node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx"),
  flat("node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx"),
  // ONNX Runtime Web needs both .mjs glue and .wasm binaries reachable at
  // the same URL prefix. Copy the full dist/ folder flat into /audio.
  { src: "node_modules/onnxruntime-web/dist/*", dest: "audio", rename: { stripBase: true as const } },
];

export default defineConfig({
  base: '/',
  plugins: [
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    viteStaticCopy({ targets: audioAssetCopies }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
