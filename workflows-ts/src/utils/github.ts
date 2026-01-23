/**
 * GitHub Actions utility functions
 */

/**
 * Set an output value for GitHub Actions
 */
export function setOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    Bun.write(Bun.file(outputFile), `${name}=${value}\n`, { append: true } as any);
  }
  console.log(`📤 Output: ${name}=${value}`);
}

/**
 * Log an error message in GitHub Actions format
 */
export function error(message: string): void {
  console.log(`::error::${message}`);
}

/**
 * Log a warning message in GitHub Actions format
 */
export function warning(message: string): void {
  console.log(`::warning::${message}`);
}

/**
 * Get the current branch name from GITHUB_REF
 */
export function getCurrentBranch(): string {
  const ref = process.env.GITHUB_REF || "";
  return ref.split("/").pop() || "";
}

/**
 * Get environment variable with fallback
 */
export function getEnv(name: string, fallback: string = ""): string {
  return process.env[name] || fallback;
}

/**
 * Get input from environment (workflow inputs are passed as env vars)
 */
export function getInput(name: string, fallback: string = ""): string {
  // GitHub Actions passes inputs as INPUT_<NAME> env vars
  const envName = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envName] || fallback;
}

/**
 * Execute a shell command and return output
 */
export async function exec(
  command: string,
  options: { cwd?: string; silent?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd: options.cwd || process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (!options.silent) {
    if (stdout) console.log(stdout.trim());
    if (stderr && exitCode !== 0) console.error(stderr.trim());
  }

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

/**
 * Read package.json from a directory
 */
export async function readPackageJson(dir: string): Promise<Record<string, any>> {
  const file = Bun.file(`${dir}/package.json`);
  const content = await file.text();
  return JSON.parse(content);
}

/**
 * Write package.json to a directory
 */
export async function writePackageJson(dir: string, content: Record<string, any>): Promise<void> {
  await Bun.write(`${dir}/package.json`, JSON.stringify(content, null, 2));
}
