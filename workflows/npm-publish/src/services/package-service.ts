import { GitHubGateway } from "@/gateways/github-gateway";
import { NpmGateway } from "@/gateways/npm-gateway";
import type { T_Dependency, T_Package } from "@/types/package";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { BRANCH_CONFIG, type T_WorkflowInputs } from "@/types/inputs";

type T_LoadPackage = {
  packagePath: string;
  inputs: T_WorkflowInputs;
};

const loadPackage = async ({ packagePath, inputs }: T_LoadPackage): Promise<T_Package> => {
  const packageJsonPath = path.join(packagePath, "package.json");
  const packageJson = await fs.readFile(packageJsonPath, "utf8");
  const parsedPackageJson = JSON.parse(packageJson);

  const name = parsedPackageJson?.name;

  if (!name) {
    throw new Error("Package name is required");
  }

  const dependencies = parsedPackageJson?.dependencies ?? {};
  const devDependencies = parsedPackageJson?.devDependencies ?? {};
  const peerDependencies = parsedPackageJson?.peerDependencies ?? {};

  const allDependencies = { ...dependencies, ...devDependencies, ...peerDependencies };

  const packageDependencies: T_Dependency[] = Object.keys(allDependencies).map((name) => {
    const version = allDependencies[name];

    if (!isValidVersion({ version })) {
      throw new Error(`Invalid semver version: ${version}`);
    }

    const type = version.startsWith("workspace:") ? "workspace" : "npm";

    return {
      name,
      type,
      version,
    };
  });

  const { version, tarballUrl } = await NpmGateway.fetchPackageInfo({ packageName: name });

  const hasNpmTag = parsedPackageJson?.npm === true;

  const access = parsedPackageJson?.private ? "restricted" : "public";

  if (access !== inputs.access) {
    throw new Error(`Package access mismatch: ${access} !== ${inputs.access}`);
  }

  return {
    name,
    path: packagePath,
    version,
    tarballUrl,
    access,
    hasNpmTag,
    dependencies: packageDependencies,
    json: parsedPackageJson,
  };
};

const isValidVersion = ({ version }: { version: string }): boolean => {
  if (/^(file|link|git|http|https):/.test(version)) return false;
  if (/^workspace:/.test(version)) return true;
  if (/^[\^~><=*]?[0-9]+(\.[0-9]+)*(\.[0-9]+)*(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/.test(version)) return true;
  if (/^(>=|>|<=|<|=)[0-9]+(\.[0-9]+)*(\.[0-9]+)*.*$/.test(version)) return true;
  if (/^(latest|stable|beta|alpha|next|canary|rc)$/.test(version)) return true;
  return version === "*";
};

type T_CalcNewVersion = {
  currentVersion: string;
  bumpLevel: "major" | "minor" | "patch";
};

const calcUpdateVersion = async ({ currentVersion, bumpLevel }: T_CalcNewVersion): Promise<string> => {
  const branch = GitHubGateway.getCurrentBranch();

  // Default to 0.0.0 if no version
  if (!currentVersion || currentVersion === "null") currentVersion = "0.0.0";

  if (branch === BRANCH_CONFIG.main) {
    const result = await GitHubGateway.execute({
      command: `bunx semver -i "${bumpLevel}" "${currentVersion}"`,
      options: { silent: true },
    });
    return result.stdout.trim();
  }

  if (branch === BRANCH_CONFIG.dev) {
    // Remove existing -dev.N
    const base = currentVersion.replace(/-dev\.\d+$/, "");
    let next = 0;
    if (currentVersion.includes("-dev.")) {
      const match = currentVersion.match(/-dev\.(\d+)$/);
      if (match) next = parseInt(match[1], 10) + 1;
    }
    return `${base}-dev.${next}`;
  }

  throw new Error(`Branch '${branch}' is not main or dev`);
};

type T_CheckChanges = {
  pkg: T_Package;
};

const checkChanges = async ({ pkg }: T_CheckChanges): Promise<boolean> => {
  // If no version on npm, strictly has changes (first publish)
  if (pkg.version === "0.0.0" || !pkg.tarballUrl) return true;

  // Temp dirs
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "npm-compare-"));
  const localTmp = await fs.mkdtemp(path.join(os.tmpdir(), "local-pack-"));

  try {
    // Download published
    const headers = NpmGateway.getHeaders();
    const res = await fetch(pkg.tarballUrl, { headers });
    await Bun.write(path.join(tmpDir, "package.tgz"), await res.arrayBuffer());
    await GitHubGateway.execute({
      command: `tar -xzf "${path.join(tmpDir, "package.tgz")}" -C "${tmpDir}"`,
      options: { silent: true },
    });

    // Create local
    await GitHubGateway.execute({
      command: "bun pm pack",
      options: { cwd: pkg.path, silent: true },
    });
    const findRes = await GitHubGateway.execute({
      command: "find . -maxdepth 1 -type f -name '*.tgz' -print -quit",
      options: { cwd: pkg.path, silent: true },
    });
    const localTarball = findRes.stdout.trim();

    if (!localTarball) throw new Error("Bun pm pack failed to create tarball");

    await fs.rename(path.join(pkg.path, localTarball), path.join(localTmp, path.basename(localTarball)));
    await GitHubGateway.execute({
      command: `tar -xzf "${path.join(localTmp, path.basename(localTarball))}" -C "${localTmp}"`,
      options: { silent: true },
    });

    // Compare (removing version)
    const pubPkgPath = path.join(tmpDir, "package", "package.json");
    const locPkgPath = path.join(localTmp, "package", "package.json");

    const pubPkg = JSON.parse(await fs.readFile(pubPkgPath, "utf-8"));
    const locPkg = JSON.parse(await fs.readFile(locPkgPath, "utf-8"));
    delete pubPkg.version;
    delete locPkg.version;
    await fs.writeFile(pubPkgPath, JSON.stringify(pubPkg, null, 2));
    await fs.writeFile(locPkgPath, JSON.stringify(locPkg, null, 2));

    const diff = await GitHubGateway.execute({
      command: `diff -rq "${path.join(localTmp, "package")}" "${path.join(tmpDir, "package")}"`,
      options: { silent: true, throwOnError: false },
    });

    return diff.exitCode !== 0;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(localTmp, { recursive: true, force: true });
  }
};

type T_WritePackageJson = {
  pkg: T_Package;
};

const writePackageJson = async ({ pkg }: T_WritePackageJson): Promise<void> => {
  const file = Bun.file(`${pkg.path}/package.json`);
  await Bun.write(file, JSON.stringify(pkg.json, null, 2) + "\n");
};

type T_PublishPackage = {
  pkg: T_Package;
  tag: string;
  access: "public" | "restricted";
};

const publishPackage = async ({ pkg, tag, access }: T_PublishPackage): Promise<void> => {
  const cmd = tag === "dev" ? `bun publish --tag dev --access "${access}"` : `bun publish --access "${access}"`;
  await GitHubGateway.execute({
    command: cmd,
    options: { cwd: pkg.path },
  });
};

type T_BuildPackages = {
  route: "package" | "turborepo-package" | "turborepo-workspace";
  rootPath: string;
  pkgs: T_Package[];
  buildCommand: string;
};

const buildPackages = async ({ route, rootPath, pkgs, buildCommand }: T_BuildPackages): Promise<void> => {
  console.log(`📦 Building packages: ${pkgs.map((pkg) => pkg.name).join(", ")}`);

  if (route === "package") {
    // Single package (no monorepo) - install and build at package path
    const packagePath = pkgs[0]?.path;
    if (!packagePath) throw new Error("No package provided for build");

    await GitHubGateway.execute({
      command: `bun install --frozen-lockfile`,
      options: { cwd: packagePath },
    });
    await GitHubGateway.execute({
      command: `bun run "${buildCommand}"`,
      options: { cwd: packagePath },
    });
  } else {
    // Turborepo (package or workspace) - install at root, build with turbo filters
    await GitHubGateway.execute({
      command: `bun install --frozen-lockfile`,
      options: { cwd: rootPath },
    });

    const filterArgs = pkgs.map((pkg) => `--filter="${pkg.name}..."`).join(" ");
    await GitHubGateway.execute({
      command: `bunx turbo run "${buildCommand}" ${filterArgs}`,
      options: { cwd: rootPath },
    });
  }
};

export const PackageService = {
  loadPackage,
  calcUpdateVersion,
  checkChanges,
  writePackageJson,
  publishPackage,
  buildPackages,
};
