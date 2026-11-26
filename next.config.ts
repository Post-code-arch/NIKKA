import { execSync } from "node:child_process";
import type { NextConfig } from "next";

/** Version shown in the app (commit + date), so an update can be checked at a glance. */
function version() {
  try {
    return execSync('git log -1 --format="%h · %cd" --date=format:"%d/%m %H:%M"', { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  devIndicators: false,
  env: { NEXT_PUBLIC_NIKKA_VERSION: version() },
};

export default nextConfig;
