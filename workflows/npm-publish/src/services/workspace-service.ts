import type { T_Package } from "@/types/package";
import path from "path";
import fs from "fs/promises";
import { PackageService } from "./package-service";
import { GitHubGateway } from "@/gateways/github-gateway";
import { NpmGateway } from "@/gateways/npm-gateway";
import type { T_WorkflowInputs } from "@/types/inputs";

type T_LoadAllPackages = {
  rootPath: string;
  inputs: T_WorkflowInputs;
};

const loadAllPackages = async ({ rootPath, inputs }: T_LoadAllPackages): Promise<T_Package[]> => {
  const rootPackageJsonPath = path.join(rootPath, "package.json");
  const rootPackageJson = await fs.readFile(rootPackageJsonPath, "utf8");
  const rootPackage = JSON.parse(rootPackageJson) as { workspaces: string[] };

  const workspacesGlobs = rootPackage.workspaces ?? [];
  const workspacesDirs = workspacesGlobs.map((ws: string) => {
    // Handle different workspace patterns:
    // - "packages/*" -> "packages"
    // - "packages" -> "packages"
    // - "packages/foo" -> "packages/foo"
    if (ws.endsWith("/*")) {
      return path.join(rootPath, ws.slice(0, -2)); // Remove "/*"
    }
    return path.join(rootPath, ws);
  });

  // Collect full package paths (not just folder names)
  const pkgPaths: string[] = (
    await Promise.all(
      workspacesDirs.map(async (workspaceDir) => {
        const dirEntries = await fs.readdir(workspaceDir, { withFileTypes: true });
        return dirEntries.filter((e) => e.isDirectory()).map((e) => path.join(workspaceDir, e.name)); // Full path to each package
      }),
    )
  ).flat();

  const pkgs = await Promise.all(
    pkgPaths.map(async (packagePath) => {
      return PackageService.loadPackage({ packagePath, inputs });
    }),
  );

  return pkgs;
};

type T_ExpandDependents = {
  allPkgs: T_Package[];
  changedPkgs: T_Package[];
};

const expandDependents = ({ allPkgs, changedPkgs }: T_ExpandDependents): T_Package[] => {
  // Build reverse dependency graph from ALL packages
  // dependedBy[A] = [B, C] means "B and C depend on A"
  const dependedBy = new Map<string, T_Package[]>();
  const pkgByName = new Map<string, T_Package>();

  for (const pkg of allPkgs) {
    pkgByName.set(pkg.name, pkg);
  }

  for (const pkg of allPkgs) {
    for (const dep of pkg.dependencies) {
      if (dep.type === "workspace") {
        // pkg depends on dep.name, so dep.name is depended on by pkg
        const list = dependedBy.get(dep.name) || [];
        list.push(pkg);
        dependedBy.set(dep.name, list);
      }
    }
  }

  // BFS from changed packages to find all transitive dependents
  const expanded = new Set<T_Package>(changedPkgs);
  const queue = [...changedPkgs];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = dependedBy.get(current.name) || [];

    for (const dependent of dependents) {
      if (!expanded.has(dependent)) {
        console.log(`  📦 ${dependent.name} depends on changed ${current.name} → adding`);
        expanded.add(dependent);
        queue.push(dependent);
      }
    }
  }

  return Array.from(expanded);
};

type T_ResolveExecutionBatches = {
  pkgs: T_Package[];
};

const resolveExecutionBatches = ({ pkgs }: T_ResolveExecutionBatches): T_Package[][] => {
  // Build a set of package names in our subset for quick lookup
  const pkgNames = new Set(pkgs.map((p) => p.name));

  // Build internal graph for packages that need publishing
  const dependsOn = new Map<string, string[]>();
  const dependedBy = new Map<string, string[]>();

  pkgs.forEach((pkg) => {
    dependsOn.set(pkg.name, []);
    dependedBy.set(pkg.name, []);
  });

  for (const pkg of pkgs) {
    const workspaceDeps: string[] = [];

    for (const dep of pkg.dependencies) {
      if (dep.type === "workspace" && pkgNames.has(dep.name)) {
        // Only consider dependencies between packages that are being published in this run
        workspaceDeps.push(dep.name);
      }
    }

    dependsOn.set(pkg.name, workspaceDeps);
    workspaceDeps.forEach((depName) => dependedBy.get(depName)?.push(pkg.name));
  }

  // Kahn's Algo Batched
  const inDegree = new Map<string, number>();
  pkgs.forEach((pkg) => inDegree.set(pkg.name, dependsOn.get(pkg.name)!.length));

  const batches: T_Package[][] = [];
  let processed = 0;

  while (processed < pkgs.length) {
    const batch: T_Package[] = [];
    for (const pkg of pkgs) {
      if (inDegree.get(pkg.name) === 0) {
        batch.push(pkg);
        inDegree.set(pkg.name, -1);
      }
    }
    if (batch.length === 0) throw new Error("Circular dependency detected");

    batches.push(batch);
    processed += batch.length;

    batch.forEach((pkg) => {
      dependedBy.get(pkg.name)?.forEach((depName) => {
        if (inDegree.get(depName)! > 0) inDegree.set(depName, inDegree.get(depName)! - 1);
      });
    });
  }

  return batches;
};

type T_PublishedPackage = {
  name: string;
  updateVersion: string;
};

type T_PublishBatches = {
  batches: T_Package[][];
  inputs: T_WorkflowInputs;
  allPkgs: T_Package[];
};

const publishBatches = async ({ batches, inputs, allPkgs }: T_PublishBatches): Promise<T_PublishedPackage[]> => {
  const tag = GitHubGateway.getCurrentTag();
  const published: T_PublishedPackage[] = [];
  const publishedVersions = new Map<string, string>(); // name -> version

  // Pre-fetch workspace dependency versions to avoid network calls during publishing
  const workspaceDepsToFetch = new Set<string>();
  for (const batch of batches) {
    for (const pkg of batch) {
      const types = ["dependencies", "devDependencies", "peerDependencies"] as const;
      for (const t of types) {
        const deps = pkg.json[t] as Record<string, string> | undefined;
        if (deps) {
          for (const [name] of Object.entries(deps)) {
            if (publishedVersions.has(name)) continue; // Already published in this run
            const depPkg = allPkgs.find((p) => p.name === name);
            if (depPkg && deps[name].includes("workspace:")) {
              workspaceDepsToFetch.add(name);
            }
          }
        }
      }
    }
  }

  // Fetch external versions in parallel
  const fetchedVersions = new Map<string, string>();
  await Promise.all(
    Array.from(workspaceDepsToFetch).map(async (name) => {
      try {
        const info = await NpmGateway.fetchPackageInfo({ packageName: name });
        if (info.version && info.version !== "0.0.0") {
          fetchedVersions.set(name, info.version);
        }
      } catch (error) {
        console.warn(`Failed to fetch version for ${name}:`, error);
        // Continue without this version - it will use existing or fail later if needed
      }
    }),
  );

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n📦 [Batch ${i + 1}/${batches.length}] Processing: ${batch.map((p) => p.name).join(", ")}`);

    const results: T_PublishedPackage[] = await Promise.all(
      batch.map(async (pkg) => {
        try {
          // Calc new version based on current npm version
          const updateVersion = await PackageService.calcUpdateVersion({
            currentVersion: pkg.version,
            bumpLevel: inputs.bumpLevel,
          });

          // Update package version in json
          pkg.json.version = updateVersion;

          // Resolve workspace deps (in memory update based on previous batches)
          const types = ["dependencies", "devDependencies", "peerDependencies"] as const;
          for (const t of types) {
            const deps = pkg.json[t] as Record<string, string> | undefined;
            if (deps) {
              for (const [name, val] of Object.entries(deps)) {
                if (typeof val === "string" && val.includes("workspace:")) {
                  const workspacePkg = allPkgs.find((pkg) => pkg.name === name);
                  const oldVersion = workspacePkg ? workspacePkg.version : "unknown";
                  // 1. Check if it was published in this run (use new version)
                  if (publishedVersions.has(name)) {
                    deps[name] = publishedVersions.get(name)!;
                    if (oldVersion !== deps[name]) {
                      console.log(`  🔄 Updated ${name}: ${oldVersion} -> ${deps[name]}`);
                    }
                  }
                  // 2. Use pre-fetched version from NPM
                  else if (fetchedVersions.has(name)) {
                    deps[name] = fetchedVersions.get(name)!;
                    if (oldVersion !== deps[name]) {
                      console.log(`  🔄 Updated dep ${name}: ${oldVersion} -> ${deps[name]}`);
                    }
                  }
                  // 3. Fallback: try to fetch if not pre-fetched (shouldn't happen but safety net)
                  else {
                    try {
                      const depInfo = await NpmGateway.fetchPackageInfo({ packageName: name });
                      if (depInfo.version && depInfo.version !== "0.0.0") {
                        deps[name] = depInfo.version;
                        if (oldVersion !== deps[name]) {
                          console.log(`  🔄 Updated dep ${name}: ${oldVersion} -> ${deps[name]}`);
                        }
                      } else {
                        throw new Error(`Could not find published version for ${name} on npm`);
                      }
                    } catch (e) {
                      throw new Error(
                        `Failed to resolve workspace dependency ${name}: ${e instanceof Error ? e.message : String(e)}`,
                      );
                    }
                  }
                }
              }
            }
          }

          // Write updated package.json and publish
          await PackageService.writePackageJson({ pkg });
          await PackageService.publishPackage({ pkg, tag, access: inputs.access });

          return { name: pkg.name, updateVersion };
        } catch (e) {
          console.error(`❌ Failed to publish ${pkg.name}`, e);
          throw e;
        }
      }),
    );

    for (const res of results) {
      if (res) {
        published.push(res);
        publishedVersions.set(res.name, res.updateVersion);
        console.log(`  ✅ Published ${res.name}@${res.updateVersion}`);
      }
    }
  }

  return published;
};

export const WorkspaceService = {
  loadAllPackages,
  expandDependents,
  resolveExecutionBatches,
  publishBatches,
};

export type { T_PublishedPackage };
