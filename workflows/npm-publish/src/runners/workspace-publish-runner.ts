import { GitHubGateway } from "@/gateways/github-gateway";
import type { T_WorkflowInputs } from "@/types/inputs";
import { WorkspaceService } from "../services/workspace-service";
import { PackageService } from "../services/package-service";
import type { T_Package } from "@/types/package";

type T_RunWorkspacePublish = {
  inputs: T_WorkflowInputs;
};

const run = async ({ inputs }: T_RunWorkspacePublish): Promise<void> => {
  console.log(`📁 Route: ${inputs.route}`);
  console.log(`📁 Root directory: ${inputs.rootPath}`);

  // Step 1: Load all packages metadata
  GitHubGateway.logStep(1, "Load all packages metadata");
  const allPkgs = await WorkspaceService.loadAllPackages({
    rootPath: inputs.rootPath,
    inputs,
  });

  // Step 2: Filter npm-publishable packages
  GitHubGateway.logStep(2, "Filter npm-publishable packages");
  const npmPackages = allPkgs.filter((pkg) => pkg.hasNpmTag);
  const npmPackageNames = new Set(npmPackages.map((pkg) => pkg.name));
  console.log(`📦 NPM-publishable packages: ${npmPackages.map((pkg) => pkg.name).join(", ") || "none"}`);

  if (npmPackages.length === 0) {
    console.log("⏭️ No npm-publishable packages, exiting");
    return;
  }

  // Step 3: Build packages
  GitHubGateway.logStep(3, "Build packages");

  await PackageService.buildPackages({
    route: inputs.route,
    rootPath: inputs.rootPath,
    pkgs: npmPackages,
    buildCommand: inputs.buildCommand,
  });

  console.log("✅ Build complete");

  // Step 4: Check for changes
  GitHubGateway.logStep(4, "Check for changes");

  let changedPkgs: T_Package[];
  if (inputs.forcePublish) {
    console.log("🔥 Force publish enabled: including all packages");
    changedPkgs = npmPackages;
  } else {
    console.log("🔍 Starting change detection...");
    try {
      // Add timeout to prevent the entire change detection from hanging indefinitely
      const changeDetectionPromise = PackageService.checkChanges({ pkgs: npmPackages });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Change detection timed out after 10 minutes")), 10 * 60 * 1000);
      });

      changedPkgs = await Promise.race([changeDetectionPromise, timeoutPromise]);
      console.log(`📦 Changed packages: ${changedPkgs.map((pkg) => pkg.name).join(", ") || "none"}`);
    } catch (error) {
      console.error(`❌ Change detection failed: ${error instanceof Error ? error.message : String(error)}`);
      // If change detection fails completely, fall back to assuming all packages have changes
      console.log("🔄 Falling back to publishing all packages due to change detection failure");
      changedPkgs = npmPackages;
    }
  }

  if (changedPkgs.length === 0) {
    console.log("⏭️ No changed packages, exiting");
    return;
  }

  // Step 5: Expand dependent packages
  GitHubGateway.logStep(5, "Expand dependent packages");
  const expandedPkgs = WorkspaceService.expandDependents({ allPkgs, changedPkgs });

  if (expandedPkgs.length > changedPkgs.length) {
    console.log(`📦 Expanded package list: ${expandedPkgs.map((pkg: T_Package) => pkg.name).join(", ") || "none"}`);
  } else {
    console.log("📦 No additional dependent packages found");
  }

  // Step 6: Filter npm-publishable packages (use the pre-computed set for efficiency)
  GitHubGateway.logStep(6, "Filter npm-publishable packages");
  const publishPkgs = expandedPkgs.filter((pkg) => npmPackageNames.has(pkg.name));
  console.log(`📦 Final packages to publish: ${publishPkgs.map((pkg: T_Package) => pkg.name).join(", ") || "none"}`);

  if (publishPkgs.length === 0) {
    console.log("⏭️ No npm-publishable packages to publish, exiting");
    return;
  }

  // Step 7: Resolve execution order
  GitHubGateway.logStep(7, "Resolve workspace execution order");
  const orderedBatches = WorkspaceService.resolveExecutionBatches({ pkgs: publishPkgs });

  orderedBatches.forEach((batch, index) => {
    console.log(`  Batch ${index + 1}: ${batch.map((pkg) => pkg.name).join(", ")}`);
  });

  // Step 8: Publish packages in Parallel Batches
  GitHubGateway.logStep(8, "Publish packages (Parallel Batches)");

  const published = await WorkspaceService.publishBatches({
    batches: orderedBatches,
    inputs,
    allPkgs,
  });

  console.log(`🚀 Published ${published.length} packages: ${published.map((p) => p.name).join(", ")}`);

  // Ensure function completes cleanly
  return;
};

export const WorkspacePublishRunner = {
  run,
};
