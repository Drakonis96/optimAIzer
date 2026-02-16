// ---------------------------------------------------------------------------
// Sonarr API Client — TV Series management via Sonarr
// ---------------------------------------------------------------------------

export interface SonarrConfig {
  url: string;        // e.g. http://localhost:8989
  apiKey: string;
}

export interface SonarrSeries {
  id: number;
  title: string;
  year: number;
  tvdbId: number;
  imdbId?: string;
  overview?: string;
  status: string;
  monitored: boolean;
  seasonCount: number;
  totalEpisodeCount: number;
  episodeCount: number;       // episodes with files
  episodeFileCount: number;
  sizeOnDisk: number;
  genres?: string[];
  ratings?: { votes: number; value: number };
  added?: string;
  seasons?: SonarrSeason[];
  network?: string;
  runtime?: number;
  seriesType?: string;
  path?: string;
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    episodeCount: number;
    episodeFileCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    percentOfEpisodes: number;
  };
}

export interface SonarrEpisode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  airDate?: string;
  airDateUtc?: string;
  episodeFile?: {
    quality?: { quality?: { name?: string } };
    size?: number;
    relativePath?: string;
  };
}

export interface SonarrSearchResult {
  title: string;
  year: number;
  tvdbId: number;
  imdbId?: string;
  overview?: string;
  seasonCount: number;
  genres?: string[];
  ratings?: { votes: number; value: number };
  images?: Array<{ coverType: string; remoteUrl: string }>;
  network?: string;
  runtime?: number;
  status?: string;
  seasons?: Array<{ seasonNumber: number; monitored: boolean }>;
}

export interface SonarrRelease {
  guid: string;
  title: string;
  indexer: string;
  indexerId: number;
  size: number;
  seeders: number;
  leechers: number;
  quality: { quality?: { name?: string; id?: number } };
  rejections?: string[];
  approved: boolean;
  protocol: string;
  age: number;
  ageHours: number;
  ageMinutes: number;
  languages?: Array<{ name: string }>;
  customFormatScore?: number;
  fullSeason?: boolean;
  seasonNumber?: number;
  episodeNumbers?: number[];
}

export interface SonarrQueueItem {
  id: number;
  seriesId: number;
  episodeId: number;
  title: string;
  status: string;
  size: number;
  sizeleft: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  downloadClient?: string;
  protocol?: string;
  quality?: { quality?: { name?: string } };
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
    title: string;
  };
  series?: {
    title: string;
  };
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
}

export interface SonarrRootFolder {
  id: number;
  path: string;
  freeSpace: number;
}

// ---------------------------------------------------------------------------

async function sonarrFetch<T>(config: SonarrConfig, endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${config.url.replace(/\/+$/, '')}/api/v3${endpoint}`;
  const headers: Record<string, string> = {
    'X-Api-Key': config.apiKey,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Sonarr API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test connection to Sonarr
 */
export async function testSonarrConnection(config: SonarrConfig): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    const status = await sonarrFetch<{ version: string }>(config, '/system/status');
    return { success: true, version: status.version };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Search series by term (lookup from TVDB)
 */
export async function searchSeries(config: SonarrConfig, term: string): Promise<SonarrSearchResult[]> {
  const results = await sonarrFetch<SonarrSearchResult[]>(config, `/series/lookup?term=${encodeURIComponent(term)}`);
  return results.slice(0, 15);
}

/**
 * Lookup a series by external ID (TVDB, IMDb) with fallback.
 * Tries each ID type until a result is found.
 * Returns the best matching result or null.
 */
export async function lookupSeriesByExternalId(
  config: SonarrConfig,
  ids: { tvdbId?: number; imdbId?: string }
): Promise<SonarrSearchResult | null> {
  // Try TVDB first (Sonarr's primary ID)
  if (ids.tvdbId) {
    try {
      const results = await sonarrFetch<SonarrSearchResult[]>(config, `/series/lookup?term=tvdb:${ids.tvdbId}`);
      if (results.length > 0) return results[0];
    } catch { /* fallback to next */ }
  }
  // Then IMDb
  if (ids.imdbId) {
    try {
      const results = await sonarrFetch<SonarrSearchResult[]>(config, `/series/lookup?term=imdb:${encodeURIComponent(ids.imdbId)}`);
      if (results.length > 0) return results[0];
    } catch { /* fallback */ }
  }
  return null;
}

/**
 * Search series and group results that share the same title but differ in year.
 * Returns the results plus disambiguation info if needed.
 */
export async function searchSeriesWithDisambiguation(
  config: SonarrConfig,
  term: string
): Promise<{ results: SonarrSearchResult[]; needsDisambiguation: boolean; disambiguation?: { title: string; years: number[]; options: Array<{ year: number; tvdbId: number; imdbId?: string; overview?: string; network?: string }> } }> {
  const results = await searchSeries(config, term);
  if (results.length <= 1) {
    return { results, needsDisambiguation: false };
  }

  // Group by normalized title to find duplicates
  const normalizedTerm = term.toLowerCase().trim();
  const titleGroups = new Map<string, SonarrSearchResult[]>();
  for (const r of results) {
    const key = r.title.toLowerCase().trim();
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key)!.push(r);
  }

  // Check if there are multiple series with the same title or very close to the search term
  for (const [title, group] of titleGroups) {
    if (group.length > 1 && (title.includes(normalizedTerm) || normalizedTerm.includes(title))) {
      const uniqueYears = [...new Set(group.map(g => g.year))].sort();
      if (uniqueYears.length > 1) {
        return {
          results,
          needsDisambiguation: true,
          disambiguation: {
            title: group[0].title,
            years: uniqueYears,
            options: group.map(g => ({
              year: g.year,
              tvdbId: g.tvdbId,
              imdbId: g.imdbId,
              overview: g.overview?.slice(0, 120),
              network: g.network,
            })),
          },
        };
      }
    }
  }

  return { results, needsDisambiguation: false };
}

/**
 * Get all series in the library
 */
export async function getLibrarySeries(config: SonarrConfig): Promise<SonarrSeries[]> {
  return sonarrFetch<SonarrSeries[]>(config, '/series');
}

/**
 * Check if a series (by TVDB ID) is already in the library
 */
export async function isSeriesInLibrary(config: SonarrConfig, tvdbId: number): Promise<SonarrSeries | null> {
  const series = await getLibrarySeries(config);
  return series.find(s => s.tvdbId === tvdbId) || null;
}

/**
 * Check if a series is in library by any external ID (TVDB, IMDb) with fallback
 */
export async function isSeriesInLibraryByExternalId(
  config: SonarrConfig,
  ids: { tvdbId?: number; imdbId?: string }
): Promise<SonarrSeries | null> {
  const series = await getLibrarySeries(config);
  // Try TVDB first
  if (ids.tvdbId) {
    const found = series.find(s => s.tvdbId === ids.tvdbId);
    if (found) return found;
  }
  // Then IMDb
  if (ids.imdbId) {
    const found = series.find(s => s.imdbId === ids.imdbId);
    if (found) return found;
  }
  return null;
}

/**
 * Get a specific series by ID
 */
export async function getSeries(config: SonarrConfig, seriesId: number): Promise<SonarrSeries> {
  return sonarrFetch<SonarrSeries>(config, `/series/${seriesId}`);
}

/**
 * Get episodes for a series
 */
export async function getEpisodes(config: SonarrConfig, seriesId: number): Promise<SonarrEpisode[]> {
  return sonarrFetch<SonarrEpisode[]>(config, `/episode?seriesId=${seriesId}`);
}

/**
 * Get episodes for a specific season
 */
export async function getSeasonEpisodes(config: SonarrConfig, seriesId: number, seasonNumber: number): Promise<SonarrEpisode[]> {
  const episodes = await getEpisodes(config, seriesId);
  return episodes.filter(e => e.seasonNumber === seasonNumber);
}

/**
 * Add a series to the library
 */
export async function addSeries(
  config: SonarrConfig,
  tvdbId: number,
  options?: {
    qualityProfileId?: number;
    rootFolderPath?: string;
    seasonFolder?: boolean;
    monitored?: boolean;
    monitoredSeasons?: number[];  // null = all, specific season numbers
    searchForMissingEpisodes?: boolean;
    seriesType?: 'standard' | 'anime' | 'daily';
  }
): Promise<SonarrSeries> {
  // Look up the series details
  const lookupResults = await sonarrFetch<SonarrSearchResult[]>(config, `/series/lookup?term=tvdb:${tvdbId}`);
  if (lookupResults.length === 0) {
    throw new Error(`No se encontró la serie con TVDB ID ${tvdbId}`);
  }

  const seriesData = lookupResults[0] as any;

  // Get defaults
  const rootFolders = await getRootFolders(config);
  const qualityProfiles = await getQualityProfiles(config);

  const rootFolderPath = options?.rootFolderPath || rootFolders[0]?.path;
  const qualityProfileId = options?.qualityProfileId || qualityProfiles[0]?.id;

  if (!rootFolderPath) throw new Error('No hay carpeta raíz configurada en Sonarr');
  if (!qualityProfileId) throw new Error('No hay perfil de calidad configurado en Sonarr');

  // Configure which seasons to monitor
  if (options?.monitoredSeasons && seriesData.seasons) {
    seriesData.seasons = seriesData.seasons.map((s: any) => ({
      ...s,
      monitored: options.monitoredSeasons!.includes(s.seasonNumber),
    }));
  }

  const payload = {
    ...seriesData,
    qualityProfileId,
    rootFolderPath,
    seasonFolder: options?.seasonFolder !== false,
    monitored: options?.monitored !== false,
    seriesType: options?.seriesType || seriesData.seriesType || 'standard',
    addOptions: {
      searchForMissingEpisodes: options?.searchForMissingEpisodes !== false,
      monitor: options?.monitoredSeasons ? 'none' : 'all',
    },
  };

  return sonarrFetch<SonarrSeries>(config, '/series', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Delete a series from the library
 */
export async function deleteSeries(config: SonarrConfig, seriesId: number, deleteFiles: boolean = false): Promise<void> {
  await sonarrFetch<void>(config, `/series/${seriesId}?deleteFiles=${deleteFiles}`, {
    method: 'DELETE',
  });
}

/**
 * Monitor/unmonitor a specific season
 */
export async function monitorSeason(config: SonarrConfig, seriesId: number, seasonNumber: number, monitored: boolean): Promise<SonarrSeries> {
  const series = await getSeries(config, seriesId);
  if (series.seasons) {
    series.seasons = series.seasons.map(s =>
      s.seasonNumber === seasonNumber ? { ...s, monitored } : s
    );
  }
  return sonarrFetch<SonarrSeries>(config, `/series/${seriesId}`, {
    method: 'PUT',
    body: JSON.stringify(series),
  });
}

/**
 * Monitor/unmonitor specific episodes
 */
export async function monitorEpisodes(config: SonarrConfig, episodeIds: number[], monitored: boolean): Promise<void> {
  await sonarrFetch<any>(config, '/episode/monitor', {
    method: 'PUT',
    body: JSON.stringify({ episodeIds, monitored }),
  });
}

/**
 * Trigger a search for a specific season
 */
export async function searchSeason(config: SonarrConfig, seriesId: number, seasonNumber: number): Promise<void> {
  await sonarrFetch<any>(config, '/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'SeasonSearch', seriesId, seasonNumber }),
  });
}

/**
 * Trigger a search for specific episodes
 */
export async function searchEpisodes(config: SonarrConfig, episodeIds: number[]): Promise<void> {
  await sonarrFetch<any>(config, '/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'EpisodeSearch', episodeIds }),
  });
}

/**
 * Trigger a search for the whole series
 */
export async function searchSeriesDownload(config: SonarrConfig, seriesId: number): Promise<void> {
  await sonarrFetch<any>(config, '/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'SeriesSearch', seriesId }),
  });
}

/**
 * Get download queue
 */
export async function getQueue(config: SonarrConfig): Promise<SonarrQueueItem[]> {
  const result = await sonarrFetch<{ records: SonarrQueueItem[] }>(config, '/queue?page=1&pageSize=50&includeSeries=true&includeEpisode=true');
  return result.records || [];
}

/**
 * Get quality profiles
 */
export async function getQualityProfiles(config: SonarrConfig): Promise<SonarrQualityProfile[]> {
  return sonarrFetch<SonarrQualityProfile[]>(config, '/qualityprofile');
}

/**
 * Get root folders
 */
export async function getRootFolders(config: SonarrConfig): Promise<SonarrRootFolder[]> {
  return sonarrFetch<SonarrRootFolder[]>(config, '/rootfolder');
}

/**
 * Search series in library by title, optionally filtering by year for disambiguation
 */
export async function findSeriesInLibrary(config: SonarrConfig, title: string, year?: number): Promise<SonarrSeries | null> {
  const series = await getLibrarySeries(config);
  const normalized = title.toLowerCase().trim();
  const candidates = series.filter(s =>
    s.title.toLowerCase().includes(normalized) ||
    normalized.includes(s.title.toLowerCase())
  );
  if (candidates.length === 0) return null;
  // If year specified, filter by year for precise match
  if (year) {
    const exact = candidates.find(s => s.year === year);
    if (exact) return exact;
  }
  return candidates[0];
}

/**
 * Find series in library that match a title, returning all matches for disambiguation
 */
export async function findSeriesListInLibrary(config: SonarrConfig, title: string): Promise<SonarrSeries[]> {
  const series = await getLibrarySeries(config);
  const normalized = title.toLowerCase().trim();
  return series.filter(s =>
    s.title.toLowerCase().includes(normalized) ||
    normalized.includes(s.title.toLowerCase())
  );
}

/**
 * Get available releases for an episode, sorted by peer ratio (seeders/leechers).
 * Returns the top N releases with details about peers, quality, rejections, and indexer.
 */
export async function getEpisodeReleases(config: SonarrConfig, episodeId: number, limit: number = 5): Promise<SonarrRelease[]> {
  const releases = await sonarrFetch<SonarrRelease[]>(config, `/release?episodeId=${episodeId}`);

  // Sort by peer ratio: seeders / (leechers || 1) descending
  const sorted = releases.sort((a, b) => {
    const ratioA = a.seeders / (a.leechers || 1);
    const ratioB = b.seeders / (b.leechers || 1);
    return ratioB - ratioA;
  });

  return sorted.slice(0, limit);
}

/**
 * Get available releases for a season, sorted by peer ratio (seeders/leechers).
 * Returns the top N releases with details about peers, quality, rejections, and indexer.
 */
export async function getSeasonReleases(config: SonarrConfig, seriesId: number, seasonNumber: number, limit: number = 5): Promise<SonarrRelease[]> {
  // Get all episodes for this season to find their IDs
  const episodes = await getSeasonEpisodes(config, seriesId, seasonNumber);
  if (episodes.length === 0) return [];

  // Use the first episode to get releases (Sonarr will return season packs too)
  const releases = await sonarrFetch<SonarrRelease[]>(config, `/release?episodeId=${episodes[0].id}`);

  // Sort by peer ratio: seeders / (leechers || 1) descending
  const sorted = releases.sort((a, b) => {
    const ratioA = a.seeders / (a.leechers || 1);
    const ratioB = b.seeders / (b.leechers || 1);
    return ratioB - ratioA;
  });

  return sorted.slice(0, limit);
}

/**
 * Grab (download) a specific release by its GUID
 */
export async function grabEpisodeRelease(config: SonarrConfig, guid: string, indexerId: number): Promise<void> {
  await sonarrFetch<any>(config, '/release', {
    method: 'POST',
    body: JSON.stringify({ guid, indexerId }),
  });
}
