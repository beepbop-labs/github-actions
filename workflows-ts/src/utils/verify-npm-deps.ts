/**
 * Verify that package.json only contains valid npm-resolvable dependencies
 */

import { readPackageJson, error } from "./github";

export interface VerifyNpmDepsOptions {
  workingDirectory: string;
}

export interface InvalidDependency {
  name: string;
  version: string;
  type: "dependencies" | "devDependencies" | "peerDependencies";
}

export interface VerifyNpmDepsResult {
  valid: boolean;
  invalidDeps: InvalidDependency[];
}

/**
 * Check if a version string is valid semver that npm can resolve
 */
function isValidSemver(version: string): boolean {
  // Check for invalid non-semver patterns first
  if (/^(workspace|file|link|git|http|https):/.test(version)) {
    return false;
  }

  // Check for valid semver patterns that npm can resolve:
  // Exact versions: 1.2.3, 0.1.0 (MAJOR.MINOR.PATCH format only)
  // Caret ranges: ^1.2.3, ^0.1.0 (allows compatible updates)
  // Tilde ranges: ~1.2.3, ~1.2.0 (allows patch-level updates)
  // Comparison operators: >=1.2.3, >1.2.0, <2.0.0, <=1.2.3, =1.2.3
  // Pre-release versions: 1.2.3-alpha.1, 1.2.3-beta.2, 1.2.3-rc.1
  if (/^[\^~><=*]?[0-9]+(\.[0-9]+)*(\.[0-9]+)*(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/.test(version)) {
    return true;
  }

  // Allow complex version ranges like '>=1.0.0 <2.0.0', '1.0.0 - 2.0.0'
  if (/^(>=|>|<=|<|=)[0-9]+(\.[0-9]+)*(\.[0-9]+)*.*$/.test(version)) {
    return true;
  }

  // Allow npm dist-tags: latest, stable, beta, alpha, next, canary, rc
  if (/^(latest|stable|beta|alpha|next|canary|rc)$/.test(version)) {
    return true;
  }

  // Allow wildcard
  if (version === "*") {
    return true;
  }

  return false;
}

/**
 * Verify all dependencies in package.json are npm-resolvable
 */
export async function verifyNpmDeps(options: VerifyNpmDepsOptions): Promise<VerifyNpmDepsResult> {
  const { workingDirectory } = options;

  console.log("🔍 Checking for valid semver dependencies in package.json...");

  const pkg = await readPackageJson(workingDirectory);
  const invalidDeps: InvalidDependency[] = [];

  const depTypes = ["dependencies", "devDependencies", "peerDependencies"] as const;

  for (const depType of depTypes) {
    const deps = pkg[depType] || {};
    for (const [name, version] of Object.entries(deps)) {
      if (!isValidSemver(version as string)) {
        invalidDeps.push({
          name,
          version: version as string,
          type: depType,
        });
      }
    }
  }

  if (invalidDeps.length > 0) {
    error("Found invalid dependency versions in package.json:");
    for (const dep of invalidDeps) {
      console.log(`  - ${dep.name}@${dep.version} (${dep.type})`);
    }
    console.log("");
    console.log("This workflow requires all dependencies to use valid semver versions.");
    console.log("Use 'npm-release-turborepo-workspace' workflow for workspace dependencies.");
    return { valid: false, invalidDeps };
  }

  console.log("✅ All dependencies have valid semver versions");
  return { valid: true, invalidDeps: [] };
}
