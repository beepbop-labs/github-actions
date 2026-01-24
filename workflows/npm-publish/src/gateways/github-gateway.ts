import { BRANCH_CONFIG, DEFAULT_WORKFLOW_INPUTS, type T_WorkflowInputs } from "@/types/inputs";
import { IS_DEV } from "@/utils/dev";
import path from "path";
import fs from "fs/promises";

const getEnv = (name: string, fallback: string = ""): string => {
  return process.env[name] || fallback;
};

const getBeforeSha = async (): Promise<string | null> => {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  try {
    const eventData = JSON.parse(await fs.readFile(eventPath, "utf8"));
    // For push events, the before SHA is in event.before
    if (eventData.before) {
      return eventData.before;
    }
  } catch (error) {
    // Silently fail if we can't read the event data
  }

  return null;
};

const logStep = (step: number, title: string): void => {
  console.log(`\n------------- Step ${step} - ${title} -------------`);
};

const getCurrentBranch = (): string => {
  const ref = process.env.GITHUB_REF || "";
  return IS_DEV ? "main" : ref.split("/").pop() || "";
};

const getCurrentTag = (): string => {
  const branch = getCurrentBranch();
  return branch === BRANCH_CONFIG.dev ? "dev" : "latest";
};

type T_Exec = {
  command: string;
  options?: { cwd?: string; silent?: boolean; throwOnError?: boolean };
};

const execute = async ({ command, options }: T_Exec): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const { cwd, silent = false, throwOnError = true } = options || {};

  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: cwd || process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (!silent) {
    if (stdout) console.log(stdout.trim());
    if (stderr && exitCode !== 0) console.error(stderr.trim());
  }

  if (throwOnError && exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command}\n${stderr}`);
  }

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
};

const getInput = ({ name, fallback = "" }: { name: string; fallback: string }): string => {
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envName] || fallback;
};

const resolveInputs = (): T_WorkflowInputs => {
  // Get raw inputs
  const rawRootPath = GitHubGateway.getInput({
    name: "root-path",
    fallback: DEFAULT_WORKFLOW_INPUTS.rootPath,
  });
  const rawPackagePath = GitHubGateway.getInput({
    name: "package-path",
    fallback: DEFAULT_WORKFLOW_INPUTS.packagePath,
  });

  // Resolve all paths to absolute at the start for consistency
  const inputs: T_WorkflowInputs = {
    rootPath: path.resolve(rawRootPath),
    packagePath: path.resolve(rawRootPath, rawPackagePath),

    buildCommand: GitHubGateway.getInput({
      name: "build-command",
      fallback: DEFAULT_WORKFLOW_INPUTS.buildCommand,
    }),
    access: GitHubGateway.getInput({
      name: "access",
      fallback: DEFAULT_WORKFLOW_INPUTS.access,
    }) as T_WorkflowInputs["access"],
    forcePublish:
      GitHubGateway.getInput({ name: "force-publish", fallback: String(DEFAULT_WORKFLOW_INPUTS.forcePublish) }) ===
      "true",
    route: GitHubGateway.getInput({
      name: "route",
      fallback: DEFAULT_WORKFLOW_INPUTS.route,
    }) as T_WorkflowInputs["route"],
  };

  return inputs;
};

export const GitHubGateway = {
  getEnv,
  getBeforeSha,
  logStep,
  getCurrentBranch,
  getCurrentTag,
  execute,
  getInput,
  resolveInputs,
};
