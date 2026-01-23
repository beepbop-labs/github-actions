import { GitHubGateway } from "./github-gateway";

const getHeaders = (): Record<string, string> => {
  const npmToken = GitHubGateway.getEnv("NPM_TOKEN");
  const headers: Record<string, string> = {};
  if (npmToken) {
    // Basic validation of NPM token format
    if (typeof npmToken !== "string" || npmToken.trim().length === 0) {
      throw new Error("NPM_TOKEN environment variable is set but appears to be invalid");
    }
    headers["Authorization"] = `Bearer ${npmToken.trim()}`;
  }
  return headers;
};

type T_FetchPackageInfo = {
  packageName: string;
};

type T_FetchPackageInfoReturn = {
  version: string;
  tarballUrl: string | null;
};

const fetchPackageInfo = async ({ packageName }: T_FetchPackageInfo): Promise<T_FetchPackageInfoReturn> => {
  if (!packageName || typeof packageName !== "string" || packageName.trim().length === 0) {
    throw new Error("Package name is required and must be a non-empty string");
  }

  const headers = getHeaders();
  const response = await fetch(`https://registry.npmjs.org/${packageName.trim()}`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch package info for ${packageName}: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Record<string, any>;

  const version = data?.["dist-tags"]?.["latest"] || "0.0.0";
  const tarballUrl = data?.["versions"]?.[version]?.["dist"]?.["tarball"] || null;

  return {
    version,
    tarballUrl,
  };
};

export const NpmGateway = {
  getHeaders,
  fetchPackageInfo,
};
