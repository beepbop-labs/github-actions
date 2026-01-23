import { PackagePublishRunner } from "@/runners/package-publish-runner";
import { GitHubGateway } from "./gateways/github-gateway";
import { WorkspacePublishRunner } from "./runners/workspace-publish-runner";

const main = async (): Promise<void> => {
  const inputs = GitHubGateway.resolveInputs();

  if (inputs.route === "package" || inputs.route === "turborepo-package") {
    await PackagePublishRunner.run({
      inputs,
    });
  } else if (inputs.route === "turborepo-workspace") {
    await WorkspacePublishRunner.run({
      inputs,
    });
  } else {
    throw new Error(`Invalid route: ${inputs.route}`);
  }
};

main().catch((error) => {
  console.error("❌ Workflow failed:", error);
  process.exit(1);
});
