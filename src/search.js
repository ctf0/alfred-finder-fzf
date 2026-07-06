#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const os = require('node:os');

const execFileAsync = promisify(execFile);
const MAX_RESULTS = 100;
const CACHE_DIR = path.join(os.tmpdir(), 'alfred-finder-fzf');
const CACHE_TTL_MS = 60_000;
const CACHE_VERSION = 3;
const LOADING_ICON = path.join(__dirname, 'icons', 'loading.icns');

function getUserShell() {
  return process.env.SHELL || os.userInfo().shell || '/bin/sh';
}

function isFishShell(shellPath) {
  return path.basename(shellPath) === 'fish';
}

function buildShellLines(depth, shellPath) {
  const overrideDepth = Number.isInteger(depth) && depth > 0;
  const isFish = isFishShell(shellPath);
  const shellLines = [];

  if (!isFish) {
    const shellName = path.basename(shellPath);
    if (shellName === 'zsh') {
      shellLines.push('source "${ZDOTDIR:-$HOME}/.zshrc" 2>/dev/null || true');
    } else if (shellName === 'bash') {
      shellLines.push('[ -f ~/.bashrc ] && source ~/.bashrc');
    }
  }

  shellLines.push(isFish
    ? 'cd -- "$argv[1]"; or exit'
    : 'cd -- "$1" || exit');

  if (overrideDepth) {
    shellLines.push(isFish
      ? `set -gx FZF_DEFAULT_COMMAND (echo "$FZF_DEFAULT_COMMAND" | sed 's/--max-depth [0-9][0-9]*/--max-depth '${depth}'/')`
      : `FZF_DEFAULT_COMMAND=$(echo "$FZF_DEFAULT_COMMAND" | sed 's/--max-depth [0-9][0-9]*/--max-depth '${depth}'/')`);
  }

  shellLines.push(isFish
    ? 'eval "$FZF_DEFAULT_COMMAND" | command fzf --filter "$argv[2]"'
    : 'eval "$FZF_DEFAULT_COMMAND" | command fzf --filter "$2"');

  return shellLines;
}

async function getFinderDirectory() {
  if (process.env.FINDER_FZF_ROOT) {
    return path.resolve(process.env.FINDER_FZF_ROOT);
  }

  const script = `
tell application "Finder"
  if (count of Finder windows) > 0 then
    set finderTarget to target of front Finder window as alias
  else
    set finderTarget to path to desktop folder as alias
  end if
  POSIX path of finderTarget
end tell
`;

  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script]);
  return path.resolve(stdout.trim() || path.join(os.homedir(), 'Desktop'));
}

async function collectEntries(root, query, depth) {
  const matchedPaths = await filterWithFzf(root, query, depth);
  const entries = await Promise.all(matchedPaths.map((relativePath) => toEntry(root, relativePath)));

  return entries
    .filter(Boolean)
    .sort(compareDirectoryFirst)
    .slice(0, MAX_RESULTS)
    .map((entry) => toAlfredItem(entry.absolutePath, entry.relativePath, entry.dirent));
}

function compareDirectoryFirst(left, right) {
  const leftIsDirectory = left.dirent.isDirectory();
  const rightIsDirectory = right.dirent.isDirectory();

  if (leftIsDirectory === rightIsDirectory) {
    return 0;
  }

  return leftIsDirectory ? -1 : 1;
}

function filterWithFzf(root, query, depth) {
  return new Promise((resolve, reject) => {
    const shell = getUserShell();
    const shellLines = buildShellLines(depth, shell);

    const fzf = spawn(shell, ['-l', '-c', shellLines.join('\n'), 'finder-fzf', root, query], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    fzf.stdout.setEncoding('utf8');
    fzf.stderr.setEncoding('utf8');
    fzf.stdout.on('data', (chunk) => { stdout += chunk; });
    fzf.stderr.on('data', (chunk) => { stderr += chunk; });
    fzf.on('error', reject);
    fzf.on('close', (code) => {
      if (code === 0 || code === 1) {
        resolve(stdout.split('\n').map(stripShellNoise).filter(Boolean));
      } else {
        reject(new Error(stderr.trim() || `fzf exited with status ${code}`));
      }
    });
  });
}

async function toEntry(root, relativePath) {
  const cleanRelativePath = relativePath.replace(/\/+$/g, '');
  if (!cleanRelativePath) {
    return undefined;
  }

  const absolutePath = path.resolve(root, cleanRelativePath);
  try {
    const stats = await fs.stat(absolutePath);
    return {
      absolutePath,
      relativePath,
      dirent: {
        isDirectory: () => stats.isDirectory(),
      },
    };
  } catch {
    return undefined;
  }
}

function stripShellNoise(line) {
  return line
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

function toAlfredItem(absolutePath, relativePath, dirent) {
  const isDirectory = dirent.isDirectory();

  return {
    uid: absolutePath,
    title: relativePath,
    subtitle: absolutePath,
    arg: absolutePath,
    type: 'file',
    icon: {
      type: 'fileicon',
      path: absolutePath,
    },
    match: relativePath,
  };
}

function output(items) {
  process.stdout.write(`${JSON.stringify({ items })}\n`);
}

function outputWithRerun(items) {
  process.stdout.write(`${JSON.stringify({ rerun: 0.2, items })}\n`);
}

function errorItem(message) {
  return {
    uid: 'finder-fzf-error',
    title: 'Finder search is unavailable',
    subtitle: message,
    valid: false,
  };
}

function loadingItem(root, query) {
  return {
    uid: 'finder-fzf-loading',
    title: query ? `Searching for ${query}...` : 'Loading Finder folder...',
    subtitle: root,
    valid: false,
    icon: {
      path: LOADING_ICON,
    },
  };
}

function cacheFileFor(root, query) {
  const key = Buffer.from(`${root}\0${query}`).toString('base64url');
  
  return path.join(CACHE_DIR, `${key}.json`);
}

async function readCachedItems(cacheFile) {
  try {
    const stats = await fs.stat(cacheFile);
    if (Date.now() - stats.mtimeMs > CACHE_TTL_MS) {
      return undefined;
    }

    const contents = await fs.readFile(cacheFile, 'utf8');
    const parsed = JSON.parse(contents);
    if (parsed.version !== CACHE_VERSION) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

async function startWorker(root, query, cacheFile) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const lockFile = `${cacheFile}.lock`;

  try {
    const lock = await fs.open(lockFile, 'wx');
    await lock.writeFile(String(process.pid));
    await lock.close();
  } catch {
    await removeStaleLock(lockFile);
    return;
  }

  const worker = spawn(process.execPath, [__filename, '--compute', root, query, cacheFile, lockFile], {
    detached: true,
    stdio: 'ignore',
  });
  worker.unref();
}

async function removeStaleLock(lockFile) {
  try {
    const stats = await fs.stat(lockFile);
    if (Date.now() - stats.mtimeMs > CACHE_TTL_MS) {
      await fs.rm(lockFile, { force: true });
    }
  } catch {
    // Best-effort — file may have been removed by another process
  }
}

async function writeCache(cacheFile, payload) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const tempFile = `${cacheFile}.${process.pid}.tmp`;
  const data = { version: CACHE_VERSION, ...payload };
  await fs.writeFile(tempFile, `${JSON.stringify(data)}\n`, 'utf8');
  await fs.rename(tempFile, cacheFile);
}

function parseQueryAndDepth(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { query: '', depth: null };

  const parts = trimmed.split(/\s+/);
  const last = parts[parts.length - 1];

  if (/^\d+$/.test(last)) {
    return { query: parts.slice(0, -1).join(' '), depth: parseInt(last, 10) };
  }

  return { query: trimmed, depth: null };
}

async function main() {
  try {
    const rawQuery = process.argv[2] || '';
    const { query, depth } = parseQueryAndDepth(rawQuery);
    const root = await getFinderDirectory();
    const cacheFile = cacheFileFor(root, rawQuery);
    const cached = await readCachedItems(cacheFile);

    if (cached) {
      output(cached.items);
      return;
    }

    await startWorker(root, rawQuery, cacheFile);
    outputWithRerun([loadingItem(root, query)]);
  } catch (error) {
    output([errorItem(error.message || String(error))]);
  }
}

async function computeMain() {
  const root = process.argv[3];
  const { query, depth } = parseQueryAndDepth(process.argv[4] || '');
  const cacheFile = process.argv[5];
  const lockFile = process.argv[6];

  try {
    const items = await collectEntries(root, query, depth);

    if (items.length === 0) {
      await writeCache(cacheFile, {
        items: [{
          uid: 'finder-fzf-empty',
          title: 'No matching files or folders',
          subtitle: root,
          valid: false,
        }],
      });
      return;
    }

    await writeCache(cacheFile, { items });
  } catch (error) {
    await writeCache(cacheFile, { items: [errorItem(error.message || String(error))] });
  } finally {
    if (lockFile) await fs.rm(lockFile, { force: true });
  }
}

if (require.main === module) {
  if (process.argv[2] === '--compute') {
    computeMain();
  } else {
    main();
  }
}

module.exports = {
  buildShellLines,
  collectEntries,
  getUserShell,
  getFinderDirectory,
};
