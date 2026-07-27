import { useState, useMemo, useCallback, useEffect } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import { debounce } from '~/utils/debounce';

interface DisplayMatch {
  path: string;
  lineNumber: number;
  matchCharStart: number;
  matchCharEnd: number;
}

/*
 * Simple client-side text search — replaces WebContainer's textSearch.
 * Searches through the workbench store's file contents directly.
 */
async function performTextSearch(query: string, onProgress: (results: DisplayMatch[]) => void): Promise<void> {
  const map = workbenchStore.files.get();
  const prefix = `${WORK_DIR}/`;
  const searchQuery = query.toLowerCase();
  const allMatches: DisplayMatch[] = [];

  for (const [path, dirent] of Object.entries(map)) {
    if (!dirent || dirent.type !== 'file' || dirent.isBinary) {
      continue;
    }

    if (!path.startsWith(prefix)) {
      continue;
    }

    const rel = path.slice(prefix.length);

    if (rel.startsWith('node_modules/') || rel.includes('/node_modules/')) {
      continue;
    }

    const content = dirent.content || '';
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const idx = line.indexOf(searchQuery);

      if (idx >= 0) {
        allMatches.push({
          path: rel,
          lineNumber: i + 1,
          matchCharStart: idx,
          matchCharEnd: idx + query.length,
        });
      }
    }

    if (allMatches.length > 0 && allMatches.length % 50 === 0) {
      onProgress(allMatches.slice());
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress(allMatches);
}

export function Search() {
  const [searchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DisplayMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  const groupedResults = useMemo(() => {
    const grouped: Record<string, DisplayMatch[]> = {};

    for (const match of searchResults) {
      if (!grouped[match.path]) {
        grouped[match.path] = [];
      }

      grouped[match.path].push(match);
    }

    return Object.entries(grouped).map(([path, matches]) => ({
      path,
      matches,
      count: matches.length,
    }));
  }, [searchResults]);

  const executeSearch = useCallback(
    debounce(async (query: string) => {
      if (!query.trim()) {
        setSearchResults([]);
        setHasSearched(false);

        return;
      }

      setIsSearching(true);
      setSearchResults([]);
      setExpandedFiles({});
      setHasSearched(true);

      try {
        await performTextSearch(query, (results) => {
          setSearchResults(results);
        });
      } catch (error) {
        console.error('Search failed:', error);
      } finally {
        setIsSearching(false);
      }
    }, 500),
    [],
  );

  useEffect(() => {
    executeSearch(searchQuery);
  }, [searchQuery, executeSearch]);

  const toggleFileExpansion = (path: string) => {
    setExpandedFiles((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const getFileContent = (path: string): string => {
    const map = workbenchStore.files.get();
    const dirent = map[`${WORK_DIR}/${path}`];

    return (dirent && dirent.type === 'file' && dirent.content) || '';
  };

  if (!searchQuery.trim()) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 border-b border-[#1E1E1E] flex items-center gap-2">
        <span className="text-sm text-[#999]">Search</span>
        <span className="text-xs text-[#666]">({searchResults.length} results)</span>
      </div>
      <div className="flex-1 overflow-auto">
        {isSearching && <div className="px-4 py-2 text-sm text-[#666]">Searching...</div>}
        {!isSearching && searchResults.length === 0 && hasSearched && (
          <div className="px-4 py-2 text-sm text-[#666]">No results found</div>
        )}
        {groupedResults.map(({ path, matches, count }) => {
          const isExpanded = expandedFiles[path];
          return (
            <div key={path} className="border-b border-[#1E1E1E]">
              <button
                type="button"
                onClick={() => toggleFileExpansion(path)}
                className="w-full px-4 py-2 flex items-center gap-2 hover:bg-[#1E1E1E] text-left"
              >
                <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                <span className="text-sm text-[#4D9EFF] truncate">{path}</span>
                <span className="text-xs text-[#666] ml-auto">{count}</span>
              </button>
              {isExpanded && (
                <div className="px-8 pb-2">
                  {matches.map((match, i) => {
                    const content = getFileContent(path);
                    const line = content.split('\n')[match.lineNumber - 1] || '';

                    return (
                      <div key={i} className="py-1 text-xs font-mono">
                        <span className="text-[#666]">{match.lineNumber}: </span>
                        <span className="text-[#ccc]">{line.trim().slice(0, 100)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
