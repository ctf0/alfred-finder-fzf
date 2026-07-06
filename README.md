# Finder Search for Alfred

Type `fff` in Alfred.

## How It Works

alfred spawn a terminal call through Node.js "because fzf cant run outside a terminal" which asks your normal login shell environment for the `FZF_DEFAULT_COMMAND` command, passes its output through `fzf --filter` for matching/ranking, and returns the results as Alfred Script Filter JSON. A loading row is shown while results are computed in a background worker; Alfred reruns automatically when the cache is ready.

## Requirements

- Alfred with Powerpack (workflows enabled)
- Node.js available via `/usr/bin/env node`
- `fzf` available from your normal interactive/login shell environment

## Usage

1. Open a Finder window at the folder you want to search.
2. Open Alfred and type `fff` followed by an optional search query.
3. Select a result and press Enter.

### Depth override

Your shell sets `FZF_DEFAULT_COMMAND` (typically `fd --max-depth 1 ...`). To search deeper for one query, append a number:

| Typed in Alfred | What happens |
|---|---|
| `fff` | All top-level items (default depth) |
| `fff config` | Top-level items matching "config" |
| `fff config 3` | Items matching "config" up to 3 levels deep |

The workflow finds `--max-depth N` in your `FZF_DEFAULT_COMMAND` and replaces it with the number you provide, without modifying your shell config.

## Behavior

- **Search root**: Front Finder window, or Desktop if no Finder window is open.
- **Hidden files**: Included when your `FZF_DEFAULT_COMMAND` includes them (the default `fd --hidden` does).
- **Directories**: Shown as selectable results, sorted before files.
- **Loading indicator**: A "Searching..." row appears while the background worker runs; Alfred reruns with cached results.
- **Caching**: Results are cached for 60 seconds. Cache version is checked to avoid stale entries.
- **No Terminal**: Everything happens in the background — no window pops up.

## Install

Import `Finder-fzf-Search.alfredworkflow` into Alfred (double-click or drag into Alfred Preferences → Workflows).

## Build from source

- clone repo
- run 
    ```bash
    cd path/to/alfred-finder-fzf/src && zip -r ../Finder-fzf-Search.alfredworkflow . -x "*.DS_Store" -x ".*" -x ".*/"
    ```