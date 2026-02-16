import { WorkspaceView } from '../types';

export const NOTES_PREVIEW_CONTENT_EDITABLE = false;

const WORKSPACE_VIEWS: WorkspaceView[] = ['chat', 'notes', 'agents'];

export const resolveStartupWorkspace = (persistedWorkspace: unknown): WorkspaceView =>
	typeof persistedWorkspace === 'string' && WORKSPACE_VIEWS.includes(persistedWorkspace as WorkspaceView)
		? (persistedWorkspace as WorkspaceView)
		: 'chat';
