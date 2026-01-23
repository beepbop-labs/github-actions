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
  const pkgs = await WorkspaceService.loadAllPackages({
    rootPath: inputs.rootPath,
    inputs,
  });

  // Step 2: Detect changed packages
  GitHubGateway.logStep(2, "Detect changed packages");
  let changedPkgs: T_Package[];
  if (inputs.forcePublish) {
    console.log("🔥 Force publish enabled: including all packages");
    changedPkgs = pkgs;
  } else {
    changedPkgs = await WorkspaceService.getChangedPackages({ rootPath: inputs.rootPath, pkgs });
  }
  console.log(`📦 Directly changed packages: ${changedPkgs.map((pkg) => pkg.name).join(", ") || "none"}`);
  if (changedPkgs.length === 0) {
    console.log("⏭️ No changed packages, exiting");
    return;
  }

  // Step 3: Expand dependent packages
  GitHubGateway.logStep(3, "Expand dependent packages");
  const expandedPkgs = WorkspaceService.expandDependents({ allPkgs: pkgs, changedPkgs });

  if (expandedPkgs.length > changedPkgs.length) {
    console.log(`📦 Expanded package list: ${expandedPkgs.map((pkg) => pkg.name).join(", ") || "none"}`);
  } else {
    console.log("📦 No additional dependent packages found");
  }

  // Step 4: Filter npm-publishable packages
  GitHubGateway.logStep(4, "Filter npm-publishable packages");
  const npmPackages = expandedPkgs.filter((pkg) => pkg.hasNpmTag);
  console.log(`📦 NPM-publishable packages: ${npmPackages.map((pkg) => pkg.name).join(", ") || "none"}`);

  if (npmPackages.length === 0) {
    console.log("⏭️ No npm-publishable packages, exiting");
    return;
  }

  // Step 5: Resolve execution order
  GitHubGateway.logStep(5, "Resolve workspace execution order");
  const orderedBatches = WorkspaceService.resolveExecutionBatches({ pkgs: npmPackages });

  orderedBatches.forEach((batch, index) => {
    console.log(`  Batch ${index + 1}: ${batch.map((pkg) => pkg.name).join(", ")}`);
  });

  // Step 6: Build packages
  GitHubGateway.logStep(6, "Build packages");

  const allPublishPackages = orderedBatches.flat();

  await PackageService.buildPackages({
    route: inputs.route,
    rootPath: inputs.rootPath,
    pkgs: allPublishPackages,
    buildCommand: inputs.buildCommand,
  });

  console.log("✅ Build complete");

  // Step 7: Publish packages in Parallel Batches
  GitHubGateway.logStep(7, "Publish packages (Parallel Batches)");

  const published = await WorkspaceService.publishBatches({
    batches: orderedBatches,
    inputs,
    allPkgs: pkgs,
  });

  console.log(`🚀 Published ${published.length} packages: ${published.map((p) => p.name).join(", ")}`);
};

export const WorkspacePublishRunner = {
  run,
};
