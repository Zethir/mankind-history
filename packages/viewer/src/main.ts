import { fetchArtifacts } from "./data/artifacts";

async function start(): Promise<void> {
  const app = document.querySelector("#app");
  if (!app) throw new Error("#app is missing from index.html");
  app.textContent = "Loading...";
  const artifacts = await fetchArtifacts();
  app.textContent = `${artifacts.polities.polities.length} polities, ${artifacts.versions.rows.length} versions`;
}

void start();
