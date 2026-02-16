// ---------------------------------------------------------------------------
// Telegram Bot Service — Minimal Telegram Bot API client using fetch
// ---------------------------------------------------------------------------

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramInboundMessage;
  edited_message?: TelegramInboundMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
  chat_instance: string;
  data?: string;
}

interface TelegramInboundMessage {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
    chat: { id: number; type: string };
    date: number;
    text?: string;
    caption?: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
    reply_to_message?: {
      from?: { id: number; username?: string; is_bot?: boolean };
    };
    document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
    photo?: Array<{ file_id: string; width: number; height: number; file_size?: number }>;
    voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
    audio?: { file_id: string; duration: number; mime_type?: string; file_size?: number; title?: string; performer?: string; file_name?: string };
    location?: { latitude: number; longitude: number; live_period?: number };
    forward_from?: { id: number; first_name?: string; username?: string };
    forward_date?: number;
}

export interface TelegramFileInfo {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
  type: 'document' | 'photo' | 'voice' | 'audio';
  duration?: number;
}

export interface TelegramLocationInfo {
  latitude: number;
  longitude: number;
  live_period?: number;
}

export interface TelegramBotService {
  start(): void;
  stop(): void;
  sendMessage(chatId: string, text: string, parseMode?: string): Promise<boolean>;
  sendMessageWithButtons(chatId: string, text: string, buttons: Array<Array<{ text: string; callback_data: string }>>, parseMode?: string): Promise<boolean>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
  onMessage(handler: (chatId: string, text: string, fromUser: string, file?: TelegramFileInfo, location?: TelegramLocationInfo) => void): void;
  onCallbackQuery(handler: (chatId: string, data: string, queryId: string, fromUser: string, originalMessage?: string) => void): void;
  getFileUrl(fileId: string): Promise<string | null>;
  downloadFile(fileId: string): Promise<{ data: Buffer; mimeType: string; fileName: string } | null>;
  isRunning(): boolean;
}

export const getTelegramApiBaseUrl = (): string =>
  (process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org').replace(/\/+$/, '');

export const getTelegramBotBaseUrl = (botToken: string): string =>
  `${getTelegramApiBaseUrl()}/bot${botToken}`;

export function createTelegramBot(botToken: string, authorizedChatId: string): TelegramBotService {
  const baseUrl = getTelegramBotBaseUrl(botToken);
  const normalizedAuthorizedChatId = String(authorizedChatId).trim();
  let running = false;
  let lastUpdateId = 0;
  let pollTimeout: ReturnType<typeof setTimeout> | null = null;
  let messageHandler: ((chatId: string, text: string, fromUser: string, file?: TelegramFileInfo, location?: TelegramLocationInfo) => void) | null = null;
  let callbackHandler: ((chatId: string, data: string, queryId: string, fromUser: string, originalMessage?: string) => void) | null = null;
  let abortController: AbortController | null = null;
  let botUsername = '';
  let canReadAllGroupMessages = false;

  async function callTelegramApi(method: string, body?: Record<string, any>): Promise<any> {
    try {
      const response = await fetch(`${baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      return data;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error(`[Telegram] API error (${method}):`, error.message);
      }
      return { ok: false, error: error.message };
    }
  }

  /**
   * Convert standard Markdown to Telegram-compatible Markdown.
   * Telegram Markdown (legacy) supports: *bold*, _italic_, `code`, ```pre```.
   * It does NOT support: ## headings, [links](url) partially, **bold**, tables, etc.
   */
  function convertToTelegramMarkdown(text: string): string {
    let result = text;
    // Convert **bold** to *bold* (Telegram uses single asterisk)
    result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');
    // Convert ### Heading, ## Heading, # Heading to *Heading* (bold)
    result = result.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
    // Convert horizontal rules --- or *** to a separator
    result = result.replace(/^([-*_]){3,}\s*$/gm, '———');
    // Convert > blockquotes (not supported in legacy Markdown)
    result = result.replace(/^>\s+(.+)$/gm, '│ $1');
    // Convert image syntax ![alt](url) to just the URL
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$2');
    // Keep [text](url) links as-is — Telegram Markdown partially supports them
    // Convert bullet points with * to •
    result = result.replace(/^(\s*)\*\s+/gm, '$1• ');
    // Remove excessive blank lines (max 2 consecutive)
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  async function sendMessage(chatId: string, text: string, parseMode: string = 'Markdown'): Promise<boolean> {
    // Convert to Telegram-compatible Markdown
    const formattedText = parseMode === 'Markdown' ? convertToTelegramMarkdown(text) : text;
    // Split long messages (Telegram limit: 4096 chars)
    const maxLen = 4000;
    const chunks: string[] = [];
    let remaining = formattedText;

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Find a good split point
      let splitAt = remaining.lastIndexOf('\n', maxLen);
      if (splitAt < maxLen * 0.5) splitAt = maxLen;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt);
    }

    let allOk = true;
    for (const chunk of chunks) {
      const result = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: chunk,
        parse_mode: parseMode,
      });
      if (!result.ok) {
        // Retry without parse mode if Markdown failed
        const retry = await callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: chunk,
        });
        if (!retry.ok) {
          console.error(`[Telegram] Failed to send message:`, retry.description || retry.error);
          allOk = false;
        }
      }
    }
    return allOk;
  }

  async function sendMessageWithButtons(
    chatId: string,
    text: string,
    buttons: Array<Array<{ text: string; callback_data: string }>>,
    parseMode: string = 'Markdown'
  ): Promise<boolean> {
    const formattedText = parseMode === 'Markdown' ? convertToTelegramMarkdown(text) : text;
    const result = await callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: formattedText,
      parse_mode: parseMode,
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
    if (!result.ok) {
      // Retry without parse mode
      const retry = await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: formattedText,
        reply_markup: {
          inline_keyboard: buttons,
        },
      });
      if (!retry.ok) {
        console.error(`[Telegram] Failed to send message with buttons:`, retry.description || retry.error);
        return false;
      }
    }
    return true;
  }

  async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await callTelegramApi('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text: text || '',
    });
  }

  async function getUpdates(): Promise<TelegramUpdate[]> {
    try {
      const result = await callTelegramApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 25,
          allowed_updates: ['message', 'callback_query'],
      });
      if (result.ok && Array.isArray(result.result)) {
        return result.result as TelegramUpdate[];
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[Telegram] Polling error:', error.message);
      }
    }
    return [];
  }

  async function initializeBotSession(): Promise<void> {
    const meResult = await callTelegramApi('getMe');
    if (meResult?.ok) {
      botUsername = String(meResult.result?.username || '').trim();
      canReadAllGroupMessages = Boolean(meResult.result?.can_read_all_group_messages);
    }

    const deleteWebhookResult = await callTelegramApi('deleteWebhook', { drop_pending_updates: false });
    if (!deleteWebhookResult?.ok) {
      console.warn('[Telegram] Could not delete webhook. getUpdates may fail:', deleteWebhookResult?.description || deleteWebhookResult?.error);
    }
  }

  const isAddressedToBot = (text: string, message: TelegramInboundMessage): boolean => {
    const loweredText = text.toLowerCase();
    const lowerBotUsername = botUsername.toLowerCase();
    if (message.reply_to_message?.from?.is_bot && (!botUsername || message.reply_to_message.from.username?.toLowerCase() === lowerBotUsername)) {
      return true;
    }
    if (text.startsWith('/')) {
      if (!botUsername) return true;
      const commandMention = text.split(/\s+/)[0];
      return !commandMention.includes('@') || commandMention.toLowerCase().includes(`@${lowerBotUsername}`);
    }
    if (!botUsername) return true;
    return loweredText.includes(`@${lowerBotUsername}`);
  };

  const normalizeInboundText = (text: string): string => {
    if (!text) return '';
    if (!botUsername) return text.trim();
    const escapedUsername = botUsername.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`@${escapedUsername}`, 'ig'), '').trim();
  };

  async function pollLoop(): Promise<void> {
    if (!running) return;

    try {
      const updates = await getUpdates();
      
      for (const update of updates) {
        lastUpdateId = Math.max(lastUpdateId, update.update_id);

        // Handle callback queries (button presses)
        if (update.callback_query) {
          const cbq = update.callback_query;
          const chatId = cbq.message?.chat ? String(cbq.message.chat.id).trim() : '';
          const fromUser = cbq.from?.first_name || cbq.from?.username || 'Unknown';
          const data = cbq.data || '';

          if (chatId === normalizedAuthorizedChatId && data && callbackHandler) {
            console.log(`[Telegram] Callback from ${fromUser}: ${data.slice(0, 50)}`);
            await answerCallbackQuery(cbq.id, '✓');
            try {
              callbackHandler(chatId, data, cbq.id, fromUser, cbq.message?.text);
            } catch (error: any) {
              console.error('[Telegram] Callback handler error:', error.message);
            }
          } else if (chatId && chatId !== normalizedAuthorizedChatId) {
            await answerCallbackQuery(cbq.id, '⛔ No autorizado');
          }
          continue;
        }

        // Ignore edited_message updates to prevent duplicate processing when users
        // edit recently sent messages.
        const inbound = update.message;
        if (!inbound?.chat) {
          continue;
        }

        // Handle forwarded messages with context
        const forwardPrefix = inbound.forward_from || inbound.forward_date
          ? '[Mensaje reenviado] '
          : '';

        // Extract file info if present
        let fileInfo: TelegramFileInfo | undefined;
        if (inbound.document) {
          fileInfo = {
            file_id: inbound.document.file_id,
            file_name: inbound.document.file_name,
            mime_type: inbound.document.mime_type,
            file_size: inbound.document.file_size,
            type: 'document',
          };
        } else if (inbound.photo && inbound.photo.length > 0) {
          // Pick the largest photo (last in array)
          const largest = inbound.photo[inbound.photo.length - 1];
          fileInfo = {
            file_id: largest.file_id,
            file_size: largest.file_size,
            mime_type: 'image/jpeg',
            type: 'photo',
          };
        } else if (inbound.voice) {
          fileInfo = {
            file_id: inbound.voice.file_id,
            mime_type: inbound.voice.mime_type || 'audio/ogg',
            file_size: inbound.voice.file_size,
            type: 'voice',
            duration: inbound.voice.duration,
          };
        } else if (inbound.audio) {
          fileInfo = {
            file_id: inbound.audio.file_id,
            file_name: inbound.audio.file_name || inbound.audio.title,
            mime_type: inbound.audio.mime_type || 'audio/mpeg',
            file_size: inbound.audio.file_size,
            type: 'audio',
            duration: inbound.audio.duration,
          };
        }

        // Extract location info if present
        let locationInfo: TelegramLocationInfo | undefined;
        if (inbound.location) {
          locationInfo = {
            latitude: inbound.location.latitude,
            longitude: inbound.location.longitude,
            live_period: inbound.location.live_period,
          };
        }

        const text = String(inbound.text || inbound.caption || '').trim();
        // Allow messages with files or locations even without text
        if (!text && !fileInfo && !locationInfo) {
          continue;
        }

        const chatId = String(inbound.chat.id).trim();
        const fromUser = inbound.from?.first_name || inbound.from?.username || 'Unknown';
        const isGroupChat = inbound.chat.type === 'group' || inbound.chat.type === 'supergroup';
        const requireAddressing = isGroupChat && !canReadAllGroupMessages;

        // Security: only process messages from authorized chat
        if (chatId === normalizedAuthorizedChatId) {
          if (text && requireAddressing && !isAddressedToBot(text, inbound)) {
            continue;
          }

          const normalizedText = normalizeInboundText(text);
          // Build the full text with context about attached files/location
          let fullText = `${forwardPrefix}${normalizedText || ''}`;
          if (fileInfo) {
            let fileDesc: string;
            if (fileInfo.type === 'photo') {
              fileDesc = `[📷 Foto adjunta (file_id: ${fileInfo.file_id})]`;
            } else if (fileInfo.type === 'voice') {
              fileDesc = `[🎤 Nota de voz adjunta (duración: ${fileInfo.duration || '?'}s, file_id: ${fileInfo.file_id})]`;
            } else if (fileInfo.type === 'audio') {
              fileDesc = `[🎵 Audio adjunto: ${fileInfo.file_name || 'audio'} (duración: ${fileInfo.duration || '?'}s, ${fileInfo.mime_type || 'audio'}, file_id: ${fileInfo.file_id})]`;
            } else {
              fileDesc = `[📎 Documento adjunto: ${fileInfo.file_name || 'archivo'} (${fileInfo.mime_type || 'desconocido'}, file_id: ${fileInfo.file_id})]`;
            }
            fullText = fullText ? `${fullText}\n${fileDesc}` : fileDesc;
          }
          if (locationInfo) {
            fullText = fullText
              ? `${fullText}\n[📍 Ubicación compartida: lat=${locationInfo.latitude}, lng=${locationInfo.longitude}]`
              : `[📍 Ubicación compartida: lat=${locationInfo.latitude}, lng=${locationInfo.longitude}]`;
          }
          if (!fullText.trim()) continue;
          console.log(`[Telegram] Message from ${fromUser}: ${fullText.slice(0, 80)}...`);
          if (messageHandler) {
            try {
              messageHandler(chatId, fullText, fromUser, fileInfo, locationInfo);
            } catch (error: any) {
              console.error('[Telegram] Handler error:', error.message);
            }
          }
        } else {
          console.warn(`[Telegram] Unauthorized message from chat ${chatId} (authorized: ${normalizedAuthorizedChatId})`);
          await sendMessage(chatId, '⛔ No estás autorizado para usar este bot.');
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[Telegram] Poll error:', error.message);
      }
    }

    // Schedule next poll
      if (running) {
        pollTimeout = setTimeout(() => pollLoop(), 1000);
      }
  }

  return {
    start() {
      if (running) return;
      running = true;
      abortController = new AbortController();
      console.log(`[Telegram] Bot started, polling for updates (authorized chat: ${normalizedAuthorizedChatId})`);
      void (async () => {
        await initializeBotSession();
        const groupHint = canReadAllGroupMessages
          ? ''
          : '\n\nℹ️ Si este bot está en un grupo, puede necesitar @mención o comando. En BotFather desactiva Privacy Mode para leer todos los mensajes.';
        sendMessage(normalizedAuthorizedChatId, `🤖 ¡Agente conectado y listo! Escríbeme lo que necesites.${groupHint}`).catch(() => {});
        pollLoop();
      })();
    },

    stop() {
      running = false;
      if (pollTimeout) {
        clearTimeout(pollTimeout);
        pollTimeout = null;
      }
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      console.log('[Telegram] Bot stopped');
    },

    sendMessage,

    sendMessageWithButtons,

    answerCallbackQuery,

    onMessage(handler) {
      messageHandler = handler;
    },

    onCallbackQuery(handler) {
      callbackHandler = handler;
    },

    async getFileUrl(fileId: string): Promise<string | null> {
      try {
        const result = await callTelegramApi('getFile', { file_id: fileId });
        if (result.ok && result.result?.file_path) {
          return `${getTelegramApiBaseUrl()}/file/bot${botToken}/${result.result.file_path}`;
        }
        return null;
      } catch (error: any) {
        console.error('[Telegram] getFile error:', error.message);
        return null;
      }
    },

    async downloadFile(fileId: string): Promise<{ data: Buffer; mimeType: string; fileName: string } | null> {
      try {
        const result = await callTelegramApi('getFile', { file_id: fileId });
        if (!result.ok || !result.result?.file_path) {
          console.error('[Telegram] getFile failed:', result.description || 'unknown error');
          return null;
        }
        const filePath = result.result.file_path as string;
        const fileUrl = `${getTelegramApiBaseUrl()}/file/bot${botToken}/${filePath}`;
        const response = await fetch(fileUrl, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) {
          console.error('[Telegram] Download failed:', response.status);
          return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        const data = Buffer.from(arrayBuffer);
        const fileName = filePath.split('/').pop() || 'file';
        const mimeType = response.headers.get('content-type') || 'application/octet-stream';
        return { data, mimeType, fileName };
      } catch (error: any) {
        console.error('[Telegram] downloadFile error:', error.message);
        return null;
      }
    },

    isRunning() {
      return running;
    },
  };
}
