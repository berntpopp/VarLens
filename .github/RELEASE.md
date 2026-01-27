# Release Process

This document describes how to create releases for Varlens using the automated CI/CD pipeline.

## Automated Build Pipeline

The project uses GitHub Actions to automatically build and release the application for Windows, macOS, and Linux.

### Workflows

#### 1. Build Workflow (`.github/workflows/build.yml`)

**Triggers:**

- Push to `main` branch
- Push to any `feat/**` branch
- Pull requests to `main`

**Actions:**

- Runs on all three platforms (Windows, macOS, Linux)
- Installs dependencies with npm
- Runs linter and type checker
- Runs tests
- Builds the Vue/Electron app
- Creates test builds (without code signing)

**Purpose:** Ensures code quality and that builds work on all platforms before merging.

#### 2. Release Workflow (`.github/workflows/release.yml`)

**Triggers:**

- Push of version tags (e.g., `v0.1.0`, `v1.0.0`)

**Actions:**

- Builds production-ready installers for all platforms
- Publishes artifacts to GitHub Releases (as draft)
- Uploads installers as downloadable assets

**Purpose:** Automates the release process when you tag a new version.

#### 3. CodeQL Security Scanning (`.github/workflows/codeql.yml`)

**Triggers:**

- Push to `main`
- Pull requests to `main`
- Weekly scheduled scan (Monday 6 AM UTC)

**Purpose:** Performs static analysis security testing (SAST) for JavaScript/TypeScript.

## Creating a Release

### Step 1: Update Version

Update the version in `package.json`:

```json
{
  "version": "0.2.0"
}
```

### Step 2: Commit Changes

```bash
git add package.json
git commit -m "chore: bump version to 0.2.0"
```

### Step 3: Create and Push Tag

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

### Step 4: Monitor Build

1. Go to the [Actions tab](https://github.com/berntpopp/varlens/actions) on GitHub
2. Watch the "Release" workflow execute
3. Wait for all platform builds to complete (typically 10-20 minutes)

### Step 5: Publish Release

1. Go to [Releases](https://github.com/berntpopp/varlens/releases)
2. Find the draft release created by the workflow
3. Review the artifacts:
   - **Windows:** `.exe` installer (NSIS)
   - **macOS:** `.dmg` installer
   - **Linux:** `.AppImage` and `.deb` files
4. Edit the release notes if needed
5. Click "Publish release"

## Downloadable Artifacts

After publishing, users can download installers from:

```
https://github.com/berntpopp/varlens/releases/latest
```

### Platform-Specific Downloads

- **Windows:** `Varlens-Setup-{version}.exe`
- **macOS:** `Varlens-{version}-{arch}.dmg` (Intel and Apple Silicon)
- **Linux:** `Varlens-{version}.AppImage` (universal)
- **Linux (Debian/Ubuntu):** `Varlens-{version}.deb`

## Code Signing (Optional)

Currently, releases are built without code signing. To enable code signing:

### Windows Code Signing

Add these secrets to your repository:

- `WINDOWS_CERTS`: Base64-encoded `.pfx` certificate file
- `WINDOWS_CERTS_PASSWORD`: Certificate password

Then uncomment these lines in `.github/workflows/release.yml`:

```yaml
WIN_CSC_LINK: ${{ secrets.WINDOWS_CERTS }}
WIN_CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERTS_PASSWORD }}
```

### macOS Code Signing

Add these secrets to your repository:

- `MAC_CERTS`: Base64-encoded `.p12` certificate file
- `MAC_CERTS_PASSWORD`: Certificate password

Then uncomment these lines in `.github/workflows/release.yml`:

```yaml
CSC_LINK: ${{ secrets.MAC_CERTS }}
CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}
```

**To add secrets:**

1. Go to Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret with its name and value

## Local Build Testing

To test builds locally before creating a release:

```bash
# Install dependencies
npm install

# Run tests
npm run test

# Build for current platform
npm run build
npm run dist

# Output will be in the `release` directory
```

### Platform-Specific Local Builds

```bash
# Windows only
npm run dist:win

# macOS only
npm run dist:mac

# Linux only
npm run dist:linux
```

## Version Naming Convention

Follow [Semantic Versioning](https://semver.org/):

- **v0.1.0** — Initial POC release
- **v0.2.0** — New features (virtual gene panels, statistics)
- **v0.2.1** — Bug fixes
- **v1.0.0** — Production-ready release

## Troubleshooting

### Build Fails on One Platform

- Check the Actions log for specific errors
- Platform-specific issues won't block other platforms
- You can manually re-run failed jobs

### Release Not Created

- Ensure the tag starts with `v` (e.g., `v1.0.0`, not `1.0.0`)
- Check that the tag was pushed to the remote repository
- Verify the workflow file syntax is correct

### Missing Artifacts

- Ensure the build completed successfully
- Check that the `release` directory contains the expected files
- Verify electron-builder configuration in `package.json`

### Native Module Build Failures

- better-sqlite3 requires compilation on each platform
- Linux needs: `libsqlite3-dev`, `build-essential`
- Windows needs: Visual Studio Build Tools
- macOS needs: Xcode Command Line Tools

## Best Practices

1. **Always test builds** locally before tagging a release
2. **Use semantic versioning**: `MAJOR.MINOR.PATCH`
3. **Write clear release notes** describing changes
4. **Test installers** on each platform before publishing
5. **Keep dependencies updated** for security (Dependabot helps)

## Additional Resources

- [electron-builder Documentation](https://www.electron.build/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
- [Multi-OS Electron Build Guide](https://dev.to/supersuman/multi-os-electron-build-release-with-github-actions-f3n)
