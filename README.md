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
2. Open Alfred and type `fff` followed by a keyword and optional options.
3. Select a result and press Enter.

### Query options

The query is positional: `fff <keyword> [depth|-] [up]`.

1. **keyword** (required): the search text, one word. Start it with `^` for a stricter match (fzf `--exact`, no fuzzy gaps).
2. **depth** (optional): a number, or `-` to keep the default. Your `FZF_DEFAULT_COMMAND` (typically `fd --max-depth 1 ...`) gets its `--max-depth N` replaced with this number, without a change to your shell config.
3. **up** (optional): a number. How many dirs to go up from the Finder dir before the search. `0` means start from `~`. If the number is more than the dir levels, the search starts from `/`.

To set **up** without a depth, put `-` in the depth slot. Any other value in the depth or up slot shows an error in Alfred.

| Typed in Alfred  | What happens                                       |
| ---------------- | -------------------------------------------------- |
| `fff`            | All top-level items (default depth)                |
| `fff config`     | Top-level items matching "config"                  |
| `fff ^config`    | Same, but stricter (exact) match                   |
| `fff config 3`   | Items matching "config" up to 3 levels deep        |
| `fff config 3 2` | Depth 3, search from 2 dirs above the Finder dir   |
| `fff config - 1` | Default depth, search from the parent dir          |
| `fff config - 0` | Default depth, search from `~`                     |
| `fff config x`   | Error: depth must be a number or `-`               |

## Behavior

- **Search root**: Front Finder window, or Desktop if no Finder window is open. The **up** option moves the root up from there (or to `~` with `0`).
- **Hidden files**: Included when your `FZF_DEFAULT_COMMAND` includes them (the default `fd --hidden` does).
- **Directories**: Shown as selectable results, sorted before files.
- **Loading indicator**: A "Searching..." row appears while the background worker runs; Alfred reruns with cached results.
- **Caching** (stale-while-revalidate): The list is cached and served instantly while it is fresh — under `Cache duration (seconds)` in the workflow settings ([Configure Workflow] in Alfred, blank/invalid fall back to 60). Older entries are still served immediately, refreshed by a background re-scan, and the list updates once the fresh results land. Beyond the stale window (roughly 12× the TTL, minimum 30s) stale entries are dropped and a loading state is shown. Set to `0` to disable caching entirely. Cache version is checked to avoid stale entries.
- **No Terminal**: Everything happens in the background — no window pops up.

## Install

Import `Finder-fzf-Search.alfredworkflow` into Alfred (double-click or drag into Alfred Preferences → Workflows).

## Build from source

- clone repo
- run
    ```bash
    cd path/to/alfred-finder-fzf/src && zip -r ../Finder-fzf-Search.alfredworkflow . -x "*.DS_Store" -x ".*" -x ".*/"
    ```