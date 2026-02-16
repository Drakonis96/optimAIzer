import React, { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileCode, Printer, ChevronDown } from 'lucide-react';
import { Message, Conversation, Language } from '../types';
import { generateMarkdown, generateHTML, downloadFile, printToPDF } from '../utils/export';
import { TRANSLATIONS } from '../constants';

interface ExportButtonProps {
  conversation: Conversation;
  messages: Message[];
  userName: string;
  language: Language;
}

export const ExportButton: React.FC<ExportButtonProps> = ({ conversation, messages, userName, language }) => {
  const t = TRANSLATIONS[language];
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (type: 'md' | 'html' | 'pdf') => {
    const filename = `${conversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;

    if (type === 'md') {
      const content = generateMarkdown(conversation, messages, userName);
      downloadFile(content, `${filename}.md`, 'text/markdown');
    } else if (type === 'html') {
      const content = generateHTML(conversation, messages, userName);
      downloadFile(content, `${filename}.html`, 'text/html');
    } else if (type === 'pdf') {
      printToPDF(conversation, messages, userName);
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors text-xs font-medium border border-transparent ${isOpen ? 'bg-zinc-800 text-white border-zinc-700' : ''}`}
        title={t.export.download}
      >
        <Download size={16} />
        <span className="hidden md:inline">{t.export.download}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-border rounded-lg shadow-xl z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
           <div className="py-1">
             <button 
                onClick={() => handleExport('md')}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-indigo-400 flex items-center gap-3 transition-colors"
             >
                <FileCode size={16} />
                <span>{t.export.markdown}</span>
             </button>
             <button 
                onClick={() => handleExport('html')}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-indigo-400 flex items-center gap-3 transition-colors"
             >
                <FileText size={16} />
                <span>{t.export.html}</span>
             </button>
             <button 
                onClick={() => handleExport('pdf')}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-indigo-400 flex items-center gap-3 transition-colors border-t border-zinc-800"
             >
                <Printer size={16} />
                <span>{t.export.pdf}</span>
             </button>
           </div>
        </div>
      )}
    </div>
  );
};