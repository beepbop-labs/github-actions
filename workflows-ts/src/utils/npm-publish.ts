/**
 * Publish package to npm
 */

import { exec, getCurrentBranch, readPackageJson, writePackageJson } from "./github";

export interface NpmPublishOptions {
  version: string;
  devBranch: string;
  access: "public" | "restricted";
  workingDirectory: string;
}

export interface NpmPublishResult {
  success: boolean;
  packageName: string;
  version: string;
  tag: string;
}

/**
 * Publish package to npm with the specified version
 */
export async function npmPublish(options: NpmPublishOptions): Promise<NpmPublishResult> {
  const { version, devBranch, access, workingDirectory } = options;
  const branch = getCurrentBranch();

  // Read and update package.json with new version
  const pkg = await readPackageJson(workingDirectory);
  const packageName = pkg.name;
  pkg.version = version;
  await writePackageJson(workingDirectory, pkg);

  // Determine tag based on branch
  const tag = branch === devBranch ? "dev" : "latest";

  // Publish to npm
  const publishCmd = tag === "dev" ? `bun publish --tag dev --access "${access}"` : `bun publish --access "${access}"`;

  const result = await exec(publishCmd, { cwd: workingDirectory });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to publish: ${result.stderr}`);
  }

  console.log(`🚀 Published ${packageName}@${version} (tag: ${tag})`);

  return {
    success: true,
    packageName,
    version,
    tag,
  };
}
