import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The OpenTelemetry and OpenAI packages patch each other at load time, which a bundle would break.
  serverExternalPackages: ["playwright", "jsdom", "together-ai", "openai", "@arizeai/phoenix-otel", "@arizeai/openinference-instrumentation-openai"],
  // A stray lockfile exists in a parent folder; pin the project root explicitly.
  outputFileTracingRoot: path.join(__dirname),
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
