import "./sites-env.mjs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Fetch only deployment credentials. Application/API secrets stay in Doppler.
const names = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
const credentials = {};
for (const name of names) {
  try {
    credentials[name] = execFileSync("doppler", [
      "secrets", "get", name,
      "--project", "ai-vision", "--config", "dev_personal",
      "--plain", "--no-check-version",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }).trim();
  } catch {
    console.error(`Could not read ${name} from Doppler ai-vision/dev_personal. Check your Doppler login.`);
    process.exit(1);
  }
  if (!credentials[name]) {
    console.error(`${name} is empty in Doppler ai-vision/dev_personal.`);
    process.exit(1);
  }
}

const redact = (text) => Object.values(credentials).reduce(
  (output, value) => output.replaceAll(value, "[redacted]"), text,
);
const deploy = spawn(process.execPath, [
  fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
  "deploy", "--config", "dist/server/wrangler.json",
], {
  env: { ...process.env, ...credentials },
  stdio: ["inherit", "pipe", "pipe"],
});

// Redact complete lines so a credential split across output chunks stays hidden.
for (const [source, target] of [[deploy.stdout, process.stdout], [deploy.stderr, process.stderr]]) {
  let pending = "";
  source.setEncoding("utf8");
  source.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop();
    for (const line of lines) target.write(redact(line) + "\n");
  });
  source.on("end", () => { if (pending) target.write(redact(pending)); });
}
deploy.on("error", () => {
  console.error("Could not start Wrangler. Install the project dependencies and retry.");
  process.exitCode = 1;
});
deploy.on("close", (code) => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => deploy.kill(signal));
