import type { T_WorkflowInputs } from "@/types/inputs";
import { GitHubGateway } from "@/gateways/github-gateway";
import { PackageService } from "@/services/package-service";

type T_RunPackagePublish = {
  inputs: T_WorkflowInputs;
};

const run = async ({ inputs }: T_RunPackagePublish): Promise<void> => {
  console.log(`📁 Route: ${inputs.route}`);
  console.log(`📁 Root directory: ${inputs.rootPath}`);
  console.log(`📁 Package directory: ${inputs.packagePath}`);

  // Step 1: Load package metadata
  GitHubGateway.logStep(1, "Load package metadata");
  const pkg = await PackageService.loadPackage({
    packagePath: inputs.packagePath,
    inputs,
  });

  console.log(`📦 Package: ${pkg.name}`);
  console.log(`📦 Current version: ${pkg.version}`);

  // Step 2: Verify npm dependencies
  GitHubGateway.logStep(2, "Verify dependencies");
  if (pkg.dependencies.some((dependency) => dependency.type === "workspace")) {
    throw new Error("Workspace dependencies are not supported in package route");
  }
  console.log("✅ All dependencies are valid npm packages");

  // Step 3: Build
  GitHubGateway.logStep(3, "Build package");

  await PackageService.buildPackages({
    route: inputs.route,
    rootPath: inputs.rootPath,
    pkgs: [pkg],
    buildCommand: inputs.buildCommand,
  });

  // Step 4: Check for changes (unless force publish)
  GitHubGateway.logStep(4, "Check for changes");

  let hasChanges = true;
  if (!inputs.forcePublish) {
    hasChanges = (await PackageService.checkChanges({ pkgs: [pkg] })).length > 0;
    if (hasChanges) console.log("✅ Changes detected");
    else console.log("⏭️ No changes detected");
  } else {
    console.log("⏭️ Force publish enabled, skipping check for changes");
  }

  const needsPublishing = inputs.forcePublish || hasChanges;

  // Early return if no publishing needed
  if (!needsPublishing) {
    console.log("⏭️ No changes to publish");
    return;
  }

  // Step 5: Calculate new version
  GitHubGateway.logStep(5, "Calculate update version");
  const updateVersion = await PackageService.calcUpdateVersion({
    currentVersion: pkg.version,
    bumpLevel: inputs.bumpLevel,
  });
  console.log(`📦 Update version: ${updateVersion}`);

  // Step 6: Publish
  GitHubGateway.logStep(6, "Publish to npm");

  // Update package.json with new version
  pkg.json.version = updateVersion;
  await PackageService.writePackageJson({ pkg });

  // Publish to npm
  const tag = GitHubGateway.getCurrentTag();
  await PackageService.publishPackage({ pkg, tag, access: inputs.access });

  console.log(`🚀 Published ${pkg.name}@${updateVersion}`);

  // Ensure function completes cleanly
  return;
};

export const PackagePublishRunner = {
  run,
};
