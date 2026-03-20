import { useState, useEffect } from 'react';
import FileViewer from './FileViewer';

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

interface DirectoryListing {
  path: string;
  parent: string | null;
  files: FileEntry[];
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function FileBrowser() {
  const [currentPath, setCurrentPath] = useState('/');
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewingFile, setViewingFile] = useState<string | null>(null);

  const fetchDirectory = async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      if (res.ok) {
        const data = await res.json();
        setListing(data);
        setCurrentPath(path);
      } else {
        const { error } = await res.json();
        setError(error || 'Failed to load directory');
      }
    } catch (e) {
      setError('Failed to load directory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectory(currentPath);
  }, []);

  const handleNavigate = (entry: FileEntry) => {
    if (entry.type === 'directory') {
      fetchDirectory(`${currentPath}/${entry.name}`);
    } else {
      setViewingFile(`${currentPath}/${entry.name}`);
    }
  };

  const handleNavigateUp = () => {
    if (listing?.parent) {
      fetchDirectory(listing.parent);
    }
  };

  if (viewingFile) {
    return (
      <FileViewer
        filePath={viewingFile}
        onBack={() => setViewingFile(null)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#1a1a2e]">
      {/* Path header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#252540] border-b border-[#2d2d4a]">
        {listing?.parent && (
          <button
            onClick={handleNavigateUp}
            className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-[#2d2d4a]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        )}
        <span className="text-sm text-slate-300 font-mono truncate flex-1">
          {currentPath}
        </span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-slate-400 text-center py-8">Loading...</div>
        ) : error ? (
          <div className="text-red-400 text-center py-8">{error}</div>
        ) : listing?.files.length === 0 ? (
          <div className="text-slate-400 text-center py-8">Empty directory</div>
        ) : (
          <ul className="divide-y divide-[#2d2d4a]">
            {listing?.files.map((entry) => (
              <li key={entry.name}>
                <button
                  onClick={() => handleNavigate(entry)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#252540] transition-colors text-left"
                >
                  {entry.type === 'directory' ? (
                    <svg className="w-5 h-5 text-[#4fd1c5]" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-slate-400" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  <span className="flex-1 text-white truncate">
                    {entry.name}
                    {entry.type === 'directory' && '/'}
                  </span>
                  {entry.type === 'file' && (
                    <span className="text-slate-500 text-sm">
                      {formatSize(entry.size)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
