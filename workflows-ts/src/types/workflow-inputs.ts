export type T_ReleaseInputBase = {
  buildCommand: string;
  bumpLevel: "major" | "minor" | "patch";
  mainBranch: string;
  devBranch: string;
  access: "public" | "restricted";
  packageDir: string;
  forcePublish: boolean;
};

export type T_ReleaseInputs = T_ReleaseInputBase;
export type T_ReleaseTurborepoInputs = T_ReleaseInputBase & {
  rootDir: string;
};

export type T_ReleaseTurborepoWorkspaceInputs = T_ReleaseInputBase & {
  rootDir: string;
};

export const DEFAULT_RELEASE_INPUTS: T_ReleaseInputs = {
  buildCommand: "build",
  bumpLevel: "patch",
  mainBranch: "main",
  devBranch: "dev",
  access: "public",
  packageDir: ".",
  forcePublish: false,
};

export const DEFAULT_RELEASE_TURBOREPO_INPUTS: T_ReleaseTurborepoInputs = {
  ...DEFAULT_RELEASE_INPUTS,
  rootDir: ".",
};

export const DEFAULT_RELEASE_TURBOREPO_WORKSPACE_INPUTS: T_ReleaseTurborepoWorkspaceInputs = {
  ...DEFAULT_RELEASE_INPUTS,
  rootDir: ".",
};
