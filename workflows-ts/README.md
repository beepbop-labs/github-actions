# GitHub Actions Workflows (TypeScript)

This is a refactored version of the GitHub Actions workflows using TypeScript with Bun runtime.

## Structure

```
workflows-ts/
├── .github/
│   └── workflows/
│       ├── npm-release.yml                        # Standard npm release
│       ├── npm-release-turborepo.yml              # Single package in turborepo
│       └── npm-release-turborepo-workspace.yml    # Multi-package workspace
├── src/
│   ├── npm-release.ts                             # Workflow entry point
│   ├── npm-release-turborepo.ts                   # Workflow entry point
│   ├── npm-release-turborepo-workspace.ts         # Workflow entry point
│   └── utils/
│       ├── index.ts                               # Barrel export
│       ├── github.ts                              # GitHub Actions utilities
│       ├── calc-new-version.ts                    # Semver version calculator
│       ├── check-changes.ts                       # Package change detection
│       ├── get-npm-version.ts                     # npm registry version fetch
│       ├── npm-publish.ts                         # npm publishing
│       ├── publish-workspace-packages.ts          # Multi-package publisher
│       ├── resolve-workspace-deps.ts              # Dependency resolver
│       └── verify-npm-deps.ts                     # Dependency validator
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Workflow YAML files** define the GitHub Actions workflow with inputs/outputs
2. **YAML workflows** invoke TypeScript files using `bun run src/<workflow>.ts`
3. **TypeScript workflow files** orchestrate the release process by calling **utils**
4. **Utils** contain the actual business logic (previously in shell scripts within actions)

## Benefits

- ✅ **Type Safety**: Full TypeScript support with proper types
- ✅ **Testability**: Utils can be unit tested in isolation
- ✅ **Maintainability**: Logic is centralized in TypeScript, not scattered across YAML
- ✅ **Readability**: TypeScript is more readable than embedded shell scripts
- ✅ **Debugging**: Better error messages and stack traces
- ✅ **Performance**: Bun is fast and handles npm registry operations efficiently

## Usage

### npm-release

Standard release workflow for single packages:

```yaml
jobs:
  release:
    uses: your-org/github-actions/.github/workflows/npm-release.yml@main
    with:
      build-command: build
      bump-level: patch
    secrets:
      npm-token: ${{ secrets.NPM_TOKEN }}
```

### npm-release-turborepo

Release workflow for single packages within a turborepo monorepo:

```yaml
jobs:
  release:
    uses: your-org/github-actions/.github/workflows/npm-release-turborepo.yml@main
    with:
      build-command: build
      package-dir: packages/my-package
      root-dir: .
    secrets:
      npm-token: ${{ secrets.NPM_TOKEN }}
```

### npm-release-turborepo-workspace

Release workflow for multiple workspace packages with dependency resolution:

```yaml
jobs:
  release:
    uses: your-org/github-actions/.github/workflows/npm-release-turborepo-workspace.yml@main
    with:
      build-command: build
      root-dir: .
    secrets:
      npm-token: ${{ secrets.NPM_TOKEN }}
```

## Inputs

| Input           | Description                                     | Default  |
| --------------- | ----------------------------------------------- | -------- |
| `build-command` | npm script to run before publishing             | `build`  |
| `bump-level`    | Version bump level (major, minor, patch)        | `patch`  |
| `main-branch`   | Main release branch                             | `main`   |
| `dev-branch`    | Dev prerelease branch                           | `dev`    |
| `access`        | npm publish access level (public or restricted) | `public` |
| `package-dir`   | Working directory for the package               | `.`      |
| `root-dir`      | Root directory for turborepo                    | `.`      |
| `force-publish` | Skip change detection and always publish        | `false`  |

## Development

```bash
# Install dependencies
cd workflows-ts
bun install

# Run a workflow locally (for testing)
bun run src/npm-release.ts

# Type check
bun run tsc --noEmit
```

## Mapping from Original Structure

| Original                                                          | New (TypeScript)                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `.github/actions/calc-new-version/action.yml`                     | `src/utils/calc-new-version.ts`                                                                    |
| `.github/actions/check-changes/action.yml`                        | `src/utils/check-changes.ts`                                                                       |
| `.github/actions/get-npm-version/action.yml`                      | `src/utils/get-npm-version.ts`                                                                     |
| `.github/actions/npm-publish/action.yml`                          | `src/utils/npm-publish.ts`                                                                         |
| `.github/actions/verify-npm-deps/action.yml`                      | `src/utils/verify-npm-deps.ts`                                                                     |
| `.github/actions-workspace/publish-workspace-packages/action.yml` | `src/utils/publish-workspace-packages.ts`                                                          |
| `.github/actions-workspace/resolve-workspace-deps/action.yml`     | `src/utils/resolve-workspace-deps.ts`                                                              |
| `.github/workflows/npm-release.yml`                               | `src/npm-release.ts` + `.github/workflows/npm-release.yml`                                         |
| `.github/workflows/npm-release-turborepo.yml`                     | `src/npm-release-turborepo.ts` + `.github/workflows/npm-release-turborepo.yml`                     |
| `.github/workflows/npm-release-turborepo-workspace.yml`           | `src/npm-release-turborepo-workspace.ts` + `.github/workflows/npm-release-turborepo-workspace.yml` |
