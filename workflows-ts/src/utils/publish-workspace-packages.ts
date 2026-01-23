/**
 * Publish multiple workspace packages in dependency order
 */

import { exec, getCurrentBranch, readPackageJson, writePackageJson, getEnv } from "./github";

export interface PublishWorkspacePackagesOptions {
  packages: string[];
  bumpLevel: "major" | "minor" | "patch";
  rootDir?: string;
  devBranch?: string;
  access?: "public" | "restricted";
}

export interface PublishedPackage {
  name: string;
  folderName: string;
  version: string;
  tag: string;
}

export interface PublishWorkspacePackagesResult {
  publishedPackages: PublishedPackage[];
}

/**
 * Calculate new version based on bump level
 */
function bumpVersion(currentVersion: string, bumpLevel: "major" | "minor" | "patch"): string {
  if (currentVersion === "0.0.0") {
    return "0.0.1";
  }

  const parts = currentVersion.split(".").map((p) => parseInt(p, 10));

  switch (bumpLevel) {
    case "major":
      return `${parts[0] + 1}.0.0`;
    case "minor":
      return `${parts[0]}.${parts[1] + 1}.0`;
    case "patch":
    default:
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
}

/**
 * Fetch current version from npm registry
 */
async function getCurrentNpmVersion(packageName: string, npmToken?: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (npmToken) {
    headers["Authorization"] = `Bearer ${npmToken}`;
  }

  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
      headers,
    });

    if (!response.ok) {
      return "0.0.0";
    }

    const data = (await response.json()) as Record<string, any>;
    return data?.["dist-tags"]?.latest || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Publish multiple workspace packages sequentially
 */
export async function publishWorkspacePackages(
  options: PublishWorkspacePackagesOptions,
): Promise<PublishWorkspacePackagesResult> {
  const { packages, bumpLevel, rootDir = ".", devBranch = "dev", access = "public" } = options;

  const branch = getCurrentBranch();
  const npmToken = getEnv("NPM_TOKEN");
  const publishedPackages: PublishedPackage[] = [];

  for (const packageFolder of packages) {
    console.log(`🚀 Publishing ${packageFolder}...`);

    const packageDir = `${rootDir}/packages/${packageFolder}`;

    // Get package name from package.json
    const pkg = await readPackageJson(packageDir);
    const packageName = pkg.name;
    console.log(`📦 Package: ${packageName}`);

    // Get current npm version
    const currentVersion = await getCurrentNpmVersion(packageName, npmToken);
    console.log(`📊 Current npm version: ${currentVersion}`);

    // Calculate new version
    const newVersion = bumpVersion(currentVersion, bumpLevel);
    console.log(`📈 Version: ${currentVersion} → ${newVersion}`);

    // Update package.json with new version
    pkg.version = newVersion;
    await writePackageJson(packageDir, pkg);

    // Determine tag and publish
    const tag = branch === devBranch ? "dev" : "latest";
    const publishCmd =
      tag === "dev" ? `bun publish --tag dev --access "${access}"` : `bun publish --access "${access}"`;

    const result = await exec(publishCmd, { cwd: packageDir });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to publish ${packageName}: ${result.stderr}`);
    }

    console.log(`✅ Published ${packageName}@${newVersion} (${tag})`);

    publishedPackages.push({
      name: packageName,
      folderName: packageFolder,
      version: newVersion,
      tag,
    });
  }

  console.log(`🎉 Successfully published: ${publishedPackages.map((p) => p.folderName).join(", ")}`);

  return { publishedPackages };
}
