import { GitHubGateway } from "./github-gateway";

const getHeaders = (): Record<string, string> => {
  const npmToken = GitHubGateway.getEnv("NPM_TOKEN");
  const headers: Record<string, string> = {};
  if (npmToken) {
    headers["Authorization"] = `Bearer ${npmToken}`;
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
  const headers = getHeaders();
  const response = await fetch(`https://registry.npmjs.org/${packageName}`, { headers });
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
