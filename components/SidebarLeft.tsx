
import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, MessageSquare, Settings, User, Folder, FolderOpen, FileText, Bot,
  Trash2, Edit2, CornerUpLeft, CheckSquare, Square, Menu, FolderInput, Archive, LogOut
} from 'lucide-react';
import { Conversation, Folder as FolderType, Language, WorkspaceView, NoteDocument } from '../types';
import { ConfirmationModal } from './ConfirmationModal';
import { TRANSLATIONS } from '../constants';

interface SidebarAgentItem {
  id: string;
  name: string;
  objective?: string;
  archivedAt?: number | null;
  deletedAt?: number | null;
}

interface SidebarLeftProps {
  conversations: Conversation[];
  notes: NoteDocument[];
  noteFolders: FolderType[];
  agents: SidebarAgentItem[];
  folders: FolderType[];
  activeId: string;
  activeNoteId: string;
  activeAgentId: string;
  onSelectConversation: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSelectAgent: (id: string) => void;
  onNewChat: () => void;
  onNewNote: () => void;
  onNewAgent: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  userName: string;
  onClose: () => void;
  language: Language;
  activeWorkspace: WorkspaceView;
  onChangeWorkspace: (workspace: WorkspaceView) => void;
  // Folder Actions
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
  onDeleteFolder: (id: string) => void;
  // Chat Actions
  onRenameChat: (id: string, newName: string) => void;
  onMoveChat: (chatId: string, folderId: string | null) => void;
  onArchiveChat: (id: string) => void;
  onUnarchiveChat: (id: string) => void;
  onDeleteChat: (id: string) => void; // Soft delete
  onRestoreChat: (id: string) => void;
  onPermanentDeleteChat: (ids: string[]) => void;
  onRenameNote: (id: string, newName: string) => void;
  onArchiveNote: (id: string) => void;
  onUnarchiveNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onRestoreNote: (id: string) => void;
  onPermanentDeleteNote: (ids: string[]) => void;
  onCreateNoteFolder: (name: string) => void;
  onRenameNoteFolder: (id: string, newName: string) => void;
  onDeleteNoteFolder: (id: string) => void;
  onMoveNote: (noteId: string, folderId: string | null) => void;
  onRenameAgent: (id: string, newName: string) => void;
  onArchiveAgent: (id: string) => void;
  onUnarchiveAgent: (id: string) => void;
  onDeleteAgent: (id: string) => void;
  onRestoreAgent: (id: string) => void;
  onPermanentDeleteAgent: (ids: string[]) => void;
}

export const SidebarLeft: React.FC<SidebarLeftProps> = ({
  conversations,
  notes,
  noteFolders,
  agents,
  folders,
  activeId,
  activeNoteId,
  activeAgentId,
  onSelectConversation,
  onSelectNote,
  onSelectAgent,
  onNewChat,
  onNewNote,
  onNewAgent,
  onOpenSettings,
  onLogout,
  userName,
  onClose,
  language,
  activeWorkspace,
  onChangeWorkspace,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onRenameChat,
  onMoveChat,
  onArchiveChat,
  onUnarchiveChat,
  onDeleteChat,
  onRestoreChat,
  onPermanentDeleteChat,
  onRenameNote,
  onArchiveNote,
  onUnarchiveNote,
  onDeleteNote,
  onRestoreNote,
  onPermanentDeleteNote,
  onCreateNoteFolder,
  onRenameNoteFolder,
  onDeleteNoteFolder,
  onMoveNote,
  onRenameAgent,
  onArchiveAgent,
  onUnarchiveAgent,
  onDeleteAgent,
  onRestoreAgent,
  onPermanentDeleteAgent
}) => {
  const t = TRANSLATIONS[language];
  const workspaceLabels = language === 'es'
    ? {
        chat: 'Chat',
        notes: 'Notas',
        agents: 'Agentes',
      }
    : {
        chat: 'Chat',
        notes: 'Notes',
        agents: 'Agents',
      };
  const [viewMode, setViewMode] = useState<'main' | 'trash' | 'archive'>('main');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  
  // Folder Deletion State
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; scope: 'chat' | 'notes' } | null>(null);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  // Trash Selection
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Move Menu State
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);
  const moveMenuRef = useRef<HTMLDivElement>(null);

  // Drag and Drop State
  const [draggedChatId, setDraggedChatId] = useState<string | null>(null);

  // --- Helpers ---
  const toggleFolder = (id: string) => {
    const newCollapsed = new Set(collapsedFolders);
    if (newCollapsed.has(id)) newCollapsed.delete(id);
    else newCollapsed.add(id);
    setCollapsedFolders(newCollapsed);
  };

  const startEditing = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItemId(id);
    setEditName(currentName);
    setMoveMenuId(null); // Close move menu if open
  };

  const saveEditing = (type: 'folder' | 'chat') => {
    if (!editingItemId || !editName.trim()) {
      setEditingItemId(null);
      return;
    }
    if (type === 'folder') {
      if (activeWorkspace === 'notes') onRenameNoteFolder(editingItemId, editName);
      else onRenameFolder(editingItemId, editName);
    }
    else if (activeWorkspace === 'agents') onRenameAgent(editingItemId, editName);
    else if (activeWorkspace === 'notes') onRenameNote(editingItemId, editName);
    else onRenameChat(editingItemId, editName);
    setEditingItemId(null);
  };

  // Close move menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(event.target as Node)) {
        setMoveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setViewMode('main');
    setSelectedTrashIds(new Set());
    setShowDeleteConfirm(false);
  }, [activeWorkspace]);

  // --- Drag & Drop Handlers ---
  const handleDragStart = (e: React.DragEvent, chatId: string) => {
    e.dataTransfer.setData('chatId', chatId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedChatId(chatId);
    setMoveMenuId(null); // Close menus
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDropOnFolder = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.stopPropagation(); // Stop bubbling to root
    const itemId = e.dataTransfer.getData('chatId');
    if (itemId) {
        if (activeWorkspace === 'notes') onMoveNote(itemId, folderId);
        else onMoveChat(itemId, folderId);
        // Auto open folder on drop
        const newCollapsed = new Set(collapsedFolders);
        newCollapsed.delete(folderId);
        setCollapsedFolders(newCollapsed);
    }
    setDraggedChatId(null);
  };

  const handleDropOnRoot = (e: React.DragEvent) => {
    e.preventDefault();
    const itemId = e.dataTransfer.getData('chatId');
    if (itemId) {
        if (activeWorkspace === 'notes') onMoveNote(itemId, null);
        else onMoveChat(itemId, null);
    }
    setDraggedChatId(null);
  };

  // --- Renderers ---

  const renderEditableItem = (
    id: string, 
    type: 'folder' | 'chat', 
    content: React.ReactNode, 
    currentName: string,
    onClick: () => void,
    onDelete: () => void,
    onArchive?: () => void,
    isActive: boolean = false,
    currentFolderId?: string | null // Optional to know where the chat currently is
  ) => {
    if (editingItemId === id) {
      return (
        <div className="flex items-center px-2 py-1 w-full">
           <input
             autoFocus
             value={editName}
             onChange={(e) => setEditName(e.target.value)}
             onBlur={() => saveEditing(type)}
             onKeyDown={(e) => e.key === 'Enter' && saveEditing(type)}
             className="w-full bg-white dark:bg-zinc-900 border border-indigo-500 rounded px-2 py-1 text-xs text-zinc-900 dark:text-white focus:outline-none shadow-sm"
           />
        </div>
      );
    }

    return (
      <div 
        onClick={onClick}
        className={`group flex items-center justify-between w-full px-2 py-2 rounded-md cursor-pointer transition-colors text-sm relative ${
            isActive 
            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white font-medium' 
            : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-200'
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden flex-1">
            {content}
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {type === 'chat' && (activeWorkspace === 'chat' || activeWorkspace === 'notes') && (
                <div className="relative">
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setMoveMenuId(moveMenuId === id ? null : id);
                        }}
                        className={`p-1 hover:text-indigo-500 dark:hover:text-indigo-400 ${moveMenuId === id ? 'text-indigo-500 dark:text-indigo-400' : 'text-zinc-400 dark:text-zinc-500'}`}
                        title={t.sidebarLeft.moveTo}
                    >
                        <FolderInput size={12} />
                    </button>
                    
                    {/* Move Menu Dropdown */}
                    {moveMenuId === id && (
                        <div 
                            ref={moveMenuRef}
                            className="absolute right-0 top-6 w-40 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-xl z-50 flex flex-col py-1 overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <span className="px-3 py-1.5 text-[10px] uppercase font-bold text-zinc-500 dark:text-zinc-600 border-b border-zinc-100 dark:border-zinc-800 mb-1">{t.sidebarLeft.moveTo}</span>
                            
                            <button
                                onClick={() => {
                                    if (activeWorkspace === 'notes') onMoveNote(id, null);
                                    else onMoveChat(id, null);
                                    setMoveMenuId(null);
                                }}
                                className={`text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 ${currentFolderId === null ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-700 dark:text-zinc-300'}`}
                            >
                                <Folder size={12} /> {t.sidebarLeft.uncategorized}
                            </button>
                            
                            {(activeWorkspace === 'notes' ? noteFolders : folders).map(f => (
                                <button
                                    key={f.id}
                                    onClick={() => {
                                        if (activeWorkspace === 'notes') onMoveNote(id, f.id);
                                        else onMoveChat(id, f.id);
                                        setMoveMenuId(null);
                                    }}
                                    className={`text-left px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 ${currentFolderId === f.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-700 dark:text-zinc-300'}`}
                                >
                                    <FolderOpen size={12} /> {f.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {type === 'chat' && onArchive && (
                <button
                    onClick={(e) => { e.stopPropagation(); onArchive(); }}
                    className="p-1 hover:text-cyan-600 dark:hover:text-cyan-400 text-zinc-400 dark:text-zinc-500"
                    title={activeWorkspace === 'agents'
                      ? (language === 'es' ? 'Archivar agente' : 'Archive agent')
                      : activeWorkspace === 'notes'
                        ? (language === 'es' ? 'Archivar nota' : 'Archive note')
                      : t.sidebarLeft.archiveChat}
                >
                    <Archive size={12} />
                </button>
            )}

            <button 
                onClick={(e) => startEditing(id, currentName, e)}
                className="p-1 hover:text-indigo-500 dark:hover:text-indigo-400 text-zinc-400 dark:text-zinc-500"
                title={t.common.edit}
            >
                <Edit2 size={12} />
            </button>
            <button 
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1 hover:text-red-500 dark:hover:text-red-400 text-zinc-400 dark:text-zinc-500"
                title={t.common.delete}
            >
                <Trash2 size={12} />
            </button>
        </div>
      </div>
    );
  };

  // --- Views ---

  const MainView = () => {
    if (activeWorkspace === 'notes') {
      const activeNotes = notes.filter((note) => !note.deletedAt && !note.archivedAt);
      const rootNotes = activeNotes.filter((note) => !note.folderId);
      return (
        <>
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
              {workspaceLabels.notes}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={onNewNote}
                className="p-1 text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                title={language === 'es' ? 'Nueva nota' : 'New note'}
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => onCreateNoteFolder(t.sidebarLeft.newFolder)}
                className="p-1 text-zinc-500 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                title={t.sidebarLeft.newFolder}
              >
                <Folder size={14} />
              </button>
            </div>
          </div>

          <div
            className="flex-1 overflow-y-auto px-2 space-y-1"
            onDragOver={handleDragOver}
            onDrop={handleDropOnRoot}
          >
            {activeNotes.length === 0 && noteFolders.length === 0 && (
              <div className="text-[10px] text-zinc-500 dark:text-zinc-700 italic px-2">
                {language === 'es'
                  ? 'No hay notas activas. Crea una nueva.'
                  : 'No active notes yet. Create one.'}
              </div>
            )}

            {noteFolders.map((folder) => {
              const folderNotes = activeNotes.filter((note) => note.folderId === folder.id);
              const isCollapsed = collapsedFolders.has(folder.id);
              return (
                <div
                  key={folder.id}
                  className="mb-1 transition-colors rounded-lg"
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDropOnFolder(e, folder.id)}
                >
                  {renderEditableItem(
                    folder.id,
                    'folder',
                    <>
                      {isCollapsed ? <Folder size={14} /> : <FolderOpen size={14} className="text-emerald-500 dark:text-emerald-400" />}
                      <span className="font-medium truncate">{folder.name}</span>
                      <span className="text-[10px] text-zinc-500 dark:text-zinc-600 ml-1">({folderNotes.length})</span>
                    </>,
                    folder.name,
                    () => toggleFolder(folder.id),
                    () => setFolderToDelete({ id: folder.id, scope: 'notes' }),
                  )}

                  {!isCollapsed && (
                    <div className="ml-2 pl-2 border-l border-zinc-200 dark:border-zinc-800/50 space-y-0.5 mt-0.5">
                      {folderNotes.map((note) => (
                        <div
                          key={note.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, note.id)}
                          className="opacity-90 hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {renderEditableItem(
                            note.id,
                            'chat',
                            <>
                              <FileText size={14} className={activeNoteId === note.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'} />
                              <span className={`truncate ${activeNoteId === note.id ? 'text-zinc-900 dark:text-emerald-100' : ''}`}>{note.title}</span>
                            </>,
                            note.title,
                            () => onSelectNote(note.id),
                            () => onDeleteNote(note.id),
                            () => onArchiveNote(note.id),
                            activeNoteId === note.id,
                            folder.id
                          )}
                        </div>
                      ))}
                      {folderNotes.length === 0 && (
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-600 pl-6 py-1 italic">{t.sidebarLeft.emptyFolder}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="mt-4">
              <span className="px-2 text-[10px] text-zinc-500 dark:text-zinc-600 uppercase font-bold tracking-wider mb-2 block">{t.sidebarLeft.uncategorized}</span>
              <div className="min-h-[50px] rounded-md transition-colors">
                {rootNotes.length === 0 && (
                  <div className="text-[10px] text-zinc-500 dark:text-zinc-700 italic px-2">{t.sidebarLeft.dragDropRoot}</div>
                )}
                {rootNotes.map((note) => (
                  <div
                    key={note.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, note.id)}
                  >
                    {renderEditableItem(
                      note.id,
                      'chat',
                      <>
                        <FileText size={14} className={activeNoteId === note.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'} />
                        <span className={`truncate ${activeNoteId === note.id ? 'text-zinc-900 dark:text-emerald-100' : ''}`}>{note.title}</span>
                      </>,
                      note.title,
                      () => onSelectNote(note.id),
                      () => onDeleteNote(note.id),
                      () => onArchiveNote(note.id),
                      activeNoteId === note.id,
                      null
                    )}
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setViewMode('archive')}
              className="w-full flex items-center gap-2 px-3 py-3 mt-4 text-zinc-600 dark:text-zinc-500 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 rounded-md transition-colors"
            >
              <Archive size={14} />
              <span className="text-xs font-medium">{t.sidebarLeft.archived}</span>
            </button>

            <button
              onClick={() => setViewMode('trash')}
              className="w-full flex items-center gap-2 px-3 py-3 mt-8 text-zinc-600 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 rounded-md transition-colors"
            >
              <Trash2 size={14} />
              <span className="text-xs font-medium">{t.sidebarLeft.trashDeleted}</span>
            </button>
          </div>
        </>
      );
    }

    if (activeWorkspace === 'agents') {
      const activeAgents = agents.filter((agent) => !agent.deletedAt && !agent.archivedAt);
      return (
        <>
          <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">
              {workspaceLabels.agents}
            </span>
            <button
              onClick={onNewAgent}
              className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-white transition-colors"
              title={language === 'es' ? 'Nuevo agente' : 'New agent'}
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {activeAgents.length === 0 && (
              <div className="text-[10px] text-zinc-500 dark:text-zinc-700 italic px-2">
                {language === 'es'
                  ? 'No hay agentes activos. Crea uno nuevo.'
                  : 'No active agents yet. Create a new one.'}
              </div>
            )}
            {activeAgents.map((agent) => (
              <div key={agent.id}>
                {renderEditableItem(
                  agent.id,
                  'chat',
                  <>
                    <Bot size={14} className={activeAgentId === agent.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 dark:text-zinc-600'} />
                    <span className={`truncate ${activeAgentId === agent.id ? 'text-zinc-900 dark:text-indigo-100' : ''}`}>{agent.name}</span>
                  </>,
                  agent.name,
                  () => onSelectAgent(agent.id),
                  () => onDeleteAgent(agent.id),
                  () => onArchiveAgent(agent.id),
                  activeAgentId === agent.id
                )}
              </div>
            ))}

            <button 
              onClick={() => setViewMode('archive')}
              className="w-full flex items-center gap-2 px-3 py-3 mt-4 text-zinc-600 dark:text-zinc-500 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 rounded-md transition-colors"
            >
              <Archive size={14} />
              <span className="text-xs font-medium">{t.sidebarLeft.archived}</span>
            </button>

            <button 
              onClick={() => setViewMode('trash')}
              className="w-full flex items-center gap-2 px-3 py-3 mt-8 text-zinc-600 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 rounded-md transition-colors"
            >
              <Trash2 size={14} />
              <span className="text-xs font-medium">{t.sidebarLeft.trashDeleted}</span>
            </button>
          </div>
        </>
      );
    }

    const activeChats = conversations.filter(c => !c.deletedAt && !c.archivedAt);
    const rootChats = activeChats.filter(c => !c.folderId);

    return (
      <>
         {/* Folder Actions */}
         <div className="px-4 py-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">{t.sidebarLeft.library}</span>
            <div className="flex items-center gap-1">
                <button
                  onClick={onNewChat}
                  className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-white transition-colors"
                  title={t.sidebarLeft.newConversation}
                >
                    <Plus size={14} /> <span className="sr-only">{t.sidebarLeft.newConversation}</span>
                </button>
                <button
                  onClick={() => onCreateFolder(t.sidebarLeft.newFolder)}
                  className="p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-white transition-colors"
                  title={t.sidebarLeft.newFolder}
                >
                    <Folder size={14} /> <span className="sr-only">{t.sidebarLeft.newFolder}</span>
                </button>
            </div>
         </div>

         <div 
            className="flex-1 overflow-y-auto px-2 space-y-1" 
            onDragOver={handleDragOver} 
            onDrop={handleDropOnRoot} // Root Drop Zone
         >
            
            {/* Folders */}
            {folders.map(folder => {
                const folderChats = activeChats.filter(c => c.folderId === folder.id);
                const isCollapsed = collapsedFolders.has(folder.id);
                
                return (
                    <div 
                        key={folder.id} 
                        className="mb-1 transition-colors rounded-lg"
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropOnFolder(e, folder.id)}
                    >
                        {renderEditableItem(
                            folder.id, 
                            'folder',
                            <>
                                {isCollapsed ? <Folder size={14} /> : <FolderOpen size={14} className="text-indigo-500 dark:text-indigo-400" />}
                                <span className="font-medium truncate">{folder.name}</span>
                                <span className="text-[10px] text-zinc-500 dark:text-zinc-600 ml-1">({folderChats.length})</span>
                            </>,
                            folder.name,
                            () => toggleFolder(folder.id),
                            () => setFolderToDelete({ id: folder.id, scope: 'chat' })
                        )}
                        
                        {/* Nested Chats */}
                        {!isCollapsed && (
                            <div className="ml-2 pl-2 border-l border-zinc-200 dark:border-zinc-800/50 space-y-0.5 mt-0.5">
                                {folderChats.map(chat => (
                                    <div 
                                        key={chat.id}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, chat.id)}
                                        className="opacity-90 hover:opacity-100"
                                        onClick={(e) => e.stopPropagation()} // Prevent folder toggle when clicking chat
                                    >
                                        {renderEditableItem(
                                            chat.id,
                                            'chat',
                                            <>
                                                <MessageSquare size={14} className={activeId === chat.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 dark:text-zinc-600'} />
                                                <span className={`truncate ${activeId === chat.id ? 'text-zinc-900 dark:text-indigo-100' : ''}`}>{chat.title}</span>
                                            </>,
                                            chat.title,
                                            () => onSelectConversation(chat.id),
                                            () => onDeleteChat(chat.id),
                                            () => onArchiveChat(chat.id),
                                            activeId === chat.id,
                                            folder.id
                                        )}
                                    </div>
                                ))}
                                {folderChats.length === 0 && (
                                    <div className="text-[10px] text-zinc-500 dark:text-zinc-600 pl-6 py-1 italic">{t.sidebarLeft.emptyFolder}</div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Root Chats */}
            <div className="mt-4">
                <span className="px-2 text-[10px] text-zinc-500 dark:text-zinc-600 uppercase font-bold tracking-wider mb-2 block">{t.sidebarLeft.uncategorized}</span>
                <div className="min-h-[50px] rounded-md transition-colors">
                    {rootChats.length === 0 && (
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-700 italic px-2">{t.sidebarLeft.dragDropRoot}</div>
                    )}
                    {rootChats.map(chat => (
                        <div 
                            key={chat.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, chat.id)}
                        >
                            {renderEditableItem(
                                chat.id,
                                'chat',
                                <>
                                    <MessageSquare size={14} className={activeId === chat.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-400 dark:text-zinc-600'} />
                                    <span className={`truncate ${activeId === chat.id ? 'text-zinc-900 dark:text-indigo-100' : ''}`}>{chat.title}</span>
                                </>,
                                chat.title,
                                () => onSelectConversation(chat.id),
                                () => onDeleteChat(chat.id),
                                () => onArchiveChat(chat.id),
                                activeId === chat.id,
                                null
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Archive Link */}
            <button 
                onClick={() => setViewMode('archive')}
                className="w-full flex items-center gap-2 px-3 py-3 mt-4 text-zinc-600 dark:text-zinc-500 hover:text-cyan-500 dark:hover:text-cyan-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 rounded-md transition-colors"
            >
                <Archive size={14} />
                <span className="text-xs font-medium">{t.sidebarLeft.archived}</span>
            </button>

            {/* Trash Link */}
            <button 
                onClick={() => setViewMode('trash')}
                className="w-full flex items-center gap-2 px-3 py-3 mt-8 text-zinc-600 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/30 rounded-md transition-colors"
            >
                <Trash2 size={14} />
                <span className="text-xs font-medium">{t.sidebarLeft.trashDeleted}</span>
            </button>

         </div>
      </>
    );
  };

  const ArchiveView = () => {
    const archivedChats = conversations.filter(c => !c.deletedAt && c.archivedAt);
    const archivedNotes = notes.filter((note) => !note.deletedAt && note.archivedAt);
    const archivedAgents = agents.filter((agent) => !agent.deletedAt && agent.archivedAt);
    const isAgentsWorkspace = activeWorkspace === 'agents';
    const isNotesWorkspace = activeWorkspace === 'notes';
    const archivedItems = isAgentsWorkspace
      ? archivedAgents.map((agent) => ({
          id: agent.id,
          title: agent.name,
          archivedAt: agent.archivedAt,
        }))
      : isNotesWorkspace
        ? archivedNotes.map((note) => ({
            id: note.id,
            title: note.title,
            archivedAt: note.archivedAt,
          }))
        : archivedChats.map((chat) => ({
            id: chat.id,
            title: chat.title,
            archivedAt: chat.archivedAt,
          }));

    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-cyan-100/40 dark:bg-cyan-900/10">
          <button onClick={() => setViewMode('main')} className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
            <CornerUpLeft size={16} />
          </button>
            <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-400">
            {isAgentsWorkspace
              ? (language === 'es' ? 'Agentes archivados' : 'Archived agents')
              : isNotesWorkspace
                ? (language === 'es' ? 'Notas archivadas' : 'Archived notes')
              : t.sidebarLeft.archiveBin}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {archivedItems.length === 0 && (
            <div className="text-center text-zinc-500 dark:text-zinc-600 text-xs py-10">
              {isAgentsWorkspace
                ? (language === 'es' ? 'No hay agentes archivados' : 'No archived agents')
                : isNotesWorkspace
                  ? (language === 'es' ? 'No hay notas archivadas' : 'No archived notes')
                : t.sidebarLeft.archiveEmpty}
            </div>
          )}
          {archivedItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50 group">
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate w-36">{item.title}</span>
                <span className="text-[10px] text-zinc-500 dark:text-zinc-600">
                  {t.sidebarLeft.archivedAtLabel}: {item.archivedAt ? new Date(item.archivedAt).toLocaleDateString() : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    if (isAgentsWorkspace) onUnarchiveAgent(item.id);
                    else if (isNotesWorkspace) onUnarchiveNote(item.id);
                    else onUnarchiveChat(item.id);
                  }}
                  className="text-[10px] bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-2 py-1 rounded"
                >
                  {t.sidebarLeft.unarchive}
                </button>
                <button 
                  onClick={() => {
                    if (isAgentsWorkspace) onDeleteAgent(item.id);
                    else if (isNotesWorkspace) onDeleteNote(item.id);
                    else onDeleteChat(item.id);
                  }}
                  className="p-1.5 rounded text-zinc-400 dark:text-zinc-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  title={t.common.delete}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const TrashView = () => {
    const deletedChats = conversations.filter(c => c.deletedAt);
    const deletedNotes = notes.filter((note) => note.deletedAt);
    const deletedAgents = agents.filter((agent) => agent.deletedAt);
    const isAgentsWorkspace = activeWorkspace === 'agents';
    const isNotesWorkspace = activeWorkspace === 'notes';
    const deletedItems = isAgentsWorkspace
      ? deletedAgents.map((agent) => ({
          id: agent.id,
          title: agent.name,
          deletedAt: agent.deletedAt,
        }))
      : isNotesWorkspace
        ? deletedNotes.map((note) => ({
            id: note.id,
            title: note.title,
            deletedAt: note.deletedAt,
          }))
        : deletedChats.map((chat) => ({
            id: chat.id,
            title: chat.title,
            deletedAt: chat.deletedAt,
          }));
    
    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedTrashIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedTrashIds(newSet);
    };

    const toggleSelectAll = () => {
        if (selectedTrashIds.size === deletedItems.length) {
            setSelectedTrashIds(new Set());
        } else {
            setSelectedTrashIds(new Set(deletedItems.map((item) => item.id)));
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-red-100/50 dark:bg-red-900/10">
                <button onClick={() => setViewMode('main')} className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
                    <CornerUpLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-red-600 dark:text-red-400">{t.sidebarLeft.trashBin}</span>
            </div>

            <div className="p-2 border-b border-border flex justify-between items-center">
                <button onClick={toggleSelectAll} className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white px-2">
                    {selectedTrashIds.size === deletedItems.length && deletedItems.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                    {t.sidebarLeft.selectAll}
                </button>
                {selectedTrashIds.size > 0 && (
                     <button 
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-xs text-red-600 dark:text-red-400 hover:text-red-500 font-medium px-2 py-1 bg-red-100 dark:bg-red-900/20 rounded"
                    >
                        {t.common.delete} ({selectedTrashIds.size})
                    </button>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {deletedItems.length === 0 && (
                    <div className="text-center text-zinc-500 dark:text-zinc-600 text-xs py-10">
                      {isAgentsWorkspace
                        ? (language === 'es' ? 'La papelera de agentes está vacía' : 'Agent trash is empty')
                        : isNotesWorkspace
                          ? (language === 'es' ? 'La papelera de notas está vacía' : 'Note trash is empty')
                        : t.sidebarLeft.trashEmpty}
                    </div>
                )}
                {deletedItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800/50 group">
                        <div className="flex items-center gap-2 overflow-hidden">
                            <button onClick={() => toggleSelect(item.id)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-800 dark:hover:text-white">
                                {selectedTrashIds.has(item.id) ? <CheckSquare size={14} className="text-indigo-500" /> : <Square size={14} />}
                            </button>
                            <div className="flex flex-col">
                                <span className="text-sm text-zinc-700 dark:text-zinc-400 truncate w-32">{item.title}</span>
                                <span className="text-[10px] text-zinc-500 dark:text-zinc-600">
                                    {language === 'es' ? 'Eliminado' : 'Deleted'}: {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString() : ''}
                                </span>
                            </div>
                        </div>
                        <button 
                            onClick={() => {
                              if (isAgentsWorkspace) onRestoreAgent(item.id);
                              else if (isNotesWorkspace) onRestoreNote(item.id);
                              else onRestoreChat(item.id);
                            }}
                            className="text-[10px] bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 px-2 py-1 rounded"
                        >
                            {t.common.restore}
                        </button>
                    </div>
                ))}
            </div>
             
             <div className="p-3 text-[10px] text-zinc-500 dark:text-zinc-600 text-center border-t border-border">
                {t.sidebarLeft.itemsDeletedForever}
             </div>
        </div>
    );
  };

  return (
      <div className="flex flex-col h-full bg-surface relative">
      {/* Top Bar with Toggle */}
      <div className="flex items-center px-4 py-3 border-b border-border/50">
        <div className="w-[30px] h-[30px] shrink-0" aria-hidden="true" />
        <h2 className="text-sm font-bold text-zinc-800 dark:text-zinc-200 tracking-tight flex-1 text-center">optimAIzer</h2>
        <button 
          onClick={onClose}
          className="p-1.5 w-[30px] h-[30px] flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors shrink-0"
        >
          <Menu size={18} />
        </button>
      </div>

      {viewMode === 'main' && (
        <div className="px-4 pb-2 mt-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-zinc-100/70 dark:bg-zinc-900/60 p-1">
            <button
              onClick={() => onChangeWorkspace('chat')}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                activeWorkspace === 'chat'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
              }`}
            >
              <MessageSquare size={12} />
              {workspaceLabels.chat}
            </button>
            <button
              onClick={() => onChangeWorkspace('notes')}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                activeWorkspace === 'notes'
                  ? 'bg-emerald-50 dark:bg-emerald-900/25 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
              }`}
            >
              <FileText size={12} className={activeWorkspace === 'notes' ? 'text-emerald-600 dark:text-emerald-300' : ''} />
              {workspaceLabels.notes}
            </button>
            <button
              onClick={() => onChangeWorkspace('agents')}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors ${
                activeWorkspace === 'agents'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
              }`}
            >
              <Bot size={12} />
              {workspaceLabels.agents}
            </button>
          </div>
        </div>
      )}

      {/* Main List Area */}
      {viewMode === 'main' && <MainView />}
      {viewMode === 'archive' && <ArchiveView />}
      {viewMode === 'trash' && <TrashView />}

      {/* Footer / User Settings */}
      <div className="p-4 border-t border-border mt-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-3 flex-1 p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg">
               <User size={16} />
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-medium text-zinc-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors">{userName}</p>
              <p className="text-xs text-zinc-500">{t.sidebarLeft.freePlan}</p>
            </div>
            <Settings size={16} className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-800 dark:group-hover:text-white transition-colors" />
          </button>
          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
            className="p-2 rounded-lg border border-red-200/70 dark:border-red-900/50 text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            title={language === 'es' ? 'Cerrar sesión' : 'Sign out'}
            aria-label={language === 'es' ? 'Cerrar sesión' : 'Sign out'}
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
            if (activeWorkspace === 'agents') {
              onPermanentDeleteAgent(Array.from(selectedTrashIds));
            } else if (activeWorkspace === 'notes') {
              onPermanentDeleteNote(Array.from(selectedTrashIds));
            } else {
              onPermanentDeleteChat(Array.from(selectedTrashIds));
            }
            setSelectedTrashIds(new Set());
            setShowDeleteConfirm(false);
        }}
        title={
          activeWorkspace === 'agents'
            ? (language === 'es' ? '¿Eliminar agentes para siempre?' : 'Delete agents forever?')
            : activeWorkspace === 'notes'
              ? (language === 'es' ? '¿Eliminar notas para siempre?' : 'Delete notes forever?')
            : t.sidebarLeft.deleteForeverTitle
        }
        message={
          activeWorkspace === 'agents'
            ? (language === 'es'
              ? 'Estos agentes se eliminarán permanentemente. Esta acción no se puede deshacer.'
              : 'These agents will be permanently removed. This action cannot be undone.')
            : activeWorkspace === 'notes'
              ? (language === 'es'
                ? 'Estas notas se eliminarán permanentemente. Esta acción no se puede deshacer.'
                : 'These notes will be permanently removed. This action cannot be undone.')
            : t.sidebarLeft.deleteForeverMsg
        }
        confirmText={activeWorkspace === 'agents' || activeWorkspace === 'notes' ? t.common.delete : t.sidebarLeft.deleteForeverBtn}
        cancelText={t.common.cancel}
        isDestructive={true}
      />

      {/* Folder Deletion Confirmation */}
      <ConfirmationModal
        isOpen={!!folderToDelete}
        onClose={() => setFolderToDelete(null)}
        onConfirm={() => {
            if (!folderToDelete) return;
            if (folderToDelete.scope === 'notes') onDeleteNoteFolder(folderToDelete.id);
            else onDeleteFolder(folderToDelete.id);
            setFolderToDelete(null);
        }}
        title={
          folderToDelete?.scope === 'notes'
            ? (language === 'es' ? 'Eliminar carpeta de notas' : 'Delete notes folder')
            : t.sidebarLeft.deleteFolderTitle
        }
        message={
          folderToDelete?.scope === 'notes'
            ? (language === 'es'
              ? '¿Seguro? La carpeta se eliminará y las notas pasarán a Sin categoría.'
              : 'Are you sure? The folder will be removed and notes will be moved to Uncategorized.')
            : t.sidebarLeft.deleteFolderMsg
        }
        confirmText={folderToDelete?.scope === 'notes' ? t.common.delete : t.sidebarLeft.deleteFolderBtn}
        cancelText={t.common.cancel}
        isDestructive={true}
      />

      <ConfirmationModal
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          onLogout();
        }}
        title={language === 'es' ? '¿Cerrar sesión?' : 'Sign out?'}
        message={
          language === 'es'
            ? 'Se cerrará la sesión actual en este dispositivo.'
            : 'Your current session will be closed on this device.'
        }
        confirmText={language === 'es' ? 'Sí, cerrar sesión' : 'Yes, sign out'}
        cancelText={t.common.cancel}
        isDestructive={true}
      />
    </div>
  );
};
