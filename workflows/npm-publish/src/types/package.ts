export type T_Package = {
  name: string;
  path: string;
  version: string;
  tarballUrl: string | null;
  access: "public" | "restricted";
  hasNpmTag: boolean;
  dependencies: T_Dependency[];
  json: Record<string, unknown>;
};

export type T_Dependency = {
  name: string;
  type: "workspace" | "npm";
  version: string;
};
