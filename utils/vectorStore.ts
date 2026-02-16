/**
 * Lightweight TF-IDF Vector Store for RAG / Infinite Memory
 *
 * No external dependencies – runs entirely in the browser.
 * Uses TF-IDF weighted cosine-similarity for retrieval.
 *
 * Design goals:
 * - Zero API calls / zero tokens consumed for search
 * - Incremental indexing (add documents one-at-a-time)
 * - Fast enough for tens of thousands of snippets
 */

// ---- Stopwords (EN + ES) ----
const STOP_WORDS = new Set([
  // English
  'a','an','and','are','as','at','be','but','by','for','from','had','has','have','he',
  'her','his','how','i','if','in','into','is','it','its','just','me','my','no','nor',
  'not','of','on','or','our','out','own','say','she','so','some','than','that','the',
  'their','them','then','there','these','they','this','to','too','up','us','very','was',
  'we','what','when','where','which','while','who','whom','why','will','with','you','your',
  // Spanish
  'un','una','unos','unas','el','la','los','las','de','del','al','y','o','pero','que',
  'en','es','por','con','para','se','no','lo','le','les','su','sus','como','más','ya',
  'este','esta','estos','estas','ese','esa','esos','esas','aquel','aquella','mi','tu',
  'nos','nuestro','nuestra','nuestros','nuestras','han','ha','hay','fue','ser','estar',
  'son','están','era','sin','sobre','también','muy','tiene','tienen','todo','toda',
  'todos','todas','otro','otra','otros','otras','entre','desde','hasta','durante',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-záéíóúñüàèìòùâêîôû0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

// ---- Types ----

export interface VectorDocument {
  id: string;
  conversationId: string;
  conversationTitle: string;
  content: string;
  timestamp: number;
  role: string;
  /** Derived at index time */
  tokens?: string[];
  /** TF-IDF vector (sparse map: term → weight) */
  tfidf?: Map<string, number>;
}

export interface SearchResult {
  document: VectorDocument;
  score: number;
}

// ---- VectorStore class ----

export class VectorStore {
  private documents: Map<string, VectorDocument> = new Map();
  /** Inverted index: term → Set of doc ids */
  private invertedIndex: Map<string, Set<string>> = new Map();
  /** doc freq: term → number of docs containing it */
  private docFreq: Map<string, number> = new Map();
  private dirty = true; // track whether tfidf vectors need rebuild

  get size(): number {
    return this.documents.size;
  }

  /** Add or update a single document */
  addDocument(doc: VectorDocument): void {
    // Remove old version if exists
    if (this.documents.has(doc.id)) {
      this.removeDocument(doc.id);
    }

    const tokens = tokenize(doc.content);
    doc.tokens = tokens;

    this.documents.set(doc.id, doc);

    // Update inverted index & doc freq
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      if (!this.invertedIndex.has(term)) {
        this.invertedIndex.set(term, new Set());
        this.docFreq.set(term, 0);
      }
      this.invertedIndex.get(term)!.add(doc.id);
      this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1);
    }
    this.dirty = true;
  }

  /** Bulk add – more efficient for bootstrapping */
  addDocuments(docs: VectorDocument[]): void {
    for (const doc of docs) {
      this.addDocument(doc);
    }
  }

  removeDocument(id: string): void {
    const doc = this.documents.get(id);
    if (!doc) return;

    const uniqueTerms = new Set(doc.tokens || []);
    for (const term of uniqueTerms) {
      const set = this.invertedIndex.get(term);
      if (set) {
        set.delete(id);
        const freq = (this.docFreq.get(term) || 1) - 1;
        if (freq <= 0) {
          this.invertedIndex.delete(term);
          this.docFreq.delete(term);
        } else {
          this.docFreq.set(term, freq);
        }
      }
    }
    this.documents.delete(id);
    this.dirty = true;
  }

  /** Remove all documents from a conversation */
  removeConversation(conversationId: string): void {
    const toRemove: string[] = [];
    for (const [id, doc] of this.documents) {
      if (doc.conversationId === conversationId) toRemove.push(id);
    }
    for (const id of toRemove) this.removeDocument(id);
  }

  clear(): void {
    this.documents.clear();
    this.invertedIndex.clear();
    this.docFreq.clear();
    this.dirty = true;
  }

  /** Rebuild TF-IDF vectors for all docs (lazy – only when dirty) */
  private rebuildTfidf(): void {
    if (!this.dirty) return;

    const N = this.documents.size;
    if (N === 0) { this.dirty = false; return; }

    for (const doc of this.documents.values()) {
      const tokens = doc.tokens || [];
      if (tokens.length === 0) { doc.tfidf = new Map(); continue; }

      // Term frequency (normalised by doc length)
      const tf = new Map<string, number>();
      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }

      const vec = new Map<string, number>();
      for (const [term, count] of tf) {
        const normalizedTf = count / tokens.length;
        const df = this.docFreq.get(term) || 1;
        const idf = Math.log((N + 1) / (df + 1)) + 1; // smoothed IDF
        vec.set(term, normalizedTf * idf);
      }
      doc.tfidf = vec;
    }
    this.dirty = false;
  }

  /** Search using cosine similarity of TF-IDF vectors */
  search(query: string, topK = 5, minScore = 0.05): SearchResult[] {
    this.rebuildTfidf();

    const N = this.documents.size;
    if (N === 0) return [];

    // Build query TF-IDF vector
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const queryTf = new Map<string, number>();
    for (const t of queryTokens) {
      queryTf.set(t, (queryTf.get(t) || 0) + 1);
    }

    const queryVec = new Map<string, number>();
    for (const [term, count] of queryTf) {
      const normalizedTf = count / queryTokens.length;
      const df = this.docFreq.get(term) || 0;
      if (df === 0) continue; // term not in corpus, skip
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      queryVec.set(term, normalizedTf * idf);
    }

    if (queryVec.size === 0) return [];

    // Precompute query magnitude
    let queryMag = 0;
    for (const v of queryVec.values()) queryMag += v * v;
    queryMag = Math.sqrt(queryMag);
    if (queryMag === 0) return [];

    // Use inverted index to narrow candidates
    const candidateIds = new Set<string>();
    for (const term of queryVec.keys()) {
      const docIds = this.invertedIndex.get(term);
      if (docIds) {
        for (const id of docIds) candidateIds.add(id);
      }
    }

    // Score candidates
    const results: SearchResult[] = [];
    for (const docId of candidateIds) {
      const doc = this.documents.get(docId);
      if (!doc || !doc.tfidf) continue;

      let dot = 0;
      let docMag = 0;
      for (const [term, w] of doc.tfidf) {
        docMag += w * w;
        const qw = queryVec.get(term);
        if (qw !== undefined) dot += w * qw;
      }
      docMag = Math.sqrt(docMag);
      if (docMag === 0) continue;

      const score = dot / (queryMag * docMag);
      if (score >= minScore) {
        results.push({ document: doc, score });
      }
    }

    // Sort by score descending, timestamp as tiebreaker
    results.sort((a, b) => b.score - a.score || b.document.timestamp - a.document.timestamp);
    return results.slice(0, topK);
  }

  /** Get stats for debugging */
  getStats(): { documents: number; terms: number } {
    return {
      documents: this.documents.size,
      terms: this.invertedIndex.size,
    };
  }
}

/** Singleton instance */
let _store: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (!_store) _store = new VectorStore();
  return _store;
}

export function resetVectorStore(): void {
  _store?.clear();
  _store = null;
}
