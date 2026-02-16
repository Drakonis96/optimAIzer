import { Message, Conversation } from '../types';

/**
 * Formats a timestamp into a readable string
 */
const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleString();
};

const getAssistantModelTag = (msg: Message): string | null => {
  if (msg.role !== 'assistant' || !msg.provider) return null;
  const model = (msg.model || '').trim();
  return model ? `${msg.provider} • ${model}` : msg.provider;
};

/**
 * Generates the content for Markdown export
 */
export const generateMarkdown = (conversation: Conversation, messages: Message[], userName: string): string => {
  let md = `# ${conversation.title}\n`;
  md += `**Date:** ${formatTime(conversation.updatedAt)}\n`;
  md += `**Exported by:** ${userName}\n\n`;
  md += `---\n\n`;

  messages.forEach(msg => {
    const roleName = msg.role === 'user' ? userName : 'optimAIzer';
    const modelTag = getAssistantModelTag(msg);
    const metaInfo = modelTag ? ` [${modelTag}]` : '';
    
    md += `### ${roleName}${metaInfo} - ${formatTime(msg.timestamp)}\n\n`;
    
    if (msg.quote) {
      md += `> **Replying to ${msg.quote.role}:** ${msg.quote.content}\n\n`;
    }

    md += `${msg.content}\n\n`;
    md += `---\n\n`;
  });

  return md;
};

/**
 * Generates a self-contained HTML file string
 */
export const generateHTML = (conversation: Conversation, messages: Message[], userName: string): string => {
  const styles = `
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    .header { border-bottom: 2px solid #eaeaea; padding-bottom: 20px; margin-bottom: 30px; }
    .meta { color: #666; font-size: 0.9em; }
    .message { margin-bottom: 30px; border-bottom: 1px solid #f0f0f0; padding-bottom: 20px; }
    .message-header { display: flex; justify-content: space-between; margin-bottom: 10px; font-weight: bold; }
    .role-user { color: #4f46e5; }
    .role-ai { color: #059669; }
    .timestamp { font-weight: normal; color: #999; font-size: 0.8em; }
    .model-tag { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-size: 0.8em; color: #555; margin-left: 8px; font-weight: normal; }
    .quote { background: #f9fafb; border-left: 3px solid #d1d5db; padding: 10px; margin-bottom: 10px; font-size: 0.9em; color: #555; }
    .content { white-space: pre-wrap; }
  `;

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${conversation.title}</title>
<style>${styles}</style>
</head>
<body>
  <div class="header">
    <h1>${conversation.title}</h1>
    <div class="meta">Date: ${formatTime(conversation.updatedAt)}</div>
    <div class="meta">User: ${userName}</div>
  </div>
`;

  messages.forEach(msg => {
    const isUser = msg.role === 'user';
    const roleClass = isUser ? 'role-user' : 'role-ai';
    const roleName = isUser ? userName : 'optimAIzer';
    const assistantTag = getAssistantModelTag(msg);
    const modelTag = assistantTag ? `<span class="model-tag">${assistantTag}</span>` : '';
    
    html += `
    <div class="message">
      <div class="message-header">
        <span class="${roleClass}">${roleName}${modelTag}</span>
        <span class="timestamp">${formatTime(msg.timestamp)}</span>
      </div>
      ${msg.quote ? `<div class="quote"><strong>Replying to ${msg.quote.role}:</strong> ${msg.quote.content}</div>` : ''}
      <div class="content">${msg.content}</div>
    </div>`;
  });

  html += `</body></html>`;
  return html;
};

/**
 * Triggers a file download in the browser
 */
export const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Opens a print window to save as PDF
 */
export const printToPDF = (conversation: Conversation, messages: Message[], userName: string) => {
  const htmlContent = generateHTML(conversation, messages, userName);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
    // Wait for content to load then print
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
  }
};
