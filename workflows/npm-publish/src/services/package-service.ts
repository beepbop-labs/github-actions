import { GitHubGateway } from "@/gateways/github-gateway";
import { NpmGateway } from "@/gateways/npm-gateway";
import type { T_Dependency, T_Package } from "@/types/package";
import fs from "fs/promises";
import path from "path";
import os from "os";
import semver from "semver";
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

const getDirectorySize = async (dirPath: string): Promise<number> => {
  const files = await fs.readdir(dirPath, { recursive: true });
  let totalSize = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) {
        totalSize += stat.size;
      }
    } catch (error) {
      // Skip files that can't be accessed
    }
  }

  return totalSize;
};

const isValidVersion = ({ version }: { version: string }): boolean => {
  // Reject protocol-based versions (file:, link:, git:, http:, https:)
  if (/^(file|link|git|http|https):/.test(version)) return false;

  // Accept workspace versions
  if (/^workspace:/.test(version)) return true;

  // Accept common keywords
  if (/^(latest|stable|beta|alpha|next|canary|rc)$/.test(version)) return true;

  // Accept wildcard
  if (version === "*") return true;

  // More comprehensive semver range pattern
  // This handles: ^1.0.0, ~1.0.0, >=1.0.0, >1.0.0, <=1.0.0, <1.0.0, =1.0.0
  // Also handles ranges like: >=1.0.0 <2.0.0, 1.x, 1.0.x, etc.
  const semverRangePattern =
    /^[><=^~]*\s*[0-9]+(\.[0-9]+|\.x|\.\*)?(\.[0-9]+|\.x|\.\*)?(\s*[><=^~]*\s*[0-9]+(\.[0-9]+|\.x|\.\*)?(\.[0-9]+|\.x|\.\*)?)*/;
  if (semverRangePattern.test(version.replace(/\s+/g, ""))) return true;

  // Accept prerelease versions with build metadata
  const prereleasePattern = /^[0-9]+(\.[0-9]+)*(\.[0-9]+)*(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
  if (prereleasePattern.test(version)) return true;

  return false;
};

type T_CalcNewVersion = {
  currentVersion: string;
  bumpLevel: "major" | "minor" | "patch";
};

const calcUpdateVersion = async ({ currentVersion, bumpLevel }: T_CalcNewVersion): Promise<string> => {
  const branch = GitHubGateway.getCurrentBranch();

  // Default to 0.0.0 if no version or invalid version
  if (!currentVersion || currentVersion === "null" || currentVersion.trim() === "") {
    currentVersion = "0.0.0";
  }

  if (branch === BRANCH_CONFIG.main) {
    // Use semver.inc() for stable version bumps
    const newVersion = semver.inc(currentVersion, bumpLevel);
    if (!newVersion) throw new Error(`Failed to bump version ${currentVersion} by ${bumpLevel}`);
    return newVersion;
  }

  if (branch === BRANCH_CONFIG.dev) {
    // Check if current version is already a dev version
    const isDev = currentVersion.includes("-dev.");
    let newVersion: string | null;

    if (isDev) {
      // Already has dev tag, just bump the prerelease number
      // 1.0.1-dev.0 -> 1.0.1-dev.1
      newVersion = semver.inc(currentVersion, "prerelease", "dev");
    } else {
      // Stable version -> bump patch (default safety) and add dev tag
      // 1.0.0 -> 1.0.1-dev.0
      const bumpedPatch = semver.inc(currentVersion, "patch");
      if (!bumpedPatch) throw new Error(`Failed to bump patch version ${currentVersion}`);
      newVersion = semver.inc(bumpedPatch, "prerelease", "dev");
    }

    if (!newVersion) throw new Error(`Failed to calculate dev version for ${currentVersion}`);
    return newVersion;
  }

  throw new Error(`Branch '${branch}' is not main or dev`);
};

type T_CreateTarball = {
  pkg: T_Package;
  tmpDir: string;
};

const createNpmTarball = async ({ pkg, tmpDir }: T_CreateTarball): Promise<void> => {
  // Download published tarball using streaming to avoid loading large files into memory
  const headers = NpmGateway.getHeaders();

  // Use curl with timeout instead of fetch for better reliability
  const tarballPath = path.join(tmpDir, "package.tgz");
  const curlCommand = `curl -L --max-time 30 --fail --silent --show-error -H "Authorization: ${
    headers.Authorization || ""
  }" "${pkg.tarballUrl!}" -o "${tarballPath}"`;

  await GitHubGateway.execute({
    command: curlCommand,
    options: { silent: true },
  });

  // Check file size to avoid processing extremely large packages
  const stats = await fs.stat(tarballPath);
  if (stats.size > 50 * 1024 * 1024) {
    // 50MB limit
    throw new Error(`Package tarball too large (${stats.size} bytes), skipping change detection`);
  }

  await GitHubGateway.execute({
    command: `tar -xzf "${tarballPath}" -C "${tmpDir}"`,
    options: { silent: true },
  });
};

const createLocalTarball = async ({ pkg, tmpDir }: T_CreateTarball): Promise<void> => {
  // Create local tarball with timeout to prevent hanging on large packages
  await GitHubGateway.execute({
    command: "timeout 60 bun pm pack",
    options: { cwd: pkg.path, silent: true },
  });

  // Find the newly created tarball (bun pm pack creates a tarball named after the package)
  const findRes = await GitHubGateway.execute({
    command: "find . -maxdepth 1 -type f -name '*.tgz' -newer package.json -print -quit",
    options: { cwd: pkg.path, silent: true },
  });
  let localTarball = findRes.stdout.trim();

  // Fallback: if no newer tarball found, get any tgz file (should be the one we just created)
  if (!localTarball) {
    const fallbackRes = await GitHubGateway.execute({
      command: "find . -maxdepth 1 -type f -name '*.tgz' -print -quit",
      options: { cwd: pkg.path, silent: true },
    });
    localTarball = fallbackRes.stdout.trim();
  }

  if (!localTarball) throw new Error("Bun pm pack failed to create tarball");

  const tarballPath = localTarball.startsWith("./") ? localTarball : `./${localTarball}`;
  await fs.rename(path.join(pkg.path, tarballPath), path.join(tmpDir, path.basename(localTarball)));

  // Extract with timeout to prevent hanging on large archives
  await GitHubGateway.execute({
    command: `timeout 30 tar -xzf "${path.join(tmpDir, path.basename(localTarball))}" -C "${tmpDir}"`,
    options: { silent: true },
  });

  // Clean up the tarball from the package directory
  try {
    await fs.unlink(path.join(pkg.path, tarballPath));
  } catch (error) {
    // Ignore cleanup errors - the tarball might already be moved
  }
};

type T_CheckChanges = {
  pkgs: T_Package[];
};

type T_PackageJson = {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: any;
};

type T_RemoveWorkspaceDeps = {
  localPkg: T_PackageJson;
  publishedPkg: T_PackageJson;
};

/**
 * Remove workspace dependencies from both packages to avoid false positives during comparison.
 * Local packages have "workspace:*" but published packages have resolved versions like "^0.0.19".
 */
const removeWorkspaceDeps = ({ localPkg, publishedPkg }: T_RemoveWorkspaceDeps): void => {
  const depTypes: Array<
    keyof Pick<T_PackageJson, "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies">
  > = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

  for (const depType of depTypes) {
    const deps = localPkg[depType];
    if (deps) {
      for (const [name, version] of Object.entries(deps)) {
        if (typeof version === "string" && version.startsWith("workspace:")) {
          // Remove from both local and published packages
          delete localPkg[depType]![name];
          if (publishedPkg[depType]?.[name]) {
            delete publishedPkg[depType]![name];
          }
        }
      }
    }
  }
};

const checkChanges = async ({ pkgs }: T_CheckChanges): Promise<T_Package[]> => {
  console.log(`🔍 Checking changes for ${pkgs.length} packages...`);

  const results = await Promise.all(
    pkgs.map(async (pkg: T_Package) => {
      // If no version on npm, strictly has changes (first publish)
      if (pkg.version === "0.0.0" || !pkg.tarballUrl) {
        console.log(`📦 ${pkg.name}: first publish (no existing version)`);
        return pkg;
      }

      console.log(`🔍 Checking ${pkg.name} (current: ${pkg.version})...`);

      try {
        // Create temp directories in parallel for better performance
        const [npmTmpDir, localTmpDir] = await Promise.all([
          fs.mkdtemp(path.join(os.tmpdir(), "npm-")),
          fs.mkdtemp(path.join(os.tmpdir(), "local-")),
        ]);

        try {
          // Create npm and local tarballs in parallel
          await Promise.all([
            createNpmTarball({ pkg, tmpDir: npmTmpDir }),
            createLocalTarball({ pkg, tmpDir: localTmpDir }),
          ]);

          // Compare (removing version) - with parallel processing
          const pubPkgPath = path.join(npmTmpDir, "package", "package.json");
          const locPkgPath = path.join(localTmpDir, "package", "package.json");

          // Read both package.json files in parallel
          const [pubPkgContent, locPkgContent] = await Promise.all([
            fs.readFile(pubPkgPath, "utf-8"),
            fs.readFile(locPkgPath, "utf-8"),
          ]);

          const pubPkg = JSON.parse(pubPkgContent);
          const locPkg = JSON.parse(locPkgContent);

          // Remove version from both packages
          delete pubPkg.version;
          delete locPkg.version;

          // Remove workspace dependencies to avoid false positives
          removeWorkspaceDeps({ localPkg: locPkg, publishedPkg: pubPkg });

          // Write both modified package.json files in parallel
          await Promise.all([
            fs.writeFile(pubPkgPath, JSON.stringify(pubPkg, null, 2)),
            fs.writeFile(locPkgPath, JSON.stringify(locPkg, null, 2)),
          ]);

          // Compare directories with timeout to prevent hanging
          const diff = await GitHubGateway.execute({
            command: `timeout 30 diff -rq "${path.join(localTmpDir, "package")}" "${path.join(npmTmpDir, "package")}"`,
            options: { silent: true, throwOnError: false },
          });

          let hasChanges = diff.exitCode !== 0;

          // If diff failed or timed out, fall back to a simpler check
          if (diff.exitCode === 124) {
            // timeout
            console.log(`⏰ Diff timed out for ${pkg.name}, assuming changes`);
            hasChanges = true;
          } else if (diff.exitCode !== 0 && diff.exitCode !== 1) {
            // diff error (not just differences found)
            console.log(`⚠️ Diff failed for ${pkg.name}, checking file sizes instead`);
            // Fallback: compare total file sizes as a rough change indicator
            try {
              const localSize = await getDirectorySize(path.join(localTmpDir, "package"));
              const npmSize = await getDirectorySize(path.join(npmTmpDir, "package"));
              hasChanges = Math.abs(localSize - npmSize) > 100; // 100 byte tolerance
              console.log(`📊 Size comparison: local=${localSize}, npm=${npmSize}, changes=${hasChanges}`);
            } catch (sizeError) {
              console.log(`⚠️ Size comparison failed for ${pkg.name}, assuming changes`);
              hasChanges = true;
            }
          }

          console.log(`📦 ${pkg.name}: ${hasChanges ? "CHANGES DETECTED" : "no changes"}`);
          return hasChanges ? pkg : null;
        } finally {
          // Always cleanup temp directories
          await Promise.all([
            fs.rm(npmTmpDir, { recursive: true, force: true }).catch(() => {}),
            fs.rm(localTmpDir, { recursive: true, force: true }).catch(() => {}),
          ]);
        }
      } catch (error) {
        const errorMessage = `⚠️ Failed to check changes for ${pkg.name}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        console.warn(errorMessage);
        // Don't fail the whole process - assume changes if we can't check
        console.log(`📦 ${pkg.name}: assuming changes due to check failure`);
        return pkg;
      }
    }),
  );

  const changedPackages = results.filter((pkg): pkg is T_Package => pkg !== null);
  console.log(`✅ Change detection complete: ${changedPackages.length} packages have changes`);
  return changedPackages;
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
      command: `bun install`,
      options: { cwd: packagePath },
    });
    await GitHubGateway.execute({
      command: `bun run "${buildCommand}"`,
      options: { cwd: packagePath },
    });
  } else {
    // Turborepo (package or workspace) - install at root, build with turbo filters
    await GitHubGateway.execute({
      command: `bun install`,
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
