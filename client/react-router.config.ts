import type { Config } from "@react-router/dev/config";

export default {
  ssr: !process.env.ELECTRON,
} satisfies Config;
