import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Serves the built client from an allow-list captured at startup. Request paths
 * are only ever looked up in this map, never joined onto the filesystem, so
 * path traversal is impossible by construction.
 */
export interface StaticAsset {
  body: Buffer
  contentType: string
  /** Vite fingerprints files under /assets/, so they can be cached forever. */
  isFingerprinted: boolean
}

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

export function loadStaticAssets(publicAssetsDirectory: string): Map<string, StaticAsset> {
  const assetsByUrlPath = new Map<string, StaticAsset>()
  const walkDirectory = (absoluteDirectory: string) => {
    let directoryEntries: string[]
    try {
      directoryEntries = readdirSync(absoluteDirectory)
    } catch {
      return
    }
    for (const directoryEntryName of directoryEntries) {
      const absolutePath = path.join(absoluteDirectory, directoryEntryName)
      if (statSync(absolutePath).isDirectory()) {
        walkDirectory(absolutePath)
        continue
      }
      const extension = path.extname(directoryEntryName).toLowerCase()
      const contentType = CONTENT_TYPES_BY_EXTENSION[extension]
      if (!contentType) continue
      const urlPath = '/' + path.relative(publicAssetsDirectory, absolutePath).split(path.sep).join('/')
      assetsByUrlPath.set(urlPath, {
        body: readFileSync(absolutePath),
        contentType,
        isFingerprinted: urlPath.startsWith('/assets/'),
      })
    }
  }
  walkDirectory(publicAssetsDirectory)
  return assetsByUrlPath
}
