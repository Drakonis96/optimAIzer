import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeAgentWorkspaceState } from '../components/AgentsWorkspace';

test('sanitizeAgentWorkspaceState preserves calendar and MCP connector config', () => {
  const workspace = {
    activeAgentId: 'agent-1',
    agents: [
      {
        id: 'agent-1',
        name: 'Agent 1',
        objective: 'test',
        status: 'draft',
        systemPrompt: 'prompt',
        permissions: {
          sandboxMode: true,
          internetAccess: true,
          notesAccess: true,
          schedulerAccess: true,
          terminalAccess: false,
          codeExecution: false,
          allowedWebsites: [],
          headlessBrowser: true,
          webCredentials: [],
          requireApprovalForNewSites: true,
        },
        integrations: {
          telegram: {
            botToken: 'bot-token-123',
            chatId: '123456',
            tutorialStep: 1,
            verified: true,
          },
          mcpServers: [
            {
              id: 'slack',
              enabled: true,
              config: {
                botToken: 'xoxb-secret',
              },
            },
          ],
          calendar: {
            google: {
              clientId: 'google-client-id',
              clientSecret: 'google-client-secret',
              refreshToken: '1//google-refresh-token',
              calendarId: 'primary',
            },
            icloud: {
              email: 'user@example.com',
              appSpecificPassword: 'abcd-efgh-ijkl-mnop',
              calendarName: 'Home',
            },
          },
        },
        schedules: [],
        setupProvider: 'openai',
        setupModel: 'gpt-5.2',
        setupSystemPromptId: '',
        setupMaxTokens: 700,
        setupTemperature: 0.3,
        chatMode: 'config',
        setupChat: [{ id: 'm1', role: 'assistant', content: 'ok', timestamp: Date.now() }],
        telegramTestChat: [{ id: 'm2', role: 'assistant', content: 'ok', timestamp: Date.now() }],
        trainingMemory: [],
        platformCompatibility: { macos: true, windows: true },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
  };

  const sanitized = sanitizeAgentWorkspaceState(workspace, 'es');
  const agent = sanitized.agents[0];

  assert.equal(agent.integrations.mcpServers.length, 1);
  assert.equal(agent.integrations.mcpServers[0].config.botToken, 'xoxb-secret');

  assert.ok(agent.integrations.calendar);
  assert.equal(agent.integrations.calendar?.google?.clientId, 'google-client-id');
  assert.equal(agent.integrations.calendar?.google?.clientSecret, 'google-client-secret');
  assert.equal(agent.integrations.calendar?.google?.refreshToken, '1//google-refresh-token');
  assert.equal(agent.integrations.calendar?.google?.calendarId, 'primary');
  assert.equal(agent.integrations.calendar?.icloud?.email, 'user@example.com');
  assert.equal(agent.integrations.calendar?.icloud?.appSpecificPassword, 'abcdefghijklmnop');
  assert.equal(agent.integrations.calendar?.icloud?.calendarName, 'Home');
});
