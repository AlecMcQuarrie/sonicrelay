import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { version } from "./package.json";

export default defineConfig({
  base: '/',
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
