# Distribution And Terminal Integration

## Local Package Shape

`package.json#bin` exposes:

```json
{
  "pasta": "./src/cli.ts"
}
```

The bin target has a Bun shebang and the package has no `install`, `postinstall`, or `prepare` lifecycle scripts.

## Verified Local Paths

- `bun run src/cli.ts --version`
- `bunx --bun -p file:$PWD pasta --version`
- `mise use -g github:thehumanworks/pasta@0.1.2`
- `bun pm pack --dry-run`

GitHub `bunx` proof is verified against the public repo:

```bash
bunx --bun -p github:thehumanworks/pasta pasta --version
bunx --bun github:thehumanworks/pasta#v0.1.2 --version
mise use -g github:thehumanworks/pasta@0.1.2
```

The public repo and tag should remain visible without SSH credentials:

```bash
git ls-remote origin HEAD refs/heads/main refs/tags/v0.1.2
curl -fsS -I https://api.github.com/repos/thehumanworks/pasta/tarball/
```

Run the GitHub package commands with an empty Bun cache so a prior local install
cannot mask a remote packaging problem:

```bash
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
BUN_INSTALL_CACHE_DIR="$tmp" bunx --bun -p github:thehumanworks/pasta pasta --version
BUN_INSTALL_CACHE_DIR="$tmp" bunx --bun github:thehumanworks/pasta#v0.1.2 --version
```

## GitHub Release Assets For Mise

GitHub release assets are built by `.github/workflows/release.yml` for semver
tags and manual dispatch. Each archive contains a root-level `pasta` or
`pasta.exe` binary so mise's GitHub backend can autodetect the matching
macOS, Linux, or Windows asset.

Build release assets locally:

```bash
mise exec -- bun run build:release
```

Verify a release through isolated mise directories so global config is not
modified during testing:

```bash
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
MISE_DATA_DIR="$tmp/data" \
MISE_CONFIG_DIR="$tmp/config" \
MISE_CACHE_DIR="$tmp/cache" \
MISE_STATE_DIR="$tmp/state" \
  mise use -g github:thehumanworks/pasta
MISE_DATA_DIR="$tmp/data" \
MISE_CONFIG_DIR="$tmp/config" \
MISE_CACHE_DIR="$tmp/cache" \
MISE_STATE_DIR="$tmp/state" \
  mise exec github:thehumanworks/pasta -- pasta --version
```

For brand-new releases, mise can hide `latest` behind its release-age filter and
return `no versions found ... matching date filter`. Pin the tag for immediate
installs, or set `MISE_MINIMUM_RELEASE_AGE=0` for a one-off latest-resolution
proof:

```bash
MISE_MINIMUM_RELEASE_AGE=0 mise use -g github:thehumanworks/pasta
```

## Shell Integration

`pasta install-shell` writes a reversible snippet to the Pasta config directory. It provides aliases for copy, paste-to-clipboard, and history plus non-overriding keybindings for zsh, fish, PowerShell, and Bash builds that can safely inspect existing shell-command bindings. `pasta uninstall-shell` clears generated snippet content.
