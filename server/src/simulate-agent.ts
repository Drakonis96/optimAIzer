#!/usr/bin/env tsx
// ---------------------------------------------------------------------------
// Agent Simulation Script
// Simulates an agent using OpenRouter (cheap model) to test:
//   1. Creating a note
//   2. Creating a list
//   3. Scheduling a task
//   4. Responding to the user (send_telegram_message mock)
// ---------------------------------------------------------------------------

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { processAgentMessage, EngineCallbacks } from './agents/engine';
import { AgentConfig, AgentMessage } from './agents/types';
import { ToolExecutionContext } from './agents/tools';
import { initDatabase } from './database';

// Initialize the database (needed for storage operations)
initDatabase();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'sim-test-user';
const TEST_AGENT_ID = 'sim-test-agent-' + Date.now();
const MODEL = 'google/gemini-2.5-flash-lite'; // cheap paid model, no rate limit issues

const agentConfig: AgentConfig = {
  id: TEST_AGENT_ID,
  name: 'SimBot',
  objective: 'Asistente personal de prueba para verificar herramientas',
  systemPrompt: 'Eres SimBot, un asistente personal eficiente. Cuando el usuario te pide algo, usa las herramientas disponibles inmediatamente. Responde siempre en español.',
  provider: 'openrouter',
  model: MODEL,
  permissions: {
    internetAccess: true,
    headlessBrowser: false,
    notesAccess: true,
    schedulerAccess: true,
    calendarAccess: true,
    gmailAccess: true,
    mediaAccess: true,
    terminalAccess: false,
    codeExecution: false,
    allowedWebsites: [],
    requireApprovalForNewSites: false,
    webCredentials: [],
  },
  telegram: {
    botToken: 'MOCK_TOKEN',
    chatId: 'MOCK_CHAT_ID',
  },
  schedules: [],
  mcpServers: [],
  memory: [],
  temperature: 0.2,
  maxTokens: 1024,
};

// ---------------------------------------------------------------------------
// Mock context & callbacks
// ---------------------------------------------------------------------------

const telegramMessages: string[] = [];
const scheduledTasks: Array<{ id: string; name: string; cron: string; instruction: string }> = [];
const memories: string[] = [];

function buildToolContext(): ToolExecutionContext {
  return {
    agentConfig,
    userId: TEST_USER_ID,
    agentId: TEST_AGENT_ID,
    sendTelegramMessage: async (message: string) => {
      console.log('\n📱 [TELEGRAM MOCK] Mensaje enviado:');
      console.log('─'.repeat(50));
      console.log(message);
      console.log('─'.repeat(50));
      telegramMessages.push(message);
      return true;
    },
    addMemory: (info: string) => {
      memories.push(info);
      console.log(`🧠 [MEMORY] Guardado: "${info}"`);
    },
    addSchedule: (params) => {
      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      scheduledTasks.push({
        id: taskId,
        name: params.name,
        cron: params.cron,
        instruction: params.instruction,
      });
      console.log(`⏰ [SCHEDULER] Tarea programada: "${params.name}" (cron: ${params.cron})`);
      return taskId;
    },
    removeSchedule: (taskId: string) => {
      const idx = scheduledTasks.findIndex(t => t.id === taskId);
      if (idx >= 0) {
        scheduledTasks.splice(idx, 1);
        return true;
      }
      return false;
    },
    toggleSchedule: (taskId: string, enabled: boolean) => {
      const task = scheduledTasks.find(t => t.id === taskId);
      if (task) {
        console.log(`⏰ [SCHEDULER] Tarea "${task.name}" ${enabled ? 'activada' : 'desactivada'}`);
        return true;
      }
      return false;
    },
    recordUsageEvent: (event) => {
      console.log(`📊 [USAGE] ${event.provider}/${event.model} — input: ${event.inputTokens}, output: ${event.outputTokens}`);
    },
    recordResourceEvent: (event) => {
      console.log(`📦 [RESOURCE] ${event.type}${event.metadata ? ` — ${JSON.stringify(event.metadata)}` : ''}`);
    },
  };
}

function buildCallbacks(label: string): EngineCallbacks {
  return {
    onResponse: (text: string) => {
      console.log(`\n✅ [${label}] Respuesta final del agente:`);
      console.log('═'.repeat(60));
      console.log(text || '(vacía)');
      console.log('═'.repeat(60));
    },
    onToolCall: (toolName: string, params: Record<string, any>) => {
      console.log(`\n🔧 [${label}] Tool call: ${toolName}(${JSON.stringify(params)})`);
    },
    onToolResult: (result) => {
      const status = result.success ? '✅' : '❌';
      const preview = result.result.length > 200 ? result.result.slice(0, 200) + '...' : result.result;
      console.log(`   ${status} Resultado: ${preview}`);
      if (result.error) console.log(`   ❌ Error: ${result.error}`);
    },
    onError: (error: string) => {
      console.error(`\n💥 [${label}] Error: ${error}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Simulation Scenarios
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runScenarioWithRetry(
  label: string,
  userMessage: string,
  history: AgentMessage[],
  maxRetries = 3
): Promise<AgentMessage[]> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log('\n' + '🔷'.repeat(30));
    console.log(`\n🎬 ESCENARIO: ${label}${attempt > 1 ? ` (intento ${attempt}/${maxRetries})` : ''}`);
    console.log(`👤 Usuario dice: "${userMessage}"`);
    console.log('');

    const context = buildToolContext();
    const callbacks = buildCallbacks(label);

    try {
      const result = await processAgentMessage(
        agentConfig,
        userMessage,
        history,
        context,
        callbacks,
        'user'
      );

      // Check if it was an error response (rate limit, etc.)
      if (result.response.includes('429') || result.response.includes('rate') || result.response.includes('Rate limit')) {
        console.log(`\n⏳ Rate limited, esperando 15s antes de reintentar...`);
        await delay(15000);
        continue;
      }

      return result.updatedHistory;
    } catch (error: any) {
      const msg = error.message || '';
      if ((msg.includes('429') || msg.includes('rate')) && attempt < maxRetries) {
        console.log(`\n⏳ Rate limited (${msg.slice(0, 80)}...), esperando 15s...`);
        await delay(15000);
        continue;
      }
      console.error(`💥 Error fatal en escenario "${label}": ${error.message}`);
      console.error(error.stack);
      return history;
    }
  }
  console.error(`💥 Max reintentos alcanzados para "${label}"`);
  return history;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     SIMULACIÓN DE AGENTE CON OPENROUTER (MODELO FREE)    ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log(`║ Modelo: ${MODEL.padEnd(49)}║`);
  console.log(`║ Usuario: ${TEST_USER_ID.padEnd(48)}║`);
  console.log(`║ Agente: ${TEST_AGENT_ID.slice(0, 48).padEnd(49)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  let history: AgentMessage[] = [];

  // 1. Crear una nota
  history = await runScenarioWithRetry(
    '1. CREAR NOTA',
    'Crea una nota titulada "Ideas para el proyecto" con el contenido: "1. Implementar autenticación 2. Añadir dashboard 3. Integrar pagos". Usa las etiquetas: proyecto, ideas.',
    history
  );

  console.log('\n⏳ Esperando 3s entre escenarios...');
  await delay(3000);

  // 2. Crear una lista
  history = await runScenarioWithRetry(
    '2. CREAR LISTA',
    'Crea una lista de la compra con estos elementos: leche, pan, huevos, frutas, café.',
    history
  );

  console.log('\n⏳ Esperando 3s entre escenarios...');
  await delay(3000);

  // 3. Programar una tarea
  history = await runScenarioWithRetry(
    '3. PROGRAMAR TAREA',
    'Programa una tarea que se ejecute todos los días a las 9:00 de la mañana. La tarea debe buscar las últimas noticias de tecnología y enviarme un resumen por Telegram.',
    history
  );

  console.log('\n⏳ Esperando 3s entre escenarios...');
  await delay(3000);

  // 4. Responder al usuario con info + enviar por Telegram
  history = await runScenarioWithRetry(
    '4. RESPONDER AL USUARIO',
    'Dime qué notas y listas tengo guardadas, y envíame un resumen por Telegram.',
    history
  );

  console.log('\n⏳ Esperando 3s entre escenarios...');
  await delay(3000);

  // 5. Crear evento de calendario (sin credenciales — prueba manejo de errores)
  history = await runScenarioWithRetry(
    '5. CREAR EVENTO CALENDARIO',
    'Crea un evento en mi calendario para mañana a las 10:00 que se llame "Reunión de equipo" con duración de 1 hora.',
    history
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n\n' + '🏁'.repeat(30));
  console.log('\n📋 RESUMEN DE LA SIMULACIÓN:');
  console.log('─'.repeat(60));
  console.log(`📱 Mensajes de Telegram enviados: ${telegramMessages.length}`);
  telegramMessages.forEach((msg, i) => {
    console.log(`   ${i + 1}. ${msg.slice(0, 100)}${msg.length > 100 ? '...' : ''}`);
  });
  console.log(`⏰ Tareas programadas: ${scheduledTasks.length}`);
  scheduledTasks.forEach((task, i) => {
    console.log(`   ${i + 1}. "${task.name}" — cron: ${task.cron}`);
  });
  console.log(`🧠 Memorias guardadas: ${memories.length}`);
  memories.forEach((mem, i) => {
    console.log(`   ${i + 1}. ${mem}`);
  });
  console.log(`💬 Mensajes en historial: ${history.length}`);
  console.log('─'.repeat(60));

  // Verify data was actually persisted
  const { getAllNotes, getAllLists, getAllSchedules } = await import('./agents/storage');
  const notes = getAllNotes(TEST_USER_ID, TEST_AGENT_ID);
  const lists = getAllLists(TEST_USER_ID, TEST_AGENT_ID);
  const schedules = getAllSchedules(TEST_USER_ID, TEST_AGENT_ID);

  console.log('\n📁 DATOS PERSISTIDOS EN DISCO:');
  console.log('─'.repeat(60));
  console.log(`📝 Notas: ${notes.length}`);
  notes.forEach(n => console.log(`   - "${n.title}" (${n.tags.join(', ')})`));
  console.log(`📋 Listas: ${lists.length}`);
  lists.forEach(l => console.log(`   - "${l.title}" (${l.items.length} items)`));
  console.log(`⏰ Schedules: ${schedules.length}`);
  schedules.forEach(s => console.log(`   - "${s.name}" — cron: ${s.cron}`));
  console.log('─'.repeat(60));

  const allPassed = notes.length > 0 && lists.length > 0 && schedules.length > 0 && telegramMessages.length > 0;
  console.log(`\n${allPassed ? '✅ SIMULACIÓN EXITOSA' : '⚠️  SIMULACIÓN PARCIAL'} — Revisa los resultados arriba.\n`);

  // Cleanup test data
  const fs = await import('fs');
  const testDataDir = path.resolve(__dirname, `../../data/agents/${TEST_USER_ID}`);
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
    console.log(`🧹 Datos de test limpiados: ${testDataDir}`);
  }
}

main().catch((err) => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
