/**
 * npm-release-turborepo-workspace workflow
 *
 * Release workflow for multiple workspace packages with dependency resolution
 */

import { getEnv, setOutput, exec, resolveWorkspaceDeps, publishWorkspacePackages } from "./utils";
import {
  type T_ReleaseTurborepoWorkspaceInputs,
  DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS,
} from "./types/workflow-inputs";

import * as fs from "fs/promises";
import * as path from "path";

function getInputs(): T_ReleaseTurborepoWorkspaceInputs {
  return {
    buildCommand: getEnv("INPUT_BUILD_COMMAND", DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.buildCommand),
    bumpLevel: getEnv(
      "INPUT_BUMP_LEVEL",
      DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.bumpLevel,
    ) as T_ReleaseTurborepoWorkspaceInputs["bumpLevel"],
    mainBranch: getEnv("INPUT_MAIN_BRANCH", DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.mainBranch),
    devBranch: getEnv("INPUT_DEV_BRANCH", DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.devBranch),
    access: getEnv(
      "INPUT_ACCESS",
      DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.access,
    ) as T_ReleaseTurborepoWorkspaceInputs["access"],
    packageDir: getEnv("INPUT_PACKAGE_DIR", DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.packageDir),
    rootDir: getEnv("INPUT_ROOT_DIR", DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.rootDir),
    forcePublish:
      getEnv("INPUT_FORCE_PUBLISH", String(DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS.forcePublish)) === "true",
  };
}

/**
 * Get all workspace packages from packages/ directory
 */
async function getWorkspacePackages(rootDir: string): Promise<string[]> {
  const packagesDir = path.join(rootDir, "packages");
  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

/**
 * Get packages that have changes since last commit
 */
async function getChangedPackages(workspacePackages: string[], rootDir: string): Promise<string[]> {
  const { exec: execCmd } = await import("./utils");
  const result = await execCmd("git diff --name-only HEAD~1", {
    cwd: rootDir,
    silent: true,
  });

  const changedFiles = result.stdout.split("\n").filter(Boolean);
  const changedPackages: string[] = [];

  for (const pkg of workspacePackages) {
    const hasChanges = changedFiles.some((file) => file.startsWith(`packages/${pkg}/`));
    if (hasChanges) {
      changedPackages.push(pkg);
    }
  }

  return changedPackages;
}

/**
 * Filter packages that have npm: true in package.json
 */
async function filterNpmPackages(packages: string[], rootDir: string): Promise<string[]> {
  const npmPackages: string[] = [];

  for (const pkg of packages) {
    try {
      const pkgJsonPath = path.join(rootDir, "packages", pkg, "package.json");
      const content = await fs.readFile(pkgJsonPath, "utf-8");
      const pkgJson = JSON.parse(content);

      if (pkgJson.npm === true) {
        npmPackages.push(pkg);
      }
    } catch {
      // Package might not have package.json
    }
  }

  return npmPackages;
}

async function main(): Promise<void> {
  const inputs = getInputs();
  console.log("🚀 Starting npm-release-turborepo-workspace workflow");
  console.log(`📁 Root directory: ${inputs.rootDir}`);

  // Step 1: Read workspace packages
  console.log("\n📦 Reading workspace packages...");
  const workspacePackages = await getWorkspacePackages(inputs.rootDir);
  console.log(`📦 Workspace packages: ${workspacePackages.join(", ")}`);

  // Step 2: Detect changed packages
  console.log("\n🔍 Detecting changed packages...");
  const changedPackages = await getChangedPackages(workspacePackages, inputs.rootDir);
  console.log(`📦 Changed packages: ${changedPackages.join(", ") || "none"}`);

  if (changedPackages.length === 0) {
    console.log("⏭️ No packages changed, exiting");
    setOutput("published-packages", "");
    return;
  }

  // Step 3: Filter npm-publishable packages
  console.log("\n📋 Filtering npm-publishable packages...");
  const npmPackages = await filterNpmPackages(changedPackages, inputs.rootDir);
  console.log(`📦 NPM-publishable packages: ${npmPackages.join(", ") || "none"}`);

  if (npmPackages.length === 0) {
    console.log("⏭️ No npm-publishable packages, exiting");
    setOutput("published-packages", "");
    return;
  }

  // Step 4: Resolve workspace dependencies
  console.log("\n🔗 Resolving workspace dependencies...");
  const depsResult = await resolveWorkspaceDeps({
    packages: npmPackages,
    rootDir: inputs.rootDir,
  });
  const orderedPackages = depsResult.orderedPackages;
  console.log(`📦 Publishing order: ${orderedPackages.join(", ")}`);

  // Step 5: Build packages with turborepo
  console.log("\n🔨 Building packages with turborepo...");
  const filterArgs = orderedPackages.map((pkg) => `--filter=${pkg}...`).join(" ");
  await exec(`bun install --frozen-lockfile`, { cwd: inputs.rootDir });
  await exec(`bunx turbo run "${inputs.buildCommand}" ${filterArgs}`, { cwd: inputs.rootDir });
  console.log("✅ Build complete");

  // Step 6: Publish packages sequentially
  console.log("\n📤 Publishing packages sequentially...");
  const publishResult = await publishWorkspacePackages({
    packages: orderedPackages,
    bumpLevel: inputs.bumpLevel,
    rootDir: inputs.rootDir,
    devBranch: inputs.devBranch,
    access: inputs.access,
  });

  const publishedNames = publishResult.publishedPackages.map((p) => p.folderName).join(",");
  setOutput("published-packages", publishedNames);

  console.log("\n✅ npm-release-turborepo-workspace workflow complete!");
}

main().catch((error) => {
  console.error("❌ Workflow failed:", error);
  process.exit(1);
});
