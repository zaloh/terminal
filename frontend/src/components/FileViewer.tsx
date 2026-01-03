import { useState, useEffect } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';

interface FileViewerProps {
  filePath: string;
  onBack: () => void;
}

interface TextContent {
  type: 'text';
  content: string;
  extension: string;
}

interface ImageContent {
  type: 'image';
  mimeType: string;
  content: string;
}

type FileContent = TextContent | ImageContent;

function getLanguage(extension: string): string | undefined {
  const map: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c',
    '.hpp': 'cpp',
    '.cs': 'csharp',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala',
    '.sh': 'bash',
    '.bash': 'bash',
    '.zsh': 'bash',
    '.fish': 'bash',
    '.ps1': 'powershell',
    '.sql': 'sql',
    '.html': 'html',
    '.htm': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.sass': 'scss',
    '.less': 'less',
    '.json': 'json',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.ini': 'ini',
    '.md': 'markdown',
    '.markdown': 'markdown',
    '.dockerfile': 'dockerfile',
    '.makefile': 'makefile',
    '.cmake': 'cmake',
    '.graphql': 'graphql',
    '.gql': 'graphql',
    '.vue': 'vue',
    '.svelte': 'svelte',
  };
  return map[extension.toLowerCase()];
}

export default function FileViewer({ filePath, onBack }: FileViewerProps) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
        if (res.ok) {
          const data = await res.json();
          setContent(data);
        } else {
          const { error } = await res.json();
          setError(error || 'Failed to load file');
        }
      } catch (e) {
        setError('Failed to load file');
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, [filePath]);

  const fileName = filePath.split('/').pop() || '';

  const renderContent = () => {
    if (loading) {
      return <div className="text-slate-400 text-center py-8">Loading...</div>;
    }

    if (error) {
      return <div className="text-red-400 text-center py-8">{error}</div>;
    }

    if (!content) {
      return <div className="text-slate-400 text-center py-8">No content</div>;
    }

    if (content.type === 'image') {
      return (
        <div className="flex items-center justify-center p-4 min-h-[200px]">
          <img
            src={`data:${content.mimeType};base64,${content.content}`}
            alt={fileName}
            className="max-w-full max-h-[70vh] object-contain"
          />
        </div>
      );
    }

    // Text content with syntax highlighting
    const language = getLanguage(content.extension);
    let highlighted: string;

    try {
      if (language) {
        highlighted = hljs.highlight(content.content, { language }).value;
      } else {
        highlighted = hljs.highlightAuto(content.content).value;
      }
    } catch {
      highlighted = content.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
        <span className="text-sm text-white font-medium truncate flex-1">
          {fileName}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-[#252540]">
        {renderContent()}
      </div>
    </div>
  );
}
