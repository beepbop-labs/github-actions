/**
 * Analyze workspace dependencies and return packages in publishing order
 */

import { readPackageJson } from "./github";

export interface ResolveWorkspaceDepsOptions {
  packages: string[];
  rootDir?: string;
}

export interface ResolveWorkspaceDepsResult {
  orderedPackages: string[];
  dependencyGraph: Map<string, string[]>;
}

/**
 * Build a dependency graph for workspace packages
 */
async function buildDependencyGraph(
  packages: string[],
  rootDir: string,
): Promise<{ dependsOn: Map<string, string[]>; dependedBy: Map<string, string[]> }> {
  const dependsOn = new Map<string, string[]>();
  const dependedBy = new Map<string, string[]>();

  // Initialize maps
  for (const pkg of packages) {
    dependsOn.set(pkg, []);
    dependedBy.set(pkg, []);
  }

  // Build dependency relationships
  for (const pkg of packages) {
    try {
      const packageJson = await readPackageJson(`${rootDir}/packages/${pkg}`);

      // Check all dependency types for workspace refs
      const depTypes = ["dependencies", "devDependencies", "peerDependencies"];
      const workspaceDeps: string[] = [];

      for (const depType of depTypes) {
        const deps = packageJson[depType] || {};
        for (const [depName, depVersion] of Object.entries(deps)) {
          if ((depVersion as string).includes("workspace:")) {
            // Check if this dependency is in our package list
            if (packages.includes(depName)) {
              workspaceDeps.push(depName);
            }
          }
        }
      }

      dependsOn.set(pkg, workspaceDeps);

      // Update dependedBy for each dependency
      for (const dep of workspaceDeps) {
        const depBy = dependedBy.get(dep) || [];
        depBy.push(pkg);
        dependedBy.set(dep, depBy);
      }
    } catch (error) {
      // Package might not have a package.json
      console.log(`⚠️ Could not read package.json for ${pkg}`);
    }
  }

  return { dependsOn, dependedBy };
}

/**
 * Topological sort to get publishing order (dependencies first)
 */
function topologicalSort(packages: string[], dependedBy: Map<string, string[]>): string[] {
  const state = new Map<string, number>(); // 0=not visited, 1=visiting, 2=visited
  const result: string[] = [];
  let cycleDetected = false;

  // Initialize states
  for (const pkg of packages) {
    state.set(pkg, 0);
  }

  function visit(pkg: string): void {
    // If already visited, skip
    if (state.get(pkg) === 2) {
      return;
    }

    // If currently visiting (in recursion stack), we have a cycle!
    if (state.get(pkg) === 1) {
      console.log(`❌ Cycle detected involving package: ${pkg}`);
      cycleDetected = true;
      return;
    }

    // Mark as currently visiting
    state.set(pkg, 1);

    // Visit all packages that depend on this one first
    // (they need to be published after this package)
    const deps = dependedBy.get(pkg) || [];
    for (const dep of deps) {
      if (dep && packages.includes(dep)) {
        visit(dep);
      }
    }

    // Mark as fully visited and add to result
    state.set(pkg, 2);
    result.unshift(pkg);
  }

  // Visit all packages
  for (const pkg of packages) {
    if (state.get(pkg) === 0) {
      visit(pkg);
    }
  }

  if (cycleDetected) {
    throw new Error("Cannot resolve publishing order due to circular dependencies");
  }

  return result;
}

/**
 * Resolve workspace dependencies and return packages in publishing order
 */
export async function resolveWorkspaceDeps(options: ResolveWorkspaceDepsOptions): Promise<ResolveWorkspaceDepsResult> {
  const { packages, rootDir = "." } = options;

  // If only one package, return it directly
  if (packages.length === 1) {
    console.log("📦 Single package, no dependency resolution needed");
    return {
      orderedPackages: packages,
      dependencyGraph: new Map([[packages[0], []]]),
    };
  }

  console.log(`🔍 Analyzing workspace dependencies for: ${packages.join(", ")}`);

  const { dependsOn, dependedBy } = await buildDependencyGraph(packages, rootDir);

  // Debug output
  console.log("📋 Dependency analysis:");
  for (const pkg of packages) {
    const deps = dependsOn.get(pkg) || [];
    const depBy = dependedBy.get(pkg) || [];
    console.log(`  ${pkg} depends on: ${deps.length ? deps.join(", ") : "none"}`);
    console.log(`  ${pkg} is depended on by: ${depBy.length ? depBy.join(", ") : "none"}`);
  }

  // Get sorted packages
  const orderedPackages = topologicalSort(packages, dependedBy);

  console.log(`📦 Publishing order: ${orderedPackages.join(", ")}`);

  return {
    orderedPackages,
    dependencyGraph: dependsOn,
  };
}
