/**
 * Compare local build with published npm package to detect changes
 */

import { exec, getEnv } from "./github";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface CheckChangesOptions {
  packageName: string;
  npmVersion: string;
  workingDirectory: string;
}

export interface CheckChangesResult {
  hasChanges: boolean;
  reason: string;
}

/**
 * Compare local package with published npm package to detect changes
 */
export async function checkChanges(options: CheckChangesOptions): Promise<CheckChangesResult> {
  const { packageName, npmVersion, workingDirectory } = options;
  const npmToken = getEnv("NPM_TOKEN");

  // If no version exists on npm, we have changes
  if (!npmVersion || npmVersion === "0.0.0" || npmVersion === "null") {
    console.log("✅ No existing version on npm, first publish");
    return { hasChanges: true, reason: "First publish" };
  }

  // Create temp directories
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npm-compare-"));
  const localTmp = await fs.mkdtemp(path.join(os.tmpdir(), "local-pack-"));

  try {
    // Build headers for npm registry request
    const headers: Record<string, string> = {};
    if (npmToken) {
      headers["Authorization"] = `Bearer ${npmToken}`;
    }

    // Get tarball URL from npm registry
    const response = await fetch(`https://registry.npmjs.org/${packageName}/${npmVersion}`, { headers });

    if (!response.ok) {
      console.log("⚠️ Could not fetch package info, assuming changes exist");
      return { hasChanges: true, reason: "Could not fetch package info" };
    }

    const data = (await response.json()) as Record<string, any>;
    const tarballUrl = data?.dist?.tarball;

    if (!tarballUrl) {
      console.log("⚠️ Could not fetch tarball URL, assuming changes exist");
      return { hasChanges: true, reason: "Could not fetch tarball URL" };
    }

    // Download and extract published package
    const tarballResponse = await fetch(tarballUrl, { headers });
    const tarballBuffer = await tarballResponse.arrayBuffer();
    const tarballPath = path.join(tmpDir, "package.tgz");
    await Bun.write(tarballPath, tarballBuffer);

    await exec(`tar -xzf "${tarballPath}" -C "${tmpDir}"`, { silent: true });
    const publishedDir = path.join(tmpDir, "package");

    // Create local tarball
    const packResult = await exec("bun pm pack", {
      cwd: workingDirectory,
      silent: true,
    });

    if (packResult.exitCode !== 0) {
      throw new Error("bun pm pack failed");
    }

    // Find and move local tarball
    const findResult = await exec("find . -maxdepth 1 -type f -name '*.tgz' -print -quit", {
      cwd: workingDirectory,
      silent: true,
    });

    const localTarball = findResult.stdout.trim();
    if (!localTarball) {
      throw new Error("No tarball created by bun pm pack");
    }

    const localTarballDest = path.join(localTmp, path.basename(localTarball));
    await fs.rename(path.join(workingDirectory, localTarball), localTarballDest);
    await exec(`tar -xzf "${localTarballDest}" -C "${localTmp}"`, {
      silent: true,
    });
    const localDir = path.join(localTmp, "package");

    // Normalize package.json by removing version field for comparison
    const publishedPkg = JSON.parse(await fs.readFile(path.join(publishedDir, "package.json"), "utf-8"));
    const localPkg = JSON.parse(await fs.readFile(path.join(localDir, "package.json"), "utf-8"));

    delete publishedPkg.version;
    delete localPkg.version;

    await fs.writeFile(path.join(publishedDir, "package.json"), JSON.stringify(publishedPkg, null, 2));
    await fs.writeFile(path.join(localDir, "package.json"), JSON.stringify(localPkg, null, 2));

    // Compare all files
    const diffResult = await exec(`diff -rq "${localDir}" "${publishedDir}"`, {
      silent: true,
    });

    if (diffResult.exitCode === 0) {
      console.log("⏭️ No changes detected, skipping publish");
      return { hasChanges: false, reason: "No changes detected" };
    }

    console.log("✅ Changes detected:");
    console.log(diffResult.stdout);
    return { hasChanges: true, reason: "Changes detected in package files" };
  } finally {
    // Cleanup temp directories
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(localTmp, { recursive: true, force: true });
  }
}
