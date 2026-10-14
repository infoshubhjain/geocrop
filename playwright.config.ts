import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const venvPython =
  process.platform === "win32"
    ? ".venv\\Scripts\\python.exe"
    : ".venv/bin/python";
const python = existsSync(venvPython) ? venvPython : "python";
const apiPort = Number(process.env.GEOCROP_TEST_API_PORT || 8008);
const webPort = Number(process.env.GEOCROP_TEST_WEB_PORT || 4178);

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: `http://127.0.0.1:${webPort}` },
  webServer: [
    {
      command: `${python} -m uvicorn geocrop.api:app --port ${apiPort}`,
      port: apiPort,
      reuseExistingServer: false,
    },
    {
      command: `npm run dev -- --port ${webPort}`,
      port: webPort,
      reuseExistingServer: false,
      env: { GEOCROP_API: `http://127.0.0.1:${apiPort}` },
    },
  ],
});
