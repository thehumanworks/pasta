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
- `bun pm pack --dry-run`

GitHub `bunx` proof is verified against the public repo:

```bash
bunx --bun -p github:thehumanworks/pasta pasta --version
bunx --bun github:thehumanworks/pasta#v0.1.0 --version
```

The public repo and tag should remain visible without SSH credentials:

```bash
git ls-remote origin HEAD refs/heads/main refs/tags/v0.1.0
curl -fsS -I https://api.github.com/repos/thehumanworks/pasta/tarball/
```

Run the GitHub package commands with an empty Bun cache so a prior local install
cannot mask a remote packaging problem:

```bash
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
BUN_INSTALL_CACHE_DIR="$tmp" bunx --bun -p github:thehumanworks/pasta pasta --version
BUN_INSTALL_CACHE_DIR="$tmp" bunx --bun github:thehumanworks/pasta#v0.1.0 --version
```

## Shell Integration

`pasta install-shell` writes a reversible snippet to the Pasta config directory. It provides aliases for copy, paste-to-clipboard, and history plus an optional zsh binding. `pasta uninstall-shell` clears the snippet.
