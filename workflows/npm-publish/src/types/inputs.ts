export type T_WorkflowInputs = {
  rootPath: string;
  packagePath: string;
  bumpLevel: "major" | "minor" | "patch";
  buildCommand: string;
  access: "public" | "restricted";
  forcePublish: boolean;
  route: "package" | "turborepo-package" | "turborepo-workspace";
};

export const DEFAULT_WORKFLOW_INPUTS: T_WorkflowInputs = {
  rootPath: ".",
  packagePath: ".",
  bumpLevel: "patch",
  buildCommand: "build",
  access: "public",
  forcePublish: false,
  route: "package",
};

// Hardcoded branch configuration
export const BRANCH_CONFIG = {
  main: "main",
  dev: "dev",
} as const;
