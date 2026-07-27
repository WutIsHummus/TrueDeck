import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getGlobalDataDir } from './paths'

const REPO = 'WutIsHummus/TrueDeck'
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  downloadUrl: string | null
  releaseName: string | null
  publishedAt: string | null
  checkedAt: number
  error?: string
}

interface CacheFile {
  checkedAt: number
  latestVersion: string | null
  releaseUrl: string | null
  downloadUrl: string | null
  releaseName: string | null
  publishedAt: string | null
}

function cachePath(): string {
  return join(getGlobalDataDir(), 'update-check.json')
}

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '')
}

/** Semver-ish compare: returns >0 if a>b, 0 equal, <0 if a<b */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a)
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0)
  const pb = normalizeVersion(b)
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] || 0
    const db = pb[i] || 0
    if (da !== db) return da - db
  }
  return 0
}

function pickDownload(assets: { name: string; browser_download_url: string }[]): string | null {
  if (!assets?.length) return null
  const platform = process.platform
  const prefer =
    platform === 'win32'
      ? [/\.exe$/i, /win/i, /windows/i, /portable/i]
      : platform === 'darwin'
        ? [/\.dmg$/i, /mac/i, /darwin/i]
        : [/\.AppImage$/i, /\.deb$/i, /linux/i]
  for (const re of prefer) {
    const hit = assets.find((a) => re.test(a.name))
    if (hit) return hit.browser_download_url
  }
  return assets[0]?.browser_download_url || null
}

function readCache(): CacheFile | null {
  try {
    const p = cachePath()
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as CacheFile
  } catch {
    return null
  }
}

function writeCache(c: CacheFile): void {
  try {
    mkdirSync(getGlobalDataDir(), { recursive: true })
    writeFileSync(cachePath(), JSON.stringify(c, null, 2), 'utf8')
  } catch {
    // ignore
  }
}

export async function checkForUpdates(force = false): Promise<UpdateInfo> {
  const currentVersion = app.getVersion() || '0.0.0'
  const now = Date.now()

  if (!force) {
    const cached = readCache()
    if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
      const latest = cached.latestVersion
      return {
        currentVersion,
        latestVersion: latest,
        updateAvailable: latest ? compareVersions(latest, currentVersion) > 0 : false,
        releaseUrl: cached.releaseUrl,
        downloadUrl: cached.downloadUrl,
        releaseName: cached.releaseName,
        publishedAt: cached.publishedAt,
        checkedAt: cached.checkedAt
      }
    }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `TrueDeck/${currentVersion}`
      }
    })

    if (res.status === 404) {
      // No releases published yet
      const empty: UpdateInfo = {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: `https://github.com/${REPO}/releases`,
        downloadUrl: null,
        releaseName: null,
        publishedAt: null,
        checkedAt: now
      }
      writeCache({
        checkedAt: now,
        latestVersion: null,
        releaseUrl: empty.releaseUrl,
        downloadUrl: null,
        releaseName: null,
        publishedAt: null
      })
      return empty
    }

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`)
    }

    const data = (await res.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
      published_at?: string
      assets?: { name: string; browser_download_url: string }[]
    }

    const latestVersion = normalizeVersion(data.tag_name || data.name || '')
    const releaseUrl = data.html_url || `https://github.com/${REPO}/releases/latest`
    const downloadUrl = pickDownload(data.assets || [])
    const updateAvailable =
      Boolean(latestVersion) && compareVersions(latestVersion, currentVersion) > 0

    writeCache({
      checkedAt: now,
      latestVersion: latestVersion || null,
      releaseUrl,
      downloadUrl,
      releaseName: data.name || data.tag_name || null,
      publishedAt: data.published_at || null
    })

    return {
      currentVersion,
      latestVersion: latestVersion || null,
      updateAvailable,
      releaseUrl,
      downloadUrl,
      releaseName: data.name || data.tag_name || null,
      publishedAt: data.published_at || null,
      checkedAt: now
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Fall back to cache on network error
    const cached = readCache()
    if (cached?.latestVersion) {
      return {
        currentVersion,
        latestVersion: cached.latestVersion,
        updateAvailable: compareVersions(cached.latestVersion, currentVersion) > 0,
        releaseUrl: cached.releaseUrl,
        downloadUrl: cached.downloadUrl,
        releaseName: cached.releaseName,
        publishedAt: cached.publishedAt,
        checkedAt: cached.checkedAt,
        error: msg
      }
    }
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: `https://github.com/${REPO}/releases`,
      downloadUrl: null,
      releaseName: null,
      publishedAt: null,
      checkedAt: now,
      error: msg
    }
  }
}
