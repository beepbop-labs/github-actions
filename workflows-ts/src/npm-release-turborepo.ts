/**
 * npm-release-turborepo workflow
 *
 * Release workflow for single packages within a turborepo monorepo
 */

import {
  getEnv,
  setOutput,
  exec,
  readPackageJson,
  verifyNpmDeps,
  getNpmVersion,
  calcNewVersion,
  checkChanges,
  npmPublish,
} from "./utils";
import { type T_ReleaseTurborepoInputs, DEFAULT_RELEASE_TURBOREPO_INPUTS } from "./types/workflow-inputs";

function getInputs(): T_ReleaseTurborepoInputs {
  return {
    buildCommand: getEnv("INPUT_BUILD_COMMAND", DEFAULT_RELEASE_TURBOREPO_INPUTS.buildCommand),
    bumpLevel: getEnv(
      "INPUT_BUMP_LEVEL",
      DEFAULT_RELEASE_TURBOREPO_INPUTS.bumpLevel,
    ) as T_ReleaseTurborepoInputs["bumpLevel"],
    mainBranch: getEnv("INPUT_MAIN_BRANCH", DEFAULT_RELEASE_TURBOREPO_INPUTS.mainBranch),
    devBranch: getEnv("INPUT_DEV_BRANCH", DEFAULT_RELEASE_TURBOREPO_INPUTS.devBranch),
    access: getEnv("INPUT_ACCESS", DEFAULT_RELEASE_TURBOREPO_INPUTS.access) as T_ReleaseTurborepoInputs["access"],
    packageDir: getEnv("INPUT_PACKAGE_DIR", DEFAULT_RELEASE_TURBOREPO_INPUTS.packageDir),
    rootDir: getEnv("INPUT_ROOT_DIR", DEFAULT_RELEASE_TURBOREPO_INPUTS.rootDir),
    forcePublish: getEnv("INPUT_FORCE_PUBLISH", String(DEFAULT_RELEASE_TURBOREPO_INPUTS.forcePublish)) === "true",
  };
}

async function main(): Promise<void> {
  const inputs = getInputs();
  console.log("🚀 Starting npm-release-turborepo workflow");
  console.log(`📁 Root directory: ${inputs.rootDir}`);
  console.log(`📁 Package directory: ${inputs.packageDir}`);

  // Step 1: Read package.json
  console.log("\n📦 Reading package.json...");
  const pkg = await readPackageJson(inputs.packageDir);
  const packageName = pkg.name;
  console.log(`📦 Package: ${packageName}`);

  // Step 2: Verify npm dependencies
  console.log("\n🔍 Verifying npm dependencies...");
  const depsResult = await verifyNpmDeps({ workingDirectory: inputs.packageDir });
  if (!depsResult.valid) {
    process.exit(1);
  }

  // Step 3: Get latest npm version
  console.log("\n📊 Getting latest npm version...");
  const npmVersionResult = await getNpmVersion({
    packageName,
    devBranch: inputs.devBranch,
  });

  // Step 4: Calculate new version
  console.log("\n🔢 Calculating new version...");
  const versionResult = await calcNewVersion({
    npmVersion: npmVersionResult.version,
    bumpLevel: inputs.bumpLevel,
    mainBranch: inputs.mainBranch,
    devBranch: inputs.devBranch,
  });

  if (versionResult.skipped || !versionResult.version) {
    console.log("⏭️ Version calculation skipped, exiting");
    setOutput("new-version", "");
    return;
  }

  // Step 5: Build with turborepo (from root, filtering to package)
  console.log("\n🔨 Building with turborepo...");
  await exec(`bun install --frozen-lockfile`, { cwd: inputs.rootDir });
  await exec(`bunx turbo run "${inputs.buildCommand}" --filter="${packageName}..."`, { cwd: inputs.rootDir });
  console.log("✅ Build complete");

  // Step 6: Check for changes (unless force publish)
  let hasChanges = true;
  if (!inputs.forcePublish) {
    console.log("\n🔍 Checking for changes...");
    const changesResult = await checkChanges({
      packageName,
      npmVersion: npmVersionResult.version,
      workingDirectory: inputs.packageDir,
    });
    hasChanges = changesResult.hasChanges;
  }

  // Step 7: Publish
  if (inputs.forcePublish || hasChanges) {
    console.log("\n📤 Publishing to npm...");
    await npmPublish({
      version: versionResult.version,
      devBranch: inputs.devBranch,
      access: inputs.access,
      workingDirectory: inputs.packageDir,
    });
    setOutput("new-version", versionResult.version);
  } else {
    console.log("\n⏭️ No changes to publish");
    setOutput("new-version", "");
  }

  console.log("\n✅ npm-release-turborepo workflow complete!");
}

main().catch((error) => {
  console.error("❌ Workflow failed:", error);
  process.exit(1);
});
