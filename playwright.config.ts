import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const venvPython =
  process.platform === "win32"
    ? ".venv\\Scripts\\python.exe"
    : ".venv/bin/python";
const python = existsSync(venvPython) ? venvPython : "python";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:4178" },
  webServer: [
    {
      command: `${python} -m uvicorn geocrop.api:app --port 8008`,
      port: 8008,
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 4178",
      port: 4178,
      reuseExistingServer: false,
      env: { GEOCROP_API: "http://127.0.0.1:8008" },
    },
  ],
});
