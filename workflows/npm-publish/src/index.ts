import { PackagePublishRunner } from "@/runners/package-publish-runner";
import { GitHubGateway } from "./gateways/github-gateway";
import { WorkspacePublishRunner } from "./runners/workspace-publish-runner";

const main = async (): Promise<void> => {
  try {
    console.log("🚀 Starting npm-publish workflow");
    const inputs = GitHubGateway.resolveInputs();
    console.log(`📋 Route: ${inputs.route}`);

    if (inputs.route === "package" || inputs.route === "turborepo-package") {
      console.log("📦 Running package publish");
      await PackagePublishRunner.run({
        inputs,
      });
      console.log("✅ Package publish completed");
    } else if (inputs.route === "turborepo-workspace") {
      console.log("📦 Running workspace publish");
      await WorkspacePublishRunner.run({
        inputs,
      });
      console.log("✅ Workspace publish completed");
    } else {
      throw new Error(`Invalid route: ${inputs.route}`);
    }

    console.log("✅ Workflow completed successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Workflow failed:", error);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("❌ Workflow failed:", error);
  process.exit(1);
});
