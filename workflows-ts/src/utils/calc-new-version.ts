/**
 * Calculate the new version to publish based on current version and bump level
 */

import { exec, getCurrentBranch, error } from "./github";

export interface CalcNewVersionOptions {
  npmVersion: string;
  bumpLevel: "major" | "minor" | "patch";
  mainBranch: string;
  devBranch: string;
}

export interface CalcNewVersionResult {
  version: string;
  skipped: boolean;
  reason?: string;
}

/**
 * Calculate the new version based on branch and bump level
 */
export async function calcNewVersion(options: CalcNewVersionOptions): Promise<CalcNewVersionResult> {
  const { bumpLevel, mainBranch, devBranch } = options;
  let npmVersion = options.npmVersion;
  const branch = getCurrentBranch();

  // Validate bump-level
  if (!["major", "minor", "patch"].includes(bumpLevel)) {
    error(`Invalid bump-level '${bumpLevel}'. Must be one of: major, minor, patch`);
    throw new Error(`Invalid bump-level: ${bumpLevel}`);
  }

  // Default to 0.0.0 if no version exists
  if (!npmVersion || npmVersion === "null") {
    npmVersion = "0.0.0";
  }

  // Main branch: regular semver bump
  if (branch === mainBranch) {
    const result = await exec(`bunx semver -i "${bumpLevel}" "${npmVersion}"`, {
      silent: true,
    });
    const newVersion = result.stdout.trim();
    console.log(`🆕 New version: ${newVersion} (bump: ${bumpLevel})`);
    return { version: newVersion, skipped: false };
  }

  // Dev branch: pre-release versioning
  if (branch === devBranch) {
    // Remove existing -dev.N suffix if present
    const base = npmVersion.replace(/-dev\.\d+$/, "");

    let next = 0;
    if (npmVersion.includes("-dev.")) {
      const prevMatch = npmVersion.match(/-dev\.(\d+)$/);
      if (prevMatch) {
        next = parseInt(prevMatch[1], 10) + 1;
      }
    }

    const newVersion = `${base}-dev.${next}`;
    console.log(`🆕 New version: ${newVersion} (bump: ${bumpLevel})`);
    return { version: newVersion, skipped: false };
  }

  // Other branches: skip
  console.log(`⏭️ Skipping: branch '${branch}' is not main or dev`);
  return {
    version: "",
    skipped: true,
    reason: `Branch '${branch}' is not main or dev`,
  };
}
