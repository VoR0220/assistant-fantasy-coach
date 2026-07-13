import type { NewsSnippet } from '../../types/index.js';

export type RationaleSourceKind =
  | 'sleeper'
  | 'news'
  | 'league'
  | 'mcp'
  | 'rule_engine'
  | 'performance'
  | 'agent';

export interface RationaleLine {
  text: string;
  /** Short citation shown under/after the claim */
  source: string;
  url?: string;
  sourceKind?: RationaleSourceKind;
}

export function cite(
  text: string,
  source: string,
  opts?: { url?: string; sourceKind?: RationaleSourceKind }
): RationaleLine {
  return {
    text: text.trim(),
    source: source.trim(),
    url: opts?.url,
    sourceKind: opts?.sourceKind,
  };
}

export function citeSleeper(text: string, detail: string): RationaleLine {
  return cite(text, `Sleeper · ${detail}`, { sourceKind: 'sleeper' });
}

export function citeLeague(text: string, detail: string): RationaleLine {
  return cite(text, `League settings · ${detail}`, { sourceKind: 'league' });
}

export function citeRules(text: string, detail: string): RationaleLine {
  return cite(text, `Rule engine · ${detail}`, { sourceKind: 'rule_engine' });
}

export function citePerformance(text: string, detail: string): RationaleLine {
  return cite(text, `Recent scoring · ${detail}`, { sourceKind: 'performance' });
}

export function citeNews(text: string, snippet: NewsSnippet): RationaleLine {
  const label = snippet.headline
    ? `${snippet.source} · “${snippet.headline}”`
    : snippet.source;
  return cite(text, `News / MCP · ${label}`, {
    url: snippet.url,
    sourceKind: 'news',
  });
}

export function citeAgent(text: string, detail = 'comparative synthesis'): RationaleLine {
  return cite(text, `Agent · ${detail}`, { sourceKind: 'agent' });
}

/** Accept LLM output that may be strings or {text,source} objects. */
export function normalizeRationaleLines(
  raw: unknown,
  fallbackSource = 'Agent · synthesis'
): RationaleLine[] {
  if (!Array.isArray(raw)) return [];
  const out: RationaleLine[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push(cite(item, fallbackSource, { sourceKind: 'agent' }));
      continue;
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const text = String(obj.text ?? obj.claim ?? obj.rationale ?? '').trim();
      if (!text) continue;
      const source = String(obj.source ?? obj.citation ?? fallbackSource).trim();
      const url = typeof obj.url === 'string' ? obj.url : undefined;
      const sourceKind =
        typeof obj.sourceKind === 'string'
          ? (obj.sourceKind as RationaleSourceKind)
          : source.toLowerCase().includes('sleeper')
            ? 'sleeper'
            : source.toLowerCase().includes('news') || source.toLowerCase().includes('mcp')
              ? 'news'
              : source.toLowerCase().includes('league')
                ? 'league'
                : source.toLowerCase().includes('rule')
                  ? 'rule_engine'
                  : 'agent';
      out.push({ text, source, url, sourceKind });
    }
  }
  return out;
}

/** Flatten for callers that still want string[]. Prefer displayRationaleLine. */
export function rationaleToStrings(lines: RationaleLine[]): string[] {
  return lines.map((l) => `${l.text} [${l.source}]`);
}

export function displayRationaleLine(line: string | RationaleLine): RationaleLine {
  if (typeof line === 'string') {
    const m = line.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    if (m) return cite(m[1], m[2]);
    return cite(line, 'Agent', { sourceKind: 'agent' });
  }
  return line;
}
