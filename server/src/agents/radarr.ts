// ---------------------------------------------------------------------------
// Radarr API Client — Movie management via Radarr
// ---------------------------------------------------------------------------

export interface RadarrConfig {
  url: string;        // e.g. http://localhost:7878
  apiKey: string;
}

export interface RadarrMovie {
  id: number;
  title: string;
  year: number;
  tmdbId: number;
  imdbId?: string;
  overview?: string;
  hasFile: boolean;
  monitored: boolean;
  status: string;
  sizeOnDisk: number;
  runtime?: number;
  genres?: string[];
  ratings?: { imdb?: { value: number }; tmdb?: { value: number } };
  added?: string;
  movieFile?: {
    quality?: { quality?: { name?: string } };
    size?: number;
    relativePath?: string;
  };
}

export interface RadarrSearchResult {
  title: string;
  year: number;
  tmdbId: number;
  imdbId?: string;
  overview?: string;
  runtime?: number;
  genres?: string[];
  ratings?: { imdb?: { value: number }; tmdb?: { value: number } };
  images?: Array<{ coverType: string; remoteUrl: string }>;
}

export interface RadarrRelease {
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
}

export interface RadarrQueueItem {
  id: number;
  movieId: number;
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
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
}

export interface RadarrRootFolder {
  id: number;
  path: string;
  freeSpace: number;
}

// ---------------------------------------------------------------------------

async function radarrFetch<T>(config: RadarrConfig, endpoint: string, options: RequestInit = {}): Promise<T> {
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
    throw new Error(`Radarr API error ${response.status}: ${errorText.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test connection to Radarr
 */
export async function testRadarrConnection(config: RadarrConfig): Promise<{ success: boolean; version?: string; error?: string }> {
  try {
    const status = await radarrFetch<{ version: string }>(config, '/system/status');
    return { success: true, version: status.version };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Search movies by term (lookup from TMDB/IMDb)
 */
export async function searchMovies(config: RadarrConfig, term: string): Promise<RadarrSearchResult[]> {
  const results = await radarrFetch<RadarrSearchResult[]>(config, `/movie/lookup?term=${encodeURIComponent(term)}`);
  return results.slice(0, 15);
}

/**
 * Lookup a movie by external ID (IMDb, TMDB) with fallback.
 * Tries each ID type until a result is found.
 * Returns the best matching result or null.
 */
export async function lookupMovieByExternalId(
  config: RadarrConfig,
  ids: { imdbId?: string; tmdbId?: number }
): Promise<RadarrSearchResult | null> {
  // Try IMDb first (most specific)
  if (ids.imdbId) {
    try {
      const results = await radarrFetch<RadarrSearchResult[]>(config, `/movie/lookup?term=imdb:${encodeURIComponent(ids.imdbId)}`);
      if (results.length > 0) return results[0];
    } catch { /* fallback to next */ }
  }
  // Then TMDB
  if (ids.tmdbId) {
    try {
      const results = await radarrFetch<RadarrSearchResult[]>(config, `/movie/lookup?term=tmdb:${ids.tmdbId}`);
      if (results.length > 0) return results[0];
    } catch { /* fallback */ }
  }
  return null;
}

/**
 * Search movies and group results that share the same title but differ in year.
 * Returns the results plus disambiguation info if needed.
 */
export async function searchMoviesWithDisambiguation(
  config: RadarrConfig,
  term: string
): Promise<{ results: RadarrSearchResult[]; needsDisambiguation: boolean; disambiguation?: { title: string; years: number[]; options: Array<{ year: number; tmdbId: number; imdbId?: string; overview?: string }> } }> {
  const results = await searchMovies(config, term);
  if (results.length <= 1) {
    return { results, needsDisambiguation: false };
  }

  // Group by normalized title to find duplicates
  const normalizedTerm = term.toLowerCase().trim();
  const titleGroups = new Map<string, RadarrSearchResult[]>();
  for (const r of results) {
    const key = r.title.toLowerCase().trim();
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key)!.push(r);
  }

  // Check if there are multiple movies with the same title or very close to the search term
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
              tmdbId: g.tmdbId,
              imdbId: g.imdbId,
              overview: g.overview?.slice(0, 120),
            })),
          },
        };
      }
    }
  }

  return { results, needsDisambiguation: false };
}

/**
 * Get all movies in the library
 */
export async function getLibraryMovies(config: RadarrConfig): Promise<RadarrMovie[]> {
  return radarrFetch<RadarrMovie[]>(config, '/movie');
}

/**
 * Check if a movie (by TMDB ID) is already in the library
 */
export async function isMovieInLibrary(config: RadarrConfig, tmdbId: number): Promise<RadarrMovie | null> {
  const movies = await getLibraryMovies(config);
  return movies.find(m => m.tmdbId === tmdbId) || null;
}

/**
 * Check if a movie is in library by any external ID (IMDb, TMDB) with fallback
 */
export async function isMovieInLibraryByExternalId(
  config: RadarrConfig,
  ids: { imdbId?: string; tmdbId?: number }
): Promise<RadarrMovie | null> {
  const movies = await getLibraryMovies(config);
  // Try IMDb first
  if (ids.imdbId) {
    const found = movies.find(m => m.imdbId === ids.imdbId);
    if (found) return found;
  }
  // Then TMDB
  if (ids.tmdbId) {
    const found = movies.find(m => m.tmdbId === ids.tmdbId);
    if (found) return found;
  }
  return null;
}

/**
 * Get a specific movie by ID
 */
export async function getMovie(config: RadarrConfig, movieId: number): Promise<RadarrMovie> {
  return radarrFetch<RadarrMovie>(config, `/movie/${movieId}`);
}

/**
 * Add a movie to the library and optionally start searching
 */
export async function addMovie(
  config: RadarrConfig,
  tmdbId: number,
  options?: { qualityProfileId?: number; rootFolderPath?: string; searchForMovie?: boolean }
): Promise<RadarrMovie> {
  // First, look up the movie details
  const lookupResults = await radarrFetch<RadarrSearchResult[]>(config, `/movie/lookup?term=tmdb:${tmdbId}`);
  if (lookupResults.length === 0) {
    throw new Error(`No se encontró la película con TMDB ID ${tmdbId}`);
  }

  const movieData = lookupResults[0] as any;

  // Get defaults
  const rootFolders = await getRootFolders(config);
  const qualityProfiles = await getQualityProfiles(config);

  const rootFolderPath = options?.rootFolderPath || rootFolders[0]?.path;
  const qualityProfileId = options?.qualityProfileId || qualityProfiles[0]?.id;

  if (!rootFolderPath) throw new Error('No hay carpeta raíz configurada en Radarr');
  if (!qualityProfileId) throw new Error('No hay perfil de calidad configurado en Radarr');

  const payload = {
    ...movieData,
    qualityProfileId,
    rootFolderPath,
    monitored: true,
    addOptions: {
      searchForMovie: options?.searchForMovie !== false,
    },
  };

  return radarrFetch<RadarrMovie>(config, '/movie', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Delete a movie from the library
 */
export async function deleteMovie(config: RadarrConfig, movieId: number, deleteFiles: boolean = false): Promise<void> {
  await radarrFetch<void>(config, `/movie/${movieId}?deleteFiles=${deleteFiles}`, {
    method: 'DELETE',
  });
}

/**
 * Trigger a manual search for a movie
 */
export async function searchMovieDownload(config: RadarrConfig, movieId: number): Promise<void> {
  await radarrFetch<any>(config, '/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movieId] }),
  });
}

/**
 * Get download queue
 */
export async function getQueue(config: RadarrConfig): Promise<RadarrQueueItem[]> {
  const result = await radarrFetch<{ records: RadarrQueueItem[] }>(config, '/queue?page=1&pageSize=50&includeMovie=true');
  return result.records || [];
}

/**
 * Get quality profiles
 */
export async function getQualityProfiles(config: RadarrConfig): Promise<RadarrQualityProfile[]> {
  return radarrFetch<RadarrQualityProfile[]>(config, '/qualityprofile');
}

/**
 * Get root folders
 */
export async function getRootFolders(config: RadarrConfig): Promise<RadarrRootFolder[]> {
  return radarrFetch<RadarrRootFolder[]>(config, '/rootfolder');
}

/**
 * Search movie in library by title, optionally filtering by year for disambiguation
 */
export async function findMovieInLibrary(config: RadarrConfig, title: string, year?: number): Promise<RadarrMovie | null> {
  const movies = await getLibraryMovies(config);
  const normalized = title.toLowerCase().trim();
  const candidates = movies.filter(m =>
    m.title.toLowerCase().includes(normalized) ||
    normalized.includes(m.title.toLowerCase())
  );
  if (candidates.length === 0) return null;
  // If year specified, filter by year for precise match
  if (year) {
    const exact = candidates.find(m => m.year === year);
    if (exact) return exact;
  }
  return candidates[0];
}

/**
 * Find movies in library that match a title, returning all matches for disambiguation
 */
export async function findMoviesInLibrary(config: RadarrConfig, title: string): Promise<RadarrMovie[]> {
  const movies = await getLibraryMovies(config);
  const normalized = title.toLowerCase().trim();
  return movies.filter(m =>
    m.title.toLowerCase().includes(normalized) ||
    normalized.includes(m.title.toLowerCase())
  );
}

/**
 * Get available releases for a movie, sorted by peer ratio (seeders/leechers).
 * Returns the top N releases with details about peers, quality, rejections, and indexer.
 */
export async function getMovieReleases(config: RadarrConfig, movieId: number, limit: number = 5): Promise<RadarrRelease[]> {
  const releases = await radarrFetch<RadarrRelease[]>(config, `/release?movieId=${movieId}`);

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
export async function grabMovieRelease(config: RadarrConfig, guid: string, indexerId: number): Promise<void> {
  await radarrFetch<any>(config, '/release', {
    method: 'POST',
    body: JSON.stringify({ guid, indexerId }),
  });
}
