import { useState, useEffect } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

interface FileViewerProps {
  filePath: string;
  onBack: () => void;
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi']);

function getLanguage(extension: string): string | undefined {
  const map: Record<string, string> = {
    '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp', '.cs': 'csharp',
    '.php': 'php', '.swift': 'swift', '.kt': 'kotlin', '.scala': 'scala',
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.fish': 'bash',
    '.ps1': 'powershell', '.sql': 'sql', '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.sass': 'scss', '.less': 'less',
    '.json': 'json', '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml', '.ini': 'ini', '.md': 'markdown', '.markdown': 'markdown',
    '.dockerfile': 'dockerfile', '.makefile': 'makefile', '.cmake': 'cmake',
    '.graphql': 'graphql', '.gql': 'graphql', '.vue': 'vue', '.svelte': 'svelte',
  };
  return map[extension.toLowerCase()];
}

export default function FileViewer({ filePath, onBack }: FileViewerProps) {
  const [textContent, setTextContent] = useState<{ content: string; extension: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoomed, setZoomed] = useState(false);

  const ext = ('.' + filePath.split('.').pop()).toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  const isVideo = VIDEO_EXTS.has(ext);
  const streamUrl = `/api/files/stream?path=${encodeURIComponent(filePath)}`;
  const fileName = filePath.split('/').pop() || '';

  useEffect(() => {
    if (isImage || isVideo) return;
    setLoading(true);
    setError('');
    fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`)
      .then(r => r.ok ? r.json() : r.json().then((d: { error: string }) => Promise.reject(d.error)))
      .then(data => setTextContent({ content: data.content, extension: data.extension }))
      .catch(e => setError(typeof e === 'string' ? e : 'Failed to load file'))
      .finally(() => setLoading(false));
  }, [filePath]);

  const renderContent = () => {
    if (isImage) {
      return (
        <div className="flex items-center justify-center p-4 min-h-[200px]">
          <img
            src={streamUrl}
            alt={fileName}
            className="max-w-full max-h-[70vh] object-contain cursor-zoom-in"
            onClick={() => setZoomed(true)}
          />
        </div>
      );
    }

    if (isVideo) {
      return (
        <div className="flex items-center justify-center p-4">
          <video
            src={streamUrl}
            controls
            className="max-w-full max-h-[75vh]"
          />
        </div>
      );
    }

    if (loading) return <div className="text-slate-400 text-center py-8">Loading...</div>;
    if (error) return <div className="text-red-400 text-center py-8">{error}</div>;
    if (!textContent) return <div className="text-slate-400 text-center py-8">No content</div>;

    const language = getLanguage(textContent.extension);
    let highlighted: string;
    try {
      highlighted = language
        ? hljs.highlight(textContent.content, { language }).value
        : hljs.highlightAuto(textContent.content).value;
    } catch {
      highlighted = textContent.content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    const lines = highlighted.split('\n');
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-[#2d2d4a]">
                <td className="px-3 py-0.5 text-right text-slate-500 select-none border-r border-[#2d2d4a] w-12">
                  {i + 1}
                </td>
                <td
                  className="px-3 py-0.5 text-slate-200 whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: line || ' ' }}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[#1a1a2e]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#252540] border-b border-[#2d2d4a]">
        <button
          onClick={onBack}
          className="p-2 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-[#2d2d4a]"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm text-white font-medium truncate flex-1">{fileName}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[#252540]">
        {renderContent()}
      </div>

      {/* Zoom lightbox */}
      {zoomed && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setZoomed(false)}
        >
          <img
            src={streamUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain cursor-zoom-out"
          />
        </div>
      )}
    </div>
  );
}
