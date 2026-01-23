/**
 * Get the latest version of a package from npm
 */

import { getCurrentBranch, getEnv } from "./github";

export interface GetNpmVersionOptions {
  packageName: string;
  devBranch: string;
}

export interface GetNpmVersionResult {
  version: string;
  tag: string;
}

/**
 * Fetch the latest version from npm registry
 */
export async function getNpmVersion(options: GetNpmVersionOptions): Promise<GetNpmVersionResult> {
  const { packageName, devBranch } = options;
  const branch = getCurrentBranch();
  const npmToken = getEnv("NPM_TOKEN");

  // Determine which tag to query
  const tag = branch === devBranch ? "dev" : "latest";

  // Build headers for npm registry request
  const headers: Record<string, string> = {};
  if (npmToken) {
    headers["Authorization"] = `Bearer ${npmToken}`;
  }

  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`, {
      headers,
    });

    if (!response.ok) {
      console.log(`📌 Current npm version: 0.0.0 (tag: ${tag}) - package not found`);
      return { version: "0.0.0", tag };
    }

    const data = (await response.json()) as Record<string, any>;
    const version = data?.["dist-tags"]?.[tag] || "0.0.0";

    console.log(`📌 Current npm version: ${version} (tag: ${tag})`);
    return { version, tag };
  } catch (error) {
    console.log(`📌 Current npm version: 0.0.0 (tag: ${tag}) - fetch failed`);
    return { version: "0.0.0", tag };
  }
}
