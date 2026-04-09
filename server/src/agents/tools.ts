// ---------------------------------------------------------------------------
// Agent Tools — Built-in tools the agent can use
// ---------------------------------------------------------------------------

import { ToolDefinition, ToolCallRequest, ToolCallResult, AgentConfig } from './types';
import { NativeFunctionTool } from '../providers/base';
import { getHostMountsPromptSection } from '../config';
import * as storage from './storage';
import { MCPClientManager, MCPToolDefinition } from './mcpClient';
import { CalendarEvent, CalendarProvider } from './calendar';
import { createGoogleCalendarProvider } from './calendarGoogle';
import { createICloudCalendarProvider } from './calendarICloud';
import { createGmailProvider, GmailConfig } from './gmail';
import { transcribeAudio } from './transcription';
import { analyzeImage } from './vision';
import * as radarr from './radarr';
import * as sonarr from './sonarr';
import * as homeAssistant from './homeAssistant';
import { HomeAssistantConfig } from './homeAssistant';
import {
  preExecutionCheck,
  sanitizeEnvironment,
  secureTemporaryFilePath,
  sanitizeCommandArg,
  updateAuditEntryResult,
  getCommandRiskWarnings,
} from '../security/terminalSecurity';
import * as skills from './skills';
import * as eventSubs from './eventSubscriptions';
import * as documentTools from './documentTools';
import { scoreAndFilterMemories, MemoryCandidate } from './smartMemory';

// ---------------------------------------------------------------------------
// URL allow-list enforcement
// ---------------------------------------------------------------------------

function checkUrlAllowed(
  url: string,
  permissions: AgentConfig['permissions']
): string | null {
  const list = permissions.allowedWebsites;
  if (!list || list.length === 0) return null; // no restrictions
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const allowed = list.some((pattern) => {
      const p = pattern.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      // exact match or subdomain match (e.g. "example.com" allows "sub.example.com")
      return hostname === p || hostname.endsWith('.' + p);
    });
    if (!allowed) {
      return `URL bloqueada: "${url}" no está en la lista de sitios permitidos (${list.join(', ')})`;
    }
  } catch {
    return `URL inválida: "${url}"`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool Definitions (sent to the LLM)
// ---------------------------------------------------------------------------

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description:
      'Busca en internet usando DuckDuckGo. Usa esto para buscar información general, noticias, eventos, congresos, productos, etc. Devuelve un resumen de los resultados de búsqueda.',
    parameters: {
      query: { type: 'string', description: 'La consulta de búsqueda', required: true },
    },
  },
  {
    name: 'fetch_webpage',
    description:
      'Descarga y extrae el texto principal de una página web dada su URL. Útil para leer artículos, páginas de eventos, documentación, etc. No necesita navegador, hace una petición HTTP directa.',
    parameters: {
      url: { type: 'string', description: 'La URL de la página web a leer', required: true },
    },
  },
  {
    name: 'fetch_image',
    description:
      'Descarga una imagen desde una URL y la devuelve en formato base64. Además, ANALIZA automáticamente el contenido de la imagen y te dice qué muestra, para que puedas decidir si es relevante para tu presentación/documento. IMPRESCINDIBLE para insertar imágenes de internet en documentos. Flujo: 1) web_search para encontrar imágenes, 2) fetch_image para descargar+analizar, 3) usar el base64 en create_powerpoint/create_pdf.',
    parameters: {
      url: { type: 'string', description: 'La URL directa de la imagen (jpg, png, gif, webp)', required: true },
    },
  },
  {
    name: 'browse_website',
    description:
      'Navega a una URL usando un navegador headless (para páginas que requieren JavaScript). Útil para aplicaciones web interactivas, dashboards, páginas con contenido dinámico, logins en sitios web como Google Home, etc.',
    parameters: {
      url: { type: 'string', description: 'La URL a navegar', required: true },
      action: {
        type: 'string',
        description: 'Acción a realizar: "read" (leer), "screenshot" (captura), "click" (clic), "fill" (rellenar campo), "login" (iniciar sesión con credenciales guardadas)',
        required: false,
      },
      selector: { type: 'string', description: 'Selector CSS objetivo (con action=click/fill)', required: false },
      value: { type: 'string', description: 'Texto a escribir cuando action=fill', required: false },
      wait_for_ms: { type: 'number', description: 'Milisegundos extra de espera tras la acción (opcional)', required: false },
      credential_site: {
        type: 'string',
        description: 'Dominio/URL para elegir credenciales guardadas (opcional, útil si difiere de la URL actual)',
        required: false,
      },
      username_selector: { type: 'string', description: 'Selector CSS del campo usuario (opcional para action=login)', required: false },
      password_selector: { type: 'string', description: 'Selector CSS del campo contraseña (opcional para action=login)', required: false },
      submit_selector: { type: 'string', description: 'Selector CSS del botón submit/login (opcional para action=login)', required: false },
    },
  },
  {
    name: 'send_telegram_message',
    description:
      'Envía un mensaje proactivo al usuario por Telegram. Usa esto para reportar resultados, enviar alertas, notificaciones, actualizaciones de progreso, etc. El agente puede usarlo EN CUALQUIER MOMENTO sin esperar input del usuario.',
    parameters: {
      message: { type: 'string', description: 'El mensaje a enviar (soporta Markdown)', required: true },
    },
  },
  {
    name: 'remember',
    description:
      'Guarda información importante en la memoria persistente del agente para recordarla en futuras conversaciones.',
    parameters: {
      info: { type: 'string', description: 'La información a recordar', required: true },
    },
  },
  {
    name: 'get_current_time',
    description: 'Obtiene la fecha y hora actual del sistema.',
    parameters: {},
  },

  // ── Working Memory (Scratchpad) ──────────────────────────────────────────
  {
    name: 'update_working_memory',
    description:
      'Actualiza la "Memoria de Trabajo" del agente: un bloc de notas persistente para anotar pasos intermedios, resultados parciales y progreso de tareas largas. Si ya existe una entrada con la misma etiqueta, se sobrescribe. Úsala para no perder el hilo en tareas complejas de múltiples pasos.',
    parameters: {
      label: { type: 'string', description: 'Etiqueta/categoría del apunte (ej: "progreso_tarea", "resultado_parcial", "plan_actual")', required: true },
      content: { type: 'string', description: 'Contenido del apunte', required: true },
    },
  },
  {
    name: 'get_working_memory',
    description:
      'Lee la Memoria de Trabajo actual del agente. Sin parámetros devuelve todas las entradas; con label devuelve solo la que coincide.',
    parameters: {
      label: { type: 'string', description: 'Etiqueta específica a buscar (opcional, sin ella devuelve todo)', required: false },
    },
  },
  {
    name: 'clear_working_memory',
    description:
      'Borra toda la Memoria de Trabajo del agente o sólo una entrada específica. Usar al completar una tarea larga para limpiar el scratchpad.',
    parameters: {
      entry_id: { type: 'string', description: 'ID de la entrada a borrar. Si se omite se borra todo.', required: false },
    },
  },

  // ── Notes ────────────────────────────────────────────────────────────────
  {
    name: 'create_note',
    description:
      'Crea una nueva nota y la guarda de forma persistente en el almacenamiento del usuario. Ideal para guardar ideas, recordatorios, información importante, etc.',
    parameters: {
      title: { type: 'string', description: 'Título de la nota', required: true },
      content: { type: 'string', description: 'Contenido de la nota', required: true },
      tags: { type: 'string', description: 'Etiquetas separadas por comas (opcional)', required: false },
    },
  },
  {
    name: 'get_notes',
    description:
      'Recupera todas las notas guardadas del usuario. Devuelve una lista con títulos, contenidos y fechas.',
    parameters: {},
  },
  {
    name: 'search_notes',
    description:
      'Busca notas por título, contenido o etiquetas. Devuelve las notas que coincidan con la búsqueda.',
    parameters: {
      query: { type: 'string', description: 'Término de búsqueda', required: true },
    },
  },
  {
    name: 'update_note',
    description:
      'Actualiza el título, contenido o etiquetas de una nota existente. Puedes pasar note_id directamente o usar query para que el sistema localice la nota automáticamente con Smart RAG.',
    parameters: {
      note_id: { type: 'string', description: 'ID de la nota a actualizar (opcional si usas query)', required: false },
      query: { type: 'string', description: 'Texto para localizar la nota cuando no conoces su ID (Smart RAG)', required: false },
      title: { type: 'string', description: 'Nuevo título (opcional)', required: false },
      content: { type: 'string', description: 'Nuevo contenido (opcional)', required: false },
      tags: { type: 'string', description: 'Nuevas etiquetas separadas por comas (opcional)', required: false },
    },
  },
  {
    name: 'delete_note',
    description:
      'Elimina una nota por su ID.',
    parameters: {
      note_id: { type: 'string', description: 'ID de la nota a eliminar', required: true },
    },
  },

  // ── Lists ────────────────────────────────────────────────────────────────
  {
    name: 'create_list',
    description:
      'Crea una nueva lista persistente (de compra, tareas, enlaces, etc.) y la guarda en el almacenamiento del usuario. Los elementos se pueden añadir o quitar después.',
    parameters: {
      title: { type: 'string', description: 'Título de la lista (ej: "Lista de la compra", "Tareas pendientes")', required: true },
      items: { type: 'string', description: 'Elementos iniciales separados por comas', required: false },
    },
  },
  {
    name: 'get_lists',
    description:
      'Recupera todas las listas guardadas del usuario con sus elementos.',
    parameters: {},
  },
  {
    name: 'get_list',
    description:
      'Recupera una lista específica por su título o ID. Busca primero por título exacto, luego por coincidencia parcial.',
    parameters: {
      title: { type: 'string', description: 'Título o ID de la lista', required: true },
    },
  },
  {
    name: 'add_to_list',
    description:
      'Añade uno o más elementos a una lista existente. Busca la lista por título.',
    parameters: {
      title: { type: 'string', description: 'Título de la lista', required: true },
      items: { type: 'string', description: 'Elementos a añadir separados por comas', required: true },
    },
  },
  {
    name: 'remove_from_list',
    description:
      'Elimina un elemento de una lista existente por su texto.',
    parameters: {
      title: { type: 'string', description: 'Título de la lista', required: true },
      item: { type: 'string', description: 'Texto del elemento a eliminar', required: true },
    },
  },
  {
    name: 'check_list_item',
    description:
      'Marca o desmarca un elemento de una lista como completado.',
    parameters: {
      title: { type: 'string', description: 'Título de la lista', required: true },
      item: { type: 'string', description: 'Texto del elemento', required: true },
      checked: { type: 'string', description: '"true" para marcar como completado, "false" para desmarcar', required: true },
    },
  },
  {
    name: 'delete_list',
    description:
      'Elimina una lista completa por su título o ID.',
    parameters: {
      title: { type: 'string', description: 'Título o ID de la lista a eliminar', required: true },
    },
  },

  // ── Scheduler ────────────────────────────────────────────────────────────
  {
    name: 'schedule_task',
    description:
      'Programa una tarea para ejecutarse de forma recurrente. El agente ejecutará la tarea automáticamente y enviará los resultados por Telegram. La tarea se guarda de forma persistente.',
    parameters: {
      name: { type: 'string', description: 'Nombre descriptivo de la tarea', required: true },
      cron: {
        type: 'string',
        description: 'Expresión cron (ej: "0 14 * * *" para todos los días a las 14:00, "0 9 * * 1" para lunes a las 9:00)',
        required: true,
      },
      instruction: {
        type: 'string',
        description: 'Instrucción detallada de qué debe hacer el agente cuando se ejecute la tarea',
        required: true,
      },
      start_at: {
        type: 'string',
        description: 'Fecha/hora de inicio opcional en formato ISO (ej: "2026-02-14T09:00:00-05:00")',
        required: false,
      },
      frequency: {
        type: 'string',
        description: 'Descripción de frecuencia en lenguaje natural (opcional, para referencia del usuario)',
        required: false,
      },
      conditions: {
        type: 'string',
        description: 'Condiciones opcionales para ejecutar la tarea (se incluirán en la instrucción)',
        required: false,
      },
      timezone: {
        type: 'string',
        description: 'Zona horaria IANA opcional (ej: "America/New_York")',
        required: false,
      },
    },
  },
  {
    name: 'list_scheduled_tasks',
    description:
      'Muestra todas las tareas programadas del usuario con su estado (activa/inactiva), horario cron e instrucciones.',
    parameters: {},
  },
  {
    name: 'remove_scheduled_task',
    description:
      'Elimina una tarea programada por su nombre o ID.',
    parameters: {
      task_id: { type: 'string', description: 'Nombre o ID de la tarea a eliminar', required: true },
    },
  },
  {
    name: 'toggle_scheduled_task',
    description:
      'Activa o desactiva una tarea programada sin eliminarla.',
    parameters: {
      task_id: { type: 'string', description: 'Nombre o ID de la tarea', required: true },
      enabled: { type: 'string', description: '"true" para activar, "false" para desactivar', required: true },
    },
  },

  // ── Calendar ──────────────────────────────────────────────────────────────
  {
    name: 'create_calendar_event',
    description:
      'Crea un nuevo evento en el calendario del usuario (Google Calendar o iCloud). Ideal para reuniones, citas, recordatorios con fecha/hora específica.',
    parameters: {
      title: { type: 'string', description: 'Título del evento', required: true },
      start_time: { type: 'string', description: 'Fecha/hora de inicio en formato ISO 8601 (ej: "2026-02-14T10:00:00")', required: true },
      end_time: { type: 'string', description: 'Fecha/hora de fin en formato ISO 8601 (ej: "2026-02-14T11:00:00")', required: true },
      description: { type: 'string', description: 'Descripción del evento (opcional)', required: false },
      location: { type: 'string', description: 'Ubicación del evento (opcional)', required: false },
      all_day: { type: 'string', description: '"true" si es un evento de todo el día (opcional)', required: false },
      calendar_type: { type: 'string', description: '"google" o "icloud" (usa el que esté configurado si se omite)', required: false },
    },
  },
  {
    name: 'list_calendar_events',
    description:
      'Lista los próximos eventos del calendario del usuario en un rango de fechas.',
    parameters: {
      start_date: { type: 'string', description: 'Fecha de inicio del rango ISO 8601 (ej: "2026-02-14")', required: true },
      end_date: { type: 'string', description: 'Fecha de fin del rango ISO 8601 (ej: "2026-02-21")', required: true },
      calendar_type: { type: 'string', description: '"google" o "icloud" (usa el que esté configurado si se omite)', required: false },
      max_results: { type: 'number', description: 'Número máximo de eventos a devolver (por defecto 25)', required: false },
    },
  },
  {
    name: 'search_calendar_events',
    description:
      'Busca eventos en el calendario por texto (título, descripción o ubicación).',
    parameters: {
      query: { type: 'string', description: 'Texto a buscar en los eventos', required: true },
      calendar_type: { type: 'string', description: '"google" o "icloud" (usa el que esté configurado si se omite)', required: false },
      start_date: { type: 'string', description: 'Fecha de inicio del rango de búsqueda (opcional)', required: false },
      end_date: { type: 'string', description: 'Fecha de fin del rango de búsqueda (opcional)', required: false },
    },
  },
  {
    name: 'update_calendar_event',
    description:
      'Actualiza un evento existente en el calendario (título, hora, descripción, ubicación).',
    parameters: {
      event_id: { type: 'string', description: 'ID del evento a actualizar (opcional si usas búsqueda por texto/fecha)', required: false },
      match_text: { type: 'string', description: 'Texto para localizar el evento si no se conoce el ID (opcional)', required: false },
      date: { type: 'string', description: 'Fecha concreta ISO para buscar el evento (opcional)', required: false },
      start_date: { type: 'string', description: 'Inicio de rango ISO para buscar (opcional)', required: false },
      end_date: { type: 'string', description: 'Fin de rango ISO para buscar (opcional)', required: false },
      week_of: { type: 'string', description: 'Fecha dentro de la semana objetivo para buscar (opcional)', required: false },
      title: { type: 'string', description: 'Nuevo título (opcional)', required: false },
      start_time: { type: 'string', description: 'Nueva fecha/hora de inicio ISO 8601 (opcional)', required: false },
      end_time: { type: 'string', description: 'Nueva fecha/hora de fin ISO 8601 (opcional)', required: false },
      description: { type: 'string', description: 'Nueva descripción (opcional)', required: false },
      location: { type: 'string', description: 'Nueva ubicación (opcional)', required: false },
      calendar_type: { type: 'string', description: '"google" o "icloud" (usa el que esté configurado si se omite)', required: false },
    },
  },
  {
    name: 'delete_calendar_event',
    description:
      'Elimina un evento del calendario por su ID. Si no hay ID, puede localizar por texto y fecha/rango.',
    parameters: {
      event_id: { type: 'string', description: 'ID del evento a eliminar (opcional si usas búsqueda por texto/fecha)', required: false },
      match_text: { type: 'string', description: 'Texto para filtrar el evento (título/descripcion/ubicación)', required: false },
      date: { type: 'string', description: 'Fecha concreta ISO para buscar (opcional)', required: false },
      start_date: { type: 'string', description: 'Inicio de rango ISO para buscar (opcional)', required: false },
      end_date: { type: 'string', description: 'Fin de rango ISO para buscar (opcional)', required: false },
      week_of: { type: 'string', description: 'Fecha dentro de la semana objetivo para buscar (opcional)', required: false },
      calendar_type: { type: 'string', description: '"google" o "icloud" (usa el que esté configurado si se omite)', required: false },
    },
  },

  // ── Gmail ─────────────────────────────────────────────────────────────────
  {
    name: 'list_emails',
    description:
      'Lista los correos electrónicos más recientes de la bandeja de entrada de Gmail del usuario.',
    parameters: {
      query: { type: 'string', description: 'Filtro de búsqueda opcional (ej: "is:unread", "from:juan@ejemplo.com", "subject:factura")', required: false },
      max_results: { type: 'number', description: 'Número máximo de correos a devolver (por defecto 10, máximo 20)', required: false },
    },
  },
  {
    name: 'read_email',
    description:
      'Lee el contenido completo de un correo electrónico específico por su ID.',
    parameters: {
      message_id: { type: 'string', description: 'ID del mensaje de Gmail a leer', required: true },
    },
  },
  {
    name: 'search_emails',
    description:
      'Busca correos electrónicos en Gmail usando consultas avanzadas de búsqueda.',
    parameters: {
      query: { type: 'string', description: 'Consulta de búsqueda de Gmail (ej: "from:banco subject:transferencia after:2026/01/01")', required: true },
      max_results: { type: 'number', description: 'Número máximo de resultados (por defecto 10)', required: false },
    },
  },
  {
    name: 'send_email',
    description:
      'Envía un correo electrónico desde la cuenta de Gmail del usuario. IMPORTANTE: Siempre muestra una vista previa al usuario y pide confirmación explícita antes de enviar.',
    parameters: {
      to: { type: 'string', description: 'Dirección de correo del destinatario', required: true },
      subject: { type: 'string', description: 'Asunto del correo', required: true },
      body: { type: 'string', description: 'Cuerpo del correo (texto plano)', required: true },
      cc: { type: 'string', description: 'Dirección(es) en copia (separadas por comas, opcional)', required: false },
      bcc: { type: 'string', description: 'Dirección(es) en copia oculta (separadas por comas, opcional)', required: false },
    },
  },
  {
    name: 'reply_email',
    description:
      'Responde a un correo electrónico existente manteniendo el hilo de conversación. IMPORTANTE: Siempre muestra vista previa y pide confirmación antes de enviar.',
    parameters: {
      message_id: { type: 'string', description: 'ID del mensaje al que responder', required: true },
      body: { type: 'string', description: 'Cuerpo de la respuesta (texto plano)', required: true },
    },
  },
  {
    name: 'get_unread_email_count',
    description:
      'Obtiene el número de correos no leídos en la bandeja de entrada.',
    parameters: {},
  },

  // ── Reminders (one-shot) ─────────────────────────────────────────────────
  {
    name: 'set_reminder',
    description:
      'Crea un recordatorio único que se dispara UNA SOLA VEZ en la fecha/hora indicada y luego se desactiva automáticamente. Ideal para: "recuérdame mañana a las 10", "avísame en 40 minutos", "recordatorio para el día 25 a las 10:00". Para recordatorios recurrentes usa schedule_task en su lugar.',
    parameters: {
      name: { type: 'string', description: 'Nombre descriptivo del recordatorio (ej: "pagar recibo", "sacar la ropa")', required: true },
      trigger_at: { type: 'string', description: 'Fecha/hora en formato ISO 8601 cuando debe dispararse (ej: "2026-02-14T10:00:00"). Calcula la fecha/hora correcta a partir del lenguaje natural del usuario.', required: true },
      message: { type: 'string', description: 'Mensaje a enviar cuando se dispare el recordatorio', required: true },
      timezone: { type: 'string', description: 'Zona horaria IANA opcional (ej: "Europe/Madrid")', required: false },
    },
  },
  {
    name: 'list_reminders',
    description:
      'Lista todos los recordatorios activos (pendientes de dispararse) del usuario.',
    parameters: {},
  },
  {
    name: 'cancel_reminder',
    description:
      'Cancela un recordatorio pendiente por su nombre o ID.',
    parameters: {
      reminder_id: { type: 'string', description: 'Nombre o ID del recordatorio a cancelar', required: true },
    },
  },
  {
    name: 'postpone_reminder',
    description:
      'Pospone un recordatorio existente a una nueva fecha/hora.',
    parameters: {
      reminder_id: { type: 'string', description: 'Nombre o ID del recordatorio a posponer', required: true },
      new_trigger_at: { type: 'string', description: 'Nueva fecha/hora ISO 8601 para el recordatorio', required: true },
    },
  },

  // ── Enhanced Lists ───────────────────────────────────────────────────────
  {
    name: 'update_list_item',
    description:
      'Actualiza un elemento de una lista: cambiar texto, prioridad (alta/media/baja), fecha de vencimiento o categoría.',
    parameters: {
      title: { type: 'string', description: 'Título de la lista', required: true },
      item: { type: 'string', description: 'Texto actual del elemento a modificar', required: true },
      new_text: { type: 'string', description: 'Nuevo texto para el elemento (opcional)', required: false },
      priority: { type: 'string', description: 'Prioridad: "alta", "media" o "baja" (opcional)', required: false },
      due_date: { type: 'string', description: 'Fecha de vencimiento ISO 8601 (opcional)', required: false },
      category: { type: 'string', description: 'Categoría/sección del elemento: "frutería", "carnicería", "trabajo", etc. (opcional)', required: false },
    },
  },
  {
    name: 'get_pending_tasks',
    description:
      'Obtiene todas las tareas pendientes (no completadas) de TODAS las listas, ordenadas por prioridad y fecha de vencimiento. Útil para responder "¿qué me queda por hacer hoy?".',
    parameters: {},
  },

  // ── Expenses ─────────────────────────────────────────────────────────────
  {
    name: 'add_expense',
    description:
      'Registra un nuevo gasto. Ejemplo: "12,30€ en gasolina", "9,99€ suscripción mensual Netflix".',
    parameters: {
      amount: { type: 'number', description: 'Importe del gasto (ej: 12.30)', required: true },
      description: { type: 'string', description: 'Descripción del gasto (ej: "gasolina", "Netflix")', required: true },
      category: { type: 'string', description: 'Categoría: transporte, alimentación, ocio, hogar, salud, suscripciones, ropa, educación, otros', required: true },
      currency: { type: 'string', description: 'Moneda (por defecto EUR)', required: false },
      date: { type: 'string', description: 'Fecha del gasto ISO 8601 (por defecto hoy)', required: false },
      recurring: { type: 'string', description: '"true" si es un gasto recurrente', required: false },
      recurring_frequency: { type: 'string', description: 'Frecuencia si es recurrente: "mensual", "semanal", "anual"', required: false },
      tags: { type: 'string', description: 'Etiquetas separadas por comas (opcional)', required: false },
    },
  },
  {
    name: 'list_expenses',
    description:
      'Lista gastos registrados con filtros opcionales por categoría, rango de fechas o término de búsqueda.',
    parameters: {
      category: { type: 'string', description: 'Filtrar por categoría (opcional)', required: false },
      start_date: { type: 'string', description: 'Fecha inicio rango ISO 8601 (opcional)', required: false },
      end_date: { type: 'string', description: 'Fecha fin rango ISO 8601 (opcional)', required: false },
      query: { type: 'string', description: 'Buscar en descripción/categoría/etiquetas (opcional)', required: false },
    },
  },
  {
    name: 'expense_summary',
    description:
      'Resumen de gastos en un período: total, desglose por categoría, número de gastos. Ideal para "¿cuánto llevo gastado esta semana/mes?".',
    parameters: {
      start_date: { type: 'string', description: 'Fecha inicio del período ISO 8601 (opcional)', required: false },
      end_date: { type: 'string', description: 'Fecha fin del período ISO 8601 (opcional)', required: false },
      period: { type: 'string', description: 'Período predefinido: "hoy", "esta_semana", "este_mes", "este_año" (alternativa a start/end_date)', required: false },
    },
  },
  {
    name: 'delete_expense',
    description:
      'Elimina un gasto registrado por su ID.',
    parameters: {
      expense_id: { type: 'string', description: 'ID del gasto a eliminar', required: true },
    },
  },
  {
    name: 'export_expenses',
    description:
      'Exporta los gastos a formato CSV. Ideal para llevar un control en hoja de cálculo.',
    parameters: {
      start_date: { type: 'string', description: 'Fecha inicio ISO 8601 (opcional)', required: false },
      end_date: { type: 'string', description: 'Fecha fin ISO 8601 (opcional)', required: false },
    },
  },

  // ── Telegram Buttons ─────────────────────────────────────────────────────
  {
    name: 'send_telegram_buttons',
    description:
      'Envía un mensaje por Telegram con botones de acción rápida (inline keyboard). Los botones permiten al usuario responder con un toque sin escribir. Ideal para confirmaciones, opciones múltiples, acciones rápidas como "✅ Hecho", "⏰ Posponer", "🗑️ Cancelar".',
    parameters: {
      message: { type: 'string', description: 'El mensaje a enviar', required: true },
      buttons: { type: 'string', description: 'Botones en formato JSON array de arrays: [[{"text":"✅ Hecho","callback_data":"done"}],[{"text":"⏰ Posponer","callback_data":"postpone"},{"text":"🗑️ Cancelar","callback_data":"cancel"}]]. Cada array interno es una fila de botones.', required: true },
    },
  },

  // ── File/Document Processing ─────────────────────────────────────────────
  {
    name: 'process_telegram_file',
    description:
      'Descarga y procesa un archivo (foto o documento PDF/texto) enviado por el usuario a través de Telegram. Extrae el texto del archivo y lo guarda. Usa esto cuando el usuario envíe un documento o foto y necesites leer su contenido.',
    parameters: {
      file_id: { type: 'string', description: 'El file_id del archivo de Telegram (proporcionado automáticamente en el mensaje)', required: true },
      action: { type: 'string', description: 'Qué hacer con el contenido: "read" (solo leer), "save_note" (guardar como nota), "summarize" (resumir). Por defecto: "read"', required: false },
      note_title: { type: 'string', description: 'Título para la nota si action=save_note (opcional)', required: false },
    },
  },

  // ── Audio Transcription ─────────────────────────────────────────────────
  {
    name: 'transcribe_telegram_audio',
    description:
      'Transcribe una nota de voz o archivo de audio enviado por el usuario a través de Telegram. Usa Whisper (Groq/OpenAI/local) para convertir audio a texto. Después de obtener la transcripción, puedes responder al usuario, guardarla como nota, o realizar acciones encadenadas basadas en el contenido.',
    parameters: {
      file_id: { type: 'string', description: 'El file_id del audio/nota de voz de Telegram (proporcionado automáticamente en el mensaje)', required: true },
      action: { type: 'string', description: 'Qué hacer después de transcribir: "read" (solo devolver texto), "save_note" (guardar como nota), "respond" (procesar y responder al contenido). Por defecto: "read"', required: false },
      note_title: { type: 'string', description: 'Título para la nota si action=save_note (opcional)', required: false },
    },
  },

  // ── Image Analysis ──────────────────────────────────────────────────────
  {
    name: 'analyze_telegram_image',
    description:
      'Analiza una imagen enviada por el usuario a través de Telegram usando IA con capacidad de visión. Puede describir el contenido, extraer texto (OCR), analizar gráficos, identificar objetos, etc. Usa esto cuando el usuario envíe una foto y necesites entender su contenido.',
    parameters: {
      file_id: { type: 'string', description: 'El file_id de la foto de Telegram (proporcionado automáticamente en el mensaje)', required: true },
      prompt: { type: 'string', description: 'Instrucción específica sobre qué analizar en la imagen (ej: "extrae el texto", "describe los productos", "analiza este gráfico"). Por defecto: descripción general', required: false },
      action: { type: 'string', description: 'Qué hacer después del análisis: "read" (solo devolver descripción), "save_note" (guardar como nota). Por defecto: "read"', required: false },
      note_title: { type: 'string', description: 'Título para la nota si action=save_note (opcional)', required: false },
    },
  },

  // ── Undo ─────────────────────────────────────────────────────────────────
  {
    name: 'undo_last_action',
    description:
      'Deshace la última acción realizada (crear nota, crear lista, añadir elemento, registrar gasto, crear recordatorio, etc.). Revierte la operación anterior si es posible. El usuario puede decir "deshacer", "undo", "cancela lo último", etc.',
    parameters: {},
  },

  // ── Location-Based Reminders ────────────────────────────────────────────
  {
    name: 'set_location_reminder',
    description:
      'Crea un recordatorio basado en ubicación que se dispara cuando el usuario esté cerca de un lugar específico. El usuario debe compartir su ubicación por Telegram para que se active. Ejemplo: "Recuérdame comprar leche cuando esté cerca del supermercado".',
    parameters: {
      name: { type: 'string', description: 'Nombre descriptivo del recordatorio de ubicación', required: true },
      message: { type: 'string', description: 'Mensaje a enviar cuando el usuario llegue al lugar', required: true },
      latitude: { type: 'number', description: 'Latitud del lugar objetivo', required: true },
      longitude: { type: 'number', description: 'Longitud del lugar objetivo', required: true },
      radius_meters: { type: 'number', description: 'Radio en metros para activar el recordatorio (por defecto 200m)', required: false },
    },
  },
  {
    name: 'list_location_reminders',
    description:
      'Lista todos los recordatorios basados en ubicación activos del usuario.',
    parameters: {},
  },
  {
    name: 'cancel_location_reminder',
    description:
      'Cancela un recordatorio basado en ubicación por su nombre o ID.',
    parameters: {
      reminder_id: { type: 'string', description: 'Nombre o ID del recordatorio de ubicación a cancelar', required: true },
    },
  },
  {
    name: 'check_location',
    description:
      'Verifica una ubicación compartida contra los recordatorios de ubicación activos y dispara los que estén dentro del radio. Se usa automáticamente cuando el usuario comparte ubicación por Telegram.',
    parameters: {
      latitude: { type: 'number', description: 'Latitud de la ubicación actual', required: true },
      longitude: { type: 'number', description: 'Longitud de la ubicación actual', required: true },
    },
  },

  // ── Radarr (Movies) ─────────────────────────────────────────────────────
  {
    name: 'radarr_search_movie',
    description:
      'Busca una película en Radarr (TMDB/IMDb). Puede buscar por nombre, por IMDb ID (ej: "imdb:tt1234567") o por TMDB ID (ej: "tmdb:12345"). SIEMPRE intenta identificar la película por su ID externo cuando sea posible, es más preciso. Si hay varios resultados con el mismo título pero diferente año, DEBES preguntar al usuario de qué año se refiere antes de proceder. Devuelve resultados con título, año, sinopsis, tmdbId e imdbId.',
    parameters: {
      query: { type: 'string', description: 'Título, término de búsqueda, o ID externo ("imdb:tt1234567" o "tmdb:12345")', required: true },
    },
  },
  {
    name: 'radarr_add_movie',
    description:
      'Añade una película a Radarr para descargarla. Puede identificar por tmdb_id o imdb_id (usa el más preciso disponible, con fallback automático). NO busca automáticamente; después de añadir usa radarr_get_releases para ver las opciones y que el usuario elija.',
    parameters: {
      tmdb_id: { type: 'number', description: 'ID de TMDB de la película (se puede usar junto con imdb_id como fallback)', required: false },
      imdb_id: { type: 'string', description: 'ID de IMDb de la película (ej: "tt1234567"). Se usa como identificador alternativo/fallback', required: false },
      search: { type: 'string', description: '"true" para iniciar búsqueda automática, "false" para elegir manualmente con radarr_get_releases (recomendado: false)', required: false },
    },
  },
  {
    name: 'radarr_library',
    description:
      'Lista las películas en la biblioteca de Radarr. Muestra título, año, estado de descarga y calidad.',
    parameters: {
      query: { type: 'string', description: 'Filtrar por título (opcional)', required: false },
    },
  },
  {
    name: 'radarr_movie_status',
    description:
      'Comprueba si una película específica está en la biblioteca de Radarr, si tiene archivo descargado y su calidad.',
    parameters: {
      title: { type: 'string', description: 'Título de la película a buscar en la biblioteca', required: true },
    },
  },
  {
    name: 'radarr_queue',
    description:
      'Muestra las descargas activas de Radarr con progreso, tiempo restante, tamaño y estado.',
    parameters: {},
  },
  {
    name: 'radarr_get_releases',
    description:
      'Obtiene las opciones de descarga disponibles para una película en Radarr, ordenadas por ratio de peers (seeders/leechers). Permite filtrar por tamaño mínimo/máximo en GB y, si no hay suficientes opciones en los primeros resultados, amplía la búsqueda automáticamente para seguir buscando. Muestra las mejores opciones con calidad, peers, indexador y rechazos. SIEMPRE usa esto para presentar opciones al usuario antes de descargar.',
    parameters: {
      movie_id: { type: 'number', description: 'ID de la película en Radarr', required: true },
      min_size_gb: { type: 'number', description: 'Tamaño mínimo en GB (opcional)', required: false },
      max_size_gb: { type: 'number', description: 'Tamaño máximo en GB (opcional, útil para pedir releases más ligeras)', required: false },
    },
  },
  {
    name: 'radarr_grab_release',
    description:
      'Descarga una release específica de Radarr. Usa el guid e indexer_id obtenidos de radarr_get_releases. Solo usar cuando el usuario haya elegido una opción.',
    parameters: {
      guid: { type: 'string', description: 'GUID de la release a descargar (obtenido de radarr_get_releases)', required: true },
      indexer_id: { type: 'number', description: 'ID del indexador (obtenido de radarr_get_releases)', required: true },
    },
  },
  {
    name: 'radarr_delete_movie',
    description:
      'Elimina una película de la biblioteca de Radarr.',
    parameters: {
      movie_id: { type: 'number', description: 'ID de la película en Radarr', required: true },
      delete_files: { type: 'string', description: '"true" para eliminar también los archivos del disco (por defecto: false)', required: false },
    },
  },

  // ── Sonarr (Series) ─────────────────────────────────────────────────────
  {
    name: 'sonarr_search_series',
    description:
      'Busca una serie de TV en Sonarr (TVDB/IMDb). Puede buscar por nombre, por TVDB ID (ej: "tvdb:12345") o por IMDb ID (ej: "imdb:tt1234567"). SIEMPRE intenta identificar la serie por su ID externo cuando sea posible, es más preciso. Si hay varios resultados con el mismo título pero diferente año, DEBES preguntar al usuario de qué año se refiere antes de proceder. Devuelve resultados con título, año, temporadas, sinopsis, tvdbId e imdbId.',
    parameters: {
      query: { type: 'string', description: 'Título, término de búsqueda, o ID externo ("tvdb:12345" o "imdb:tt1234567")', required: true },
    },
  },
  {
    name: 'sonarr_add_series',
    description:
      'Añade una serie a Sonarr para descargarla. Puede identificar por tvdb_id o imdb_id (usa el más preciso disponible, con fallback automático). Puede monitorizar toda la serie, temporadas específicas o episodios concretos.',
    parameters: {
      tvdb_id: { type: 'number', description: 'ID de TVDB de la serie (se puede usar junto con imdb_id como fallback)', required: false },
      imdb_id: { type: 'string', description: 'ID de IMDb de la serie (ej: "tt1234567"). Se usa como identificador alternativo/fallback', required: false },
      monitor_seasons: { type: 'string', description: 'Temporadas a monitorizar separadas por comas (ej: "1,2,3"). Vacío = todas', required: false },
      search: { type: 'string', description: '"true" para iniciar búsqueda inmediata (por defecto: true)', required: false },
      series_type: { type: 'string', description: 'Tipo: "standard", "anime" o "daily" (por defecto: standard)', required: false },
    },
  },
  {
    name: 'sonarr_library',
    description:
      'Lista las series en la biblioteca de Sonarr. Muestra título, temporadas, episodios descargados y estado.',
    parameters: {
      query: { type: 'string', description: 'Filtrar por título (opcional)', required: false },
    },
  },
  {
    name: 'sonarr_series_status',
    description:
      'Comprueba el estado completo de una serie en Sonarr: temporadas, episodios descargados, pendientes y calidad.',
    parameters: {
      title: { type: 'string', description: 'Título de la serie a buscar en la biblioteca', required: true },
    },
  },
  {
    name: 'sonarr_season_episodes',
    description:
      'Lista los episodios de una temporada específica de una serie en Sonarr. Muestra cuáles están descargados y cuáles faltan.',
    parameters: {
      series_id: { type: 'number', description: 'ID de la serie en Sonarr', required: true },
      season: { type: 'number', description: 'Número de temporada', required: true },
    },
  },
  {
    name: 'sonarr_search_download',
    description:
      'Lanza una búsqueda automática de descarga en Sonarr. Puede buscar toda la serie, una temporada o episodios específicos. Para elegir manualmente, usa sonarr_get_releases en su lugar.',
    parameters: {
      series_id: { type: 'number', description: 'ID de la serie en Sonarr', required: true },
      season: { type: 'number', description: 'Número de temporada (opcional, si se omite busca toda la serie)', required: false },
      episode_ids: { type: 'string', description: 'IDs de episodios separados por comas para buscar episodios concretos (opcional)', required: false },
    },
  },
  {
    name: 'sonarr_get_releases',
    description:
      'Obtiene las opciones de descarga disponibles para un episodio o temporada en Sonarr, ordenadas por ratio de peers (seeders/leechers). Permite filtrar por tamaño mínimo/máximo en GB y, si no hay suficientes opciones en los primeros resultados, amplía la búsqueda automáticamente para seguir buscando. Muestra las mejores opciones con calidad, peers, indexador y rechazos. SIEMPRE usa esto para presentar opciones al usuario antes de descargar.',
    parameters: {
      episode_id: { type: 'number', description: 'ID del episodio en Sonarr (usar para buscar releases de un episodio específico)', required: false },
      series_id: { type: 'number', description: 'ID de la serie en Sonarr (usar junto con season para buscar releases de una temporada)', required: false },
      season: { type: 'number', description: 'Número de temporada (usar junto con series_id)', required: false },
      min_size_gb: { type: 'number', description: 'Tamaño mínimo en GB (opcional)', required: false },
      max_size_gb: { type: 'number', description: 'Tamaño máximo en GB (opcional, útil para pedir releases más ligeras)', required: false },
    },
  },
  {
    name: 'sonarr_grab_release',
    description:
      'Descarga una release específica de Sonarr. Usa el guid e indexer_id obtenidos de sonarr_get_releases. Solo usar cuando el usuario haya elegido una opción.',
    parameters: {
      guid: { type: 'string', description: 'GUID de la release a descargar (obtenido de sonarr_get_releases)', required: true },
      indexer_id: { type: 'number', description: 'ID del indexador (obtenido de sonarr_get_releases)', required: true },
    },
  },
  {
    name: 'sonarr_queue',
    description:
      'Muestra las descargas activas de Sonarr con progreso, tiempo restante, serie, episodio y estado.',
    parameters: {},
  },
  {
    name: 'sonarr_delete_series',
    description:
      'Elimina una serie de la biblioteca de Sonarr.',
    parameters: {
      series_id: { type: 'number', description: 'ID de la serie en Sonarr', required: true },
      delete_files: { type: 'string', description: '"true" para eliminar también los archivos del disco (por defecto: false)', required: false },
    },
  },

  // ── Home Assistant (Smart Home) ─────────────────────────────────────────
  {
    name: 'ha_get_entities',
    description:
      'Lista las entidades de Home Assistant filtradas por dominio (light, switch, climate, cover, fan, media_player, scene, script, automation, lock, sensor, binary_sensor). Si no se especifica dominio, lista todas las entidades. Útil para descubrir qué dispositivos hay disponibles.',
    parameters: {
      domain: { type: 'string', description: 'Dominio a filtrar: "light", "switch", "climate", "cover", "scene", "fan", "sensor", etc. (opcional, sin él devuelve todas)', required: false },
    },
  },
  {
    name: 'ha_get_state',
    description:
      'Obtiene el estado actual de una entidad específica de Home Assistant (luz, sensor, interruptor, climatización, etc.).',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la entidad (ej: "light.salon", "switch.cocina", "climate.termostato")', required: true },
    },
  },
  {
    name: 'ha_search_entities',
    description:
      'Busca entidades en Home Assistant por nombre, ID parcial o nombre de área/habitación. Si no encuentra coincidencias directas, busca automáticamente en las áreas de Home Assistant. Útil cuando el usuario menciona una habitación (ej: "dormitorio", "salón") para encontrar todos los dispositivos de esa zona.',
    parameters: {
      query: { type: 'string', description: 'Texto a buscar: nombre de entidad, ID parcial, o nombre de área/habitación (ej: "salón", "cocina", "dormitorio")', required: true },
    },
  },
  {
    name: 'ha_list_areas',
    description:
      'Lista todas las áreas/habitaciones configuradas en Home Assistant junto con los dispositivos (entity IDs) que contiene cada una. Útil para descubrir qué habitaciones existen y qué dispositivos tienen.',
    parameters: {},
  },
  {
    name: 'ha_turn_on',
    description:
      'Enciende un dispositivo de Home Assistant (luz, interruptor, ventilador, etc.). Para luces permite ajustar brillo y color.',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la entidad a encender (ej: "light.salon", "switch.cocina")', required: true },
      brightness: { type: 'number', description: 'Brillo de 0 a 100 (solo para luces, opcional)', required: false },
      color_temp: { type: 'number', description: 'Temperatura de color en mireds (solo para luces, opcional)', required: false },
      rgb_color: { type: 'string', description: 'Color RGB separado por comas "R,G,B" ej: "255,0,0" para rojo (solo para luces, opcional)', required: false },
    },
  },
  {
    name: 'ha_turn_off',
    description:
      'Apaga un dispositivo de Home Assistant (luz, interruptor, ventilador, etc.).',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la entidad a apagar (ej: "light.salon", "switch.cocina")', required: true },
    },
  },
  {
    name: 'ha_toggle',
    description:
      'Alterna el estado de un dispositivo de Home Assistant (si está encendido lo apaga y viceversa).',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la entidad a alternar (ej: "light.salon", "switch.cocina")', required: true },
    },
  },
  {
    name: 'ha_set_climate',
    description:
      'Configura un dispositivo de climatización en Home Assistant: temperatura objetivo y/o modo HVAC (heat, cool, auto, off, dry, fan_only).',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la entidad climate (ej: "climate.termostato")', required: true },
      temperature: { type: 'number', description: 'Temperatura objetivo en grados (opcional)', required: false },
      hvac_mode: { type: 'string', description: 'Modo HVAC: "heat", "cool", "auto", "off", "dry", "fan_only" (opcional)', required: false },
    },
  },
  {
    name: 'ha_cover_control',
    description:
      'Controla una persiana, toldo o puerta de garaje en Home Assistant.',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la entidad cover (ej: "cover.persiana_salon")', required: true },
      action: { type: 'string', description: '"open" para abrir, "close" para cerrar, "stop" para detener', required: true },
    },
  },
  {
    name: 'ha_activate_scene',
    description:
      'Activa una escena de Home Assistant (ej: "Modo cine", "Noche", "Buenos días").',
    parameters: {
      entity_id: { type: 'string', description: 'ID de la escena (ej: "scene.modo_cine")', required: true },
    },
  },
  {
    name: 'ha_call_service',
    description:
      'Llama a cualquier servicio de Home Assistant directamente. Usa esto para acciones avanzadas no cubiertas por las herramientas específicas (como ejecutar scripts, triggers de automatizaciones, notificaciones TTS, etc.).',
    parameters: {
      domain: { type: 'string', description: 'Dominio del servicio (ej: "script", "automation", "tts", "notify")', required: true },
      service: { type: 'string', description: 'Nombre del servicio (ej: "turn_on", "trigger", "speak")', required: true },
      data: { type: 'string', description: 'Datos JSON del servicio (ej: \'{"entity_id": "script.regar_jardin"}\')', required: false },
    },
  },

  // ── Skills ───────────────────────────────────────────────────────────────
  {
    name: 'create_skill',
    description:
      'Crea una nueva habilidad (Skill) para el agente. Las habilidades son módulos reutilizables que definen instrucciones especializadas, integraciones MCP y triggers para activación automática. Se guardan como archivos .md con formato YAML frontmatter. Úsala cuando el usuario pida "aprende a hacer X" o "crea una habilidad para Y".',
    parameters: {
      name: { type: 'string', description: 'Nombre de la habilidad (ej: "Análisis financiero", "Monitor de precios")', required: true },
      description: { type: 'string', description: 'Descripción breve de qué hace la habilidad', required: true },
      instructions: { type: 'string', description: 'Instrucciones detalladas en Markdown que el agente seguirá cuando esta habilidad esté activa. Define pasos, reglas y flujos de trabajo.', required: true },
      tags: { type: 'string', description: 'Etiquetas separadas por comas (ej: "finanzas,análisis,stocks")', required: false },
      triggers: { type: 'string', description: 'Eventos que activan esta habilidad, separados por comas (ej: "keyword:factura", "webhook:github:push", "keyword:precio")', required: false },
      trigger_conditions: { type: 'string', description: 'Condiciones adicionales para activar (ej: "solo si el importe es mayor a 100€")', required: false },
      priority: { type: 'number', description: 'Prioridad (1-100, mayor = se inyecta primero). Por defecto: 50', required: false },
    },
  },
  {
    name: 'list_skills',
    description:
      'Lista todas las habilidades (Skills) del agente con su estado, descripción, triggers y prioridad.',
    parameters: {},
  },
  {
    name: 'get_skill',
    description:
      'Obtiene los detalles completos de una habilidad, incluyendo sus instrucciones completas.',
    parameters: {
      skill_id: { type: 'string', description: 'ID o nombre de la habilidad', required: true },
    },
  },
  {
    name: 'update_skill',
    description:
      'Actualiza una habilidad existente (instrucciones, triggers, descripción, etc.).',
    parameters: {
      skill_id: { type: 'string', description: 'ID de la habilidad a actualizar', required: true },
      name: { type: 'string', description: 'Nuevo nombre (opcional)', required: false },
      description: { type: 'string', description: 'Nueva descripción (opcional)', required: false },
      instructions: { type: 'string', description: 'Nuevas instrucciones en Markdown (opcional)', required: false },
      tags: { type: 'string', description: 'Nuevas etiquetas separadas por comas (opcional)', required: false },
      triggers: { type: 'string', description: 'Nuevos triggers separados por comas (opcional)', required: false },
      priority: { type: 'number', description: 'Nueva prioridad (opcional)', required: false },
      enabled: { type: 'string', description: '"true" para activar, "false" para desactivar (opcional)', required: false },
    },
  },
  {
    name: 'delete_skill',
    description:
      'Elimina una habilidad del agente por su ID.',
    parameters: {
      skill_id: { type: 'string', description: 'ID de la habilidad a eliminar', required: true },
    },
  },
  {
    name: 'toggle_skill',
    description:
      'Activa o desactiva una habilidad sin eliminarla.',
    parameters: {
      skill_id: { type: 'string', description: 'ID de la habilidad', required: true },
      enabled: { type: 'string', description: '"true" para activar, "false" para desactivar', required: true },
    },
  },

  // ── Event Subscriptions ──────────────────────────────────────────────────
  {
    name: 'subscribe_event',
    description:
      'Crea una suscripción a eventos para activación reactiva del agente. Permite monitorizar webhooks, cambios de estado en Home Assistant, precios, keywords en mensajes, etc. El agente reaccionará automáticamente cuando el evento se detecte.',
    parameters: {
      name: { type: 'string', description: 'Nombre descriptivo (ej: "Monitor precio Bitcoin", "Alerta sensor temperatura")', required: true },
      type: { type: 'string', description: 'Tipo: "webhook", "poll", "keyword", "ha_state", "custom"', required: true },
      event_pattern: { type: 'string', description: 'Patrón del evento (ej: "webhook:github:push", "keyword:urgente", "ha_state:sensor.temperatura")', required: true },
      instruction: { type: 'string', description: 'Qué debe hacer el agente cuando se active este evento', required: true },
      conditions: { type: 'string', description: 'Condiciones adicionales (ej: "solo si la temperatura supera 30°C")', required: false },
      cooldown_minutes: { type: 'number', description: 'Minutos mínimos entre activaciones (por defecto: 5)', required: false },
      poll_interval_minutes: { type: 'number', description: 'Para tipo "poll": intervalo en minutos entre comprobaciones (por defecto: 60)', required: false },
      poll_target: { type: 'string', description: 'Para tipo "poll": URL o comando a comprobar', required: false },
      ha_entity_id: { type: 'string', description: 'Para tipo "ha_state": entity_id de Home Assistant (ej: "sensor.temperature_living_room")', required: false },
      ha_target_state: { type: 'string', description: 'Para tipo "ha_state": estado objetivo (ej: "on", "above_30"). Si se omite, cualquier cambio activa.', required: false },
      keyword: { type: 'string', description: 'Para tipo "keyword": palabra o frase que activa la suscripción', required: false },
    },
  },
  {
    name: 'list_event_subscriptions',
    description:
      'Lista todas las suscripciones de eventos activas e inactivas del agente.',
    parameters: {},
  },
  {
    name: 'cancel_event_subscription',
    description:
      'Cancela/elimina una suscripción de eventos por su ID o nombre.',
    parameters: {
      subscription_id: { type: 'string', description: 'ID o nombre de la suscripción a cancelar', required: true },
    },
  },
  {
    name: 'toggle_event_subscription',
    description:
      'Activa o desactiva una suscripción de eventos sin eliminarla.',
    parameters: {
      subscription_id: { type: 'string', description: 'ID o nombre de la suscripción', required: true },
      enabled: { type: 'string', description: '"true" para activar, "false" para desactivar', required: true },
    },
  },

  // ── Terminal & Code Execution ──────────────────────────────────────────
  {
    name: 'run_terminal_command',
    description:
      'Ejecuta un comando en el terminal/shell del sistema operativo del dispositivo donde corre el agente (Linux, macOS o Windows). REQUIERE aprobación explícita del usuario antes de ejecutarse. Usa esto para tareas de administración del sistema: cambiar ajustes, crear carpetas, instalar paquetes, gestionar archivos, automatizar configuraciones, etc. IMPORTANTE: Si la app corre en Docker, los archivos del host están montados bajo /host/. Para acceder al Desktop de macOS usa /host/Users/<usuario>/Desktop, para Linux /host/home/<usuario>/Desktop. Ejecuta "ls /host/" para descubrir los puntos de montaje disponibles.',
    parameters: {
      command: { type: 'string', description: 'El comando a ejecutar en el terminal (bash/zsh/cmd/powershell)', required: true },
      reason: { type: 'string', description: 'Explicación clara de por qué necesitas ejecutar este comando y qué efecto tendrá', required: true },
      working_directory: { type: 'string', description: 'Directorio de trabajo (opcional, por defecto el home del usuario)', required: false },
      timeout_ms: { type: 'number', description: 'Timeout en milisegundos (opcional, por defecto 30000)', required: false },
    },
  },
  {
    name: 'execute_code',
    description:
      'Crea y ejecuta código en el dispositivo donde corre el agente. REQUIERE aprobación explícita del usuario antes de ejecutarse. Soporta Python, Node.js, Bash y otros lenguajes instalados. Útil para análisis de datos, scripts de automatización, procesamiento de archivos, cálculos complejos, web scraping avanzado, etc.',
    parameters: {
      code: { type: 'string', description: 'El código fuente a ejecutar', required: true },
      language: { type: 'string', description: 'Lenguaje de programación: "python", "node", "bash", "sh", "powershell" (por defecto: "python")', required: false },
      reason: { type: 'string', description: 'Explicación clara de por qué necesitas ejecutar este código y qué resultado esperas', required: true },
      timeout_ms: { type: 'number', description: 'Timeout en milisegundos (opcional, por defecto 60000)', required: false },
    },
  },

  // ── Document Tools ─────────────────────────────────────────────────────

  {
    name: 'read_word',
    description:
      'Lee un archivo Word (.docx) y extrae su contenido de texto, estilos y metadatos. Útil para analizar, resumir o procesar documentos Word que el usuario envíe.',
    parameters: {
      file_path: { type: 'string', description: 'Ruta al archivo .docx a leer', required: true },
    },
  },
  {
    name: 'create_word',
    description:
      'Crea un documento Word (.docx) con contenido estructurado y formato profesional: encabezados, párrafos, listas con viñetas, tablas, negritas, cursivas, subrayado y estilos. Soporta formato de documento completo: alineación (justificado, centrado, etc.), interlineado (1.0, 1.5, 2.0), espaciado entre párrafos en puntos, sangría de primera línea en cm, tamaño de fuente y familia tipográfica. Usa SIEMPRE el parámetro "formatting" para aplicar formato global al documento. Cuando el usuario pida texto justificado, interlineado 1.5, sin separación entre párrafos y con sangría, usa: formatting={"alignment":"justified","lineSpacing":1.5,"spacingBefore":0,"spacingAfter":0,"firstLineIndent":1.25}. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario. NUNCA generes código Python u otro lenguaje para crear documentos; usa SIEMPRE esta herramienta.',
    parameters: {
      file_name: { type: 'string', description: 'Nombre del archivo de salida (ej: "informe.docx")', required: true },
      content: { type: 'string', description: 'JSON array de bloques de contenido. Cada bloque: {"type":"heading"|"paragraph"|"bullet"|"table", "text":"...", "level":1-6, "bold":true/false, "italic":true/false, "underline":true/false, "style":"...", "rows":[["c1","c2"],["c3","c4"]], "alignment":"justified", "lineSpacing":1.5, "spacingBefore":0, "spacingAfter":0, "firstLineIndent":1.25, "fontSize":12, "fontFamily":"Arial"}. Las propiedades de formato por bloque sobrescriben las del documento.', required: true },
      formatting: { type: 'string', description: 'JSON objeto con formato global del documento (se aplica a TODOS los párrafos salvo que el bloque lo sobrescriba). Campos: {"alignment":"left"|"center"|"right"|"justified", "lineSpacing":1.5, "spacingBefore":0, "spacingAfter":0, "firstLineIndent":1.25, "fontSize":12, "fontFamily":"Arial"}. Ejemplo para formato académico: {"alignment":"justified","lineSpacing":1.5,"spacingBefore":0,"spacingAfter":0,"firstLineIndent":1.25,"fontSize":12,"fontFamily":"Times New Roman"}', required: false },
    },
  },
  {
    name: 'edit_word',
    description:
      'Edita un documento Word (.docx) existente: reemplazar texto, añadir párrafos, y aplicar formato global (alineación, interlineado, espaciado, sangría) a todo el documento. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario.',
    parameters: {
      source_file_path: { type: 'string', description: 'Ruta al archivo Word original', required: true },
      output_file_name: { type: 'string', description: 'Nombre del archivo de salida', required: true },
      operations: { type: 'string', description: 'JSON array de operaciones. Cada una: {"type":"replace_text"|"append_paragraph"|"set_formatting", "find":"texto a buscar", "replace":"texto nuevo", "text":"párrafo a añadir", "bold":true/false, "italic":true/false, "formatting":{"alignment":"justified","lineSpacing":1.5,"spacingBefore":0,"spacingAfter":0,"firstLineIndent":1.25}}', required: true },
    },
  },
  {
    name: 'read_pdf',
    description:
      'Lee un archivo PDF y extrae su texto, número de páginas y metadatos (título, autor, asunto). Útil para analizar, resumir o procesar documentos PDF.',
    parameters: {
      file_path: { type: 'string', description: 'Ruta al archivo PDF a leer', required: true },
    },
  },
  {
    name: 'create_pdf',
    description:
      'Crea un documento PDF con texto, encabezados, comentarios/anotaciones, imágenes y saltos de página. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario. NUNCA generes código Python u otro lenguaje para crear documentos; usa SIEMPRE esta herramienta.',
    parameters: {
      file_name: { type: 'string', description: 'Nombre del archivo de salida (ej: "informe.pdf")', required: true },
      content: { type: 'string', description: 'JSON array de bloques. Cada bloque: {"type":"heading"|"text"|"comment"|"page_break"|"image", "text":"...", "fontSize":12, "bold":true/false, "imageBase64":"...", "width":200, "height":150}', required: true },
    },
  },
  {
    name: 'annotate_pdf',
    description:
      'Añade anotaciones, comentarios y marcas a un PDF existente. Permite añadir texto en posiciones específicas de páginas concretas con colores personalizados. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario.',
    parameters: {
      source_file_path: { type: 'string', description: 'Ruta al archivo PDF original', required: true },
      output_file_name: { type: 'string', description: 'Nombre del archivo PDF de salida', required: true },
      annotations: { type: 'string', description: 'JSON array de anotaciones. Cada una: {"page":1, "x":50, "y":700, "text":"Comentario", "fontSize":10, "color":"red"|"blue"|"green"|"orange"|"black"}', required: true },
    },
  },
  {
    name: 'create_powerpoint',
    description:
      'Crea una presentación PowerPoint (.pptx) con diapositivas que incluyen: títulos, subtítulos, contenido de texto, viñetas, notas del presentador, imágenes, diseño a dos columnas, colores de fondo y fuente. PUEDE buscar imágenes en internet con web_search y pegarlas en las diapositivas usando imageBase64. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario. NUNCA generes código Python u otro lenguaje; usa SIEMPRE esta herramienta.',
    parameters: {
      file_name: { type: 'string', description: 'Nombre del archivo (ej: "presentacion.pptx")', required: true },
      slides: { type: 'string', description: 'JSON array de slides. Cada slide: {"title":"...", "subtitle":"...", "content":"...", "notes":"Notas del presentador", "layout":"title"|"content"|"section"|"blank"|"two_column", "bulletPoints":["..."], "leftColumn":"...", "rightColumn":"...", "backgroundColor":"#FFFFFF", "fontColor":"363636", "images":[{"base64":"...", "x":1, "y":1.5, "w":4, "h":3, "caption":"..."}]}', required: true },
      title: { type: 'string', description: 'Título de la presentación (metadato)', required: false },
      author: { type: 'string', description: 'Autor de la presentación (metadato)', required: false },
      subject: { type: 'string', description: 'Asunto de la presentación (metadato)', required: false },
    },
  },
  {
    name: 'edit_powerpoint',
    description:
      'Edita una presentación PowerPoint (.pptx) existente: cambiar notas del presentador, reemplazar texto en diapositivas y modificar títulos. Ideal para actualizar presentaciones ya creadas sin recrearlas desde cero. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario.',
    parameters: {
      source_file_path: { type: 'string', description: 'Ruta al archivo PowerPoint original', required: true },
      output_file_name: { type: 'string', description: 'Nombre del archivo de salida', required: true },
      operations: { type: 'string', description: 'JSON array de operaciones. Cada una: {"type":"set_notes"|"replace_text"|"set_title", "slide":1, "notes":"Nuevas notas del presentador", "find":"texto a buscar", "replace":"texto nuevo", "title":"Nuevo título"}. El campo "slide" es el número de diapositiva (empezando en 1).', required: true },
    },
  },
  {
    name: 'read_excel',
    description:
      'Lee un archivo Excel (.xlsx) y extrae las hojas con sus nombres, encabezados, datos, número de filas y columnas. Útil para analizar, procesar o transformar datos de hojas de cálculo.',
    parameters: {
      file_path: { type: 'string', description: 'Ruta al archivo .xlsx a leer', required: true },
    },
  },
  {
    name: 'create_excel',
    description:
      'Crea un archivo Excel (.xlsx) con múltiples hojas, encabezados formateados, datos, fórmulas, anchos de columna personalizados y autofiltro. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario. NUNCA generes código Python u otro lenguaje; usa SIEMPRE esta herramienta.',
    parameters: {
      file_name: { type: 'string', description: 'Nombre del archivo (ej: "datos.xlsx")', required: true },
      sheets: { type: 'string', description: 'JSON array de hojas. Cada hoja: {"name":"Hoja1", "headers":["Col1","Col2"], "rows":[["val1","val2"]], "columnWidths":[15,20], "headerStyle":{"bold":true,"backgroundColor":"4472C4","fontColor":"FFFFFF"}, "formulas":[{"cell":"C2","formula":"SUM(A2:B2)"}]}', required: true },
      author: { type: 'string', description: 'Autor del archivo (metadato)', required: false },
    },
  },
  {
    name: 'edit_excel',
    description:
      'Edita un archivo Excel (.xlsx) existente: modificar celdas, añadir/eliminar filas, aplicar fórmulas, añadir/renombrar hojas. Devuelve un enlace de descarga que DEBES incluir tal cual en tu respuesta al usuario.',
    parameters: {
      source_file_path: { type: 'string', description: 'Ruta al archivo Excel original', required: true },
      output_file_name: { type: 'string', description: 'Nombre del archivo de salida', required: true },
      operations: { type: 'string', description: 'JSON array de operaciones. Cada una: {"sheet":"Hoja1"|0, "type":"set_cell"|"add_row"|"delete_row"|"set_formula"|"add_sheet"|"rename_sheet", "cell":"A1", "value":"...", "row":["v1","v2"], "rowIndex":5, "formula":"SUM(A1:A10)", "sheetName":"Nueva", "newName":"Renombrada"}', required: true },
    },
  },
];

// ---------------------------------------------------------------------------
// Native tool schemas + human-readable prompt section
// ---------------------------------------------------------------------------

const normalizeJsonSchemaType = (value: string): string => {
  const lowered = String(value || '').trim().toLowerCase();
  if (['string', 'number', 'integer', 'boolean', 'object', 'array'].includes(lowered)) {
    return lowered;
  }
  return 'string';
};

const buildToolJsonSchema = (tool: ToolDefinition): Record<string, unknown> => {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  Object.entries(tool.parameters).forEach(([name, descriptor]) => {
    properties[name] = {
      type: normalizeJsonSchemaType(descriptor.type),
      description: descriptor.description,
    };
    if (descriptor.required) required.push(name);
  });

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
    additionalProperties: false,
  };

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
};

const BUILT_IN_NATIVE_TOOLS: NativeFunctionTool[] = AGENT_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: buildToolJsonSchema(tool),
}));

const NATIVE_TOOLS_BY_MCP_REF = new WeakMap<MCPToolDefinition[], NativeFunctionTool[]>();

export function buildNativeToolDefinitions(mcpTools?: MCPToolDefinition[]): NativeFunctionTool[] {
  if (!mcpTools || mcpTools.length === 0) {
    return BUILT_IN_NATIVE_TOOLS;
  }

  const cached = NATIVE_TOOLS_BY_MCP_REF.get(mcpTools);
  if (cached) {
    return cached;
  }

  const builtInTools = [...BUILT_IN_NATIVE_TOOLS];

  for (const mcpTool of mcpTools) {
    builtInTools.push({
      name: mcpTool.qualifiedName,
      description: `[MCP:${mcpTool.serverId}] ${mcpTool.description}`,
      parameters: mcpTool.inputSchema,
    });
  }

  NATIVE_TOOLS_BY_MCP_REF.set(mcpTools, builtInTools);
  return builtInTools;
}

export function buildToolsPrompt(
  languageOrMcpTools?: 'es' | 'en' | MCPToolDefinition[],
  maybeMcpTools?: MCPToolDefinition[],
  runtimeOptions?: {
    fastToolsPrompt?: boolean;
    compactToolsPrompt?: boolean;
    maxMcpToolsInPrompt?: number;
  }
): string {
  const language: 'es' | 'en' = Array.isArray(languageOrMcpTools)
    ? 'es'
    : (languageOrMcpTools || 'es');
  const mcpTools = Array.isArray(languageOrMcpTools) ? languageOrMcpTools : maybeMcpTools;

  const fastToolsPrompt = runtimeOptions?.fastToolsPrompt === true;
  const compactToolsPrompt = runtimeOptions?.compactToolsPrompt !== false;
  const maxMcpToolsInPrompt = Math.max(
    0,
    Number(runtimeOptions?.maxMcpToolsInPrompt ?? (fastToolsPrompt ? 12 : 40))
  );
  const mcpToolsForPrompt = (() => {
    if (!mcpTools || mcpTools.length === 0 || maxMcpToolsInPrompt <= 0) return [] as MCPToolDefinition[];
    if (mcpTools.length <= maxMcpToolsInPrompt) return mcpTools;

    const byServer = new Map<string, MCPToolDefinition[]>();
    for (const tool of mcpTools) {
      const bucket = byServer.get(tool.serverId);
      if (bucket) {
        bucket.push(tool);
      } else {
        byServer.set(tool.serverId, [tool]);
      }
    }

    const serverIds = Array.from(byServer.keys()).sort();
    const selected: MCPToolDefinition[] = [];
    let cursor = 0;
    while (selected.length < maxMcpToolsInPrompt && serverIds.length > 0) {
      const serverId = serverIds[cursor % serverIds.length];
      const bucket = byServer.get(serverId);
      if (bucket && bucket.length > 0) {
        const next = bucket.shift();
        if (next) selected.push(next);
      }
      cursor += 1;
      if (cursor > serverIds.length * (mcpTools.length + 1)) break;
    }
    return selected;
  })();

  if (fastToolsPrompt) {
    const fastHeader = language === 'es'
      ? `Usa function calling nativo. No escribas XML/JSON simulando tool-calls en texto visible.`
      : `Use native function calling. Do not write XML/JSON simulating tool calls in user-visible text.`;

    const fastPolicy = language === 'es'
      ? [
          `Reglas críticas:`,
          `- Si faltan datos críticos, pregunta solo lo mínimo necesario.`,
          `- Para acciones sensibles/irreversibles (correo, mensajería, borrados, compras, terceros), muestra borrador final y pide confirmación explícita.`,
          `- Nunca afirmes acciones completadas sin tool call real.`,
          `- Si una tool falla, explica breve y pide lo faltante.`,
          `- Recordatorio único: set_reminder. Recurrente: schedule_task.`,
          `- Si hay múltiples candidatos para editar/eliminar, muestra IDs y confirma.`,
        ].join('\n')
      : [
          `Critical rules:`,
          `- Ask only the minimum required when critical data is missing.`,
          `- For sensitive/irreversible actions (email, messaging, deletions, purchases, third-party actions), show final draft and ask for explicit confirmation.`,
          `- Never claim completion without a real tool call.`,
          `- If a tool fails, explain briefly and request missing input.`,
          `- One-time reminder: set_reminder. Recurring: schedule_task.`,
          `- If multiple update/delete candidates exist, show IDs and confirm.`,
        ].join('\n');

    const builtInLine = AGENT_TOOLS.map((tool) => tool.name).join(', ');

    return `${fastHeader}\n\n${fastPolicy}\n\n${language === 'es' ? 'Tools internas' : 'Built-in tools'}:\n${builtInLine}${mcpTools && mcpTools.length > 0 ? `\n\n${language === 'es' ? 'Tools MCP conectadas' : 'Connected MCP tools'}:\n${mcpToolsForPrompt
      .map((t) => `- ${t.qualifiedName}`)
      .join('\n')}${mcpTools.length > maxMcpToolsInPrompt
        ? (language === 'es'
          ? `\n- ... y ${mcpTools.length - maxMcpToolsInPrompt} más.`
          : `\n- ... and ${mcpTools.length - maxMcpToolsInPrompt} more.`)
        : ''}` : ''}`;
  }

  const toolDescriptions = compactToolsPrompt
    ? AGENT_TOOLS.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')
    : AGENT_TOOLS.map((tool) => {
      const params = Object.entries(tool.parameters)
        .map(([key, val]) => `    - ${key} (${val.type}${val.required ? (language === 'es' ? ', requerido' : ', required') : (language === 'es' ? ', opcional' : ', optional')}): ${val.description}`)
        .join('\n');
      return `- ${tool.name}: ${tool.description}\n${params ? `  ${language === 'es' ? 'Parámetros' : 'Parameters'}:\n${params}` : `  ${language === 'es' ? 'Sin parámetros' : 'No parameters'}`}`;
    }).join('\n\n');

  const header = language === 'es'
    ? `
Tienes acceso a herramientas con function calling nativo.
Cuando necesites una herramienta, llama la función directamente usando el canal nativo de tool/function calling.
NUNCA escribas XML/JSON simulando tool calls en el texto visible al usuario.
Tu texto al usuario debe ser lenguaje natural; las llamadas de herramientas van por el canal nativo.
`
    : `
You have access to tools via native function calling.
When you need a tool, call it directly through the native tool/function calling channel.
NEVER write XML/JSON that simulates tool calls in user-visible text.
User-visible text must be natural language; tool calls must go through the native channel.
`;

  const policy = language === 'es'
    ? `
DISCIPLINA OPERATIVA:
- Sé proactivo, pero metódico: ejecuta herramientas cuando aporten valor real.
- Si faltan datos críticos, pregunta primero (máximo foco, preguntas concretas).
- Para acciones con terceros o sensibles (mensajes, correo, publicaciones, compras, borrados, cambios irreversibles): requiere confirmación explícita.
- Antes de ejecutar una acción sensible, muestra borrador/resumen final y pregunta: "¿Confirmas?".
- No afirmes acciones completadas sin tool call real.
- Si una herramienta falla, explica breve, propone alternativa y pide lo faltante.
- Si el usuario pide agenda de un día/semana, calcula el rango y usa list_calendar_events.
- Si el usuario pide cómo prepararse para un evento, primero recupera el evento y luego da un plan accionable.
- Si al editar/eliminar hay varios eventos candidatos, pide aclaración con los IDs en vez de asumir.

PROTOCOLO OBLIGATORIO — ANÁLISIS FINANCIERO DE EMPRESAS:
- Si el usuario pide análisis financiero de una empresa/acción, ejecuta SIEMPRE este flujo con tool calls reales.
- 1) Identificación del activo: usa búsqueda web para confirmar nombre oficial, ticker y mercado correcto.
- Si hay ambigüedad de ticker/mercado (ADR, múltiples bolsas o mismo nombre), pregunta de forma proactiva cuál mercado quiere el usuario antes de continuar.
- Regla estricta: cuando el usuario mencione empresas por nombre (sin ticker/mercado explícito para cada una), pide confirmación de ticker+mercado de cada activo ANTES de ejecutar herramientas.
- 2) Contexto reciente: busca noticias recientes relevantes (resultados, guidance, litigios, regulación, M&A) y resume impactos potenciales en precio.
- 3) Análisis técnico externo: consulta fuentes técnicas y extrae tendencia, soportes, resistencias, volumen, RSI/MACD u otros niveles clave.
- 4) Datos financieros con yfinance: usa la librería Python yfinance para descargar histórico de precios y métricas fundamentales (PER, EPS, ingresos, deuda, crecimiento, márgenes, etc.).
- 5) Análisis: entrega análisis fundamental + técnico basado en los datos históricos descargados.
- 6) Informe final obligatorio: resumen fundamental breve, resumen técnico breve y escenarios de corto/medio/largo plazo.
- 7) Para cada horizonte (corto/medio/largo): incluye posible rango de entrada, posible rango de salida y nivel de riesgo estimado.
- Evita afirmaciones categóricas y recuerda explícitamente que NO constituye asesoramiento financiero.
- Si no hay capacidad para ejecutar Python yfinance en el entorno del agente, indícalo claramente y pide habilitar esa capacidad antes de concluir el análisis.

EJEMPLO DE RECOGIDA DE DATOS (correo/mensaje):
- Pide destinatario, asunto/título y contenido.
- Luego muestra vista previa final.
- Ejecuta solo tras confirmación explícita del usuario.
`
    : `
OPERATING DISCIPLINE:
- Be proactive but methodical: execute tools when they add real value.
- If critical data is missing, ask first (focused, targeted questions).
- For third-party or sensitive actions (messages, email, publishing, purchases, deletions, irreversible changes): require explicit confirmation.
- Before sensitive execution, show a final draft/summary and ask: "Do you confirm?".
- Never claim completion without a real tool call.
- If a tool fails, explain briefly, suggest an alternative, and ask for the missing input.

MANDATORY PROTOCOL — COMPANY FINANCIAL ANALYSIS:
- If the user requests a company/stock financial analysis, ALWAYS execute this flow using real tool calls.
- 1) Asset identification: use web search to confirm official company name, correct ticker, and exchange/market.
- If ticker/market is ambiguous (ADRs, multiple listings, same-name companies), proactively ask which market the user wants before continuing.
- Strict rule: when the user mentions companies by name (without explicit ticker/market for each one), ask for ticker+market confirmation for every asset BEFORE running tools.
- 2) Recent context: collect recent relevant news (earnings, guidance, litigation, regulation, M&A) and summarize potential price impact.
- 3) External technical analysis: consult technical-analysis sources and extract trend, support/resistance, volume, RSI/MACD, and key levels.
- 4) Financial data with yfinance: use the Python yfinance library to download historical prices and key fundamentals (P/E, EPS, revenue, debt, growth, margins, etc.).
- 5) Analysis: provide both fundamental analysis and technical analysis based on downloaded historical data.
- 6) Required final report: short fundamental summary, short technical summary, and short/medium/long-term scenarios.
- 7) For each horizon (short/medium/long): include possible entry range, possible exit range, and estimated risk level.
- Avoid categorical claims and explicitly remind that this is NOT financial advice.
- If Python yfinance execution is not available in the agent environment, state it clearly and request enabling that capability before concluding the analysis.

DATA COLLECTION EXAMPLE (email/message):
- Ask for recipient, subject/title, and body.
- Then show the final preview.
- Execute only after explicit user confirmation.
`;

  const persistentData = language === 'es'
    ? `
HERRAMIENTAS DE DATOS PERSISTENTES:
- Notas: create_note, get_notes, search_notes, update_note, delete_note.
- Listas: create_list, get_lists, get_list, add_to_list, remove_from_list, check_list_item, delete_list, update_list_item, get_pending_tasks.
- Recordatorios: set_reminder, cancel_reminder, postpone_reminder, list_reminders.
- Tareas recurrentes: schedule_task, list_scheduled_tasks, remove_scheduled_task, toggle_scheduled_task.
- Gastos: add_expense, list_expenses, expense_summary, delete_expense, export_expenses.
- Calendario: create_calendar_event, list_calendar_events, search_calendar_events, update_calendar_event, delete_calendar_event.
- Gmail: list_emails, read_email, search_emails, send_email, reply_email, get_unread_email_count.
- Memoria: remember.
- Memoria de Trabajo: update_working_memory, get_working_memory, clear_working_memory. (Bloc de notas temporal para anotar pasos intermedios en tareas complejas).
- Telegram: send_telegram_message, send_telegram_buttons.
- Archivos: process_telegram_file, transcribe_telegram_audio, analyze_telegram_image.
- Deshacer: undo_last_action.
- Ubicación: set_location_reminder, list_location_reminders, cancel_location_reminder, check_location.
- Home Assistant: ha_get_entities, ha_get_state, ha_search_entities, ha_turn_on, ha_turn_off, ha_toggle, ha_set_climate, ha_cover_control, ha_activate_scene, ha_call_service.
- Habilidades (Skills): create_skill, list_skills, get_skill, update_skill, delete_skill, toggle_skill. (Módulos reutilizables con instrucciones especializadas, triggers y MCP pre-configurado. El agente puede crear skills por sí solo cuando el usuario lo pida.)
- Suscripciones de Eventos: subscribe_event, list_event_subscriptions, cancel_event_subscription, toggle_event_subscription. (Proactividad event-driven: monitoriza webhooks, keywords, cambios de estado HA, comprobaciones periódicas.)
`
    : `
PERSISTENT DATA TOOLS:
- Notes: create_note, get_notes, search_notes, update_note, delete_note.
- Lists: create_list, get_lists, get_list, add_to_list, remove_from_list, check_list_item, delete_list, update_list_item, get_pending_tasks.
- Reminders: set_reminder, cancel_reminder, postpone_reminder, list_reminders.
- Recurring tasks: schedule_task, list_scheduled_tasks, remove_scheduled_task, toggle_scheduled_task.
- Expenses: add_expense, list_expenses, expense_summary, delete_expense, export_expenses.
- Calendar: create_calendar_event, list_calendar_events, search_calendar_events, update_calendar_event, delete_calendar_event.
- Gmail: list_emails, read_email, search_emails, send_email, reply_email, get_unread_email_count.
- Memory: remember.
- Working Memory: update_working_memory, get_working_memory, clear_working_memory. (Scratch pad for intermediate steps in complex tasks).
- Telegram: send_telegram_message, send_telegram_buttons.
- Files: process_telegram_file, transcribe_telegram_audio, analyze_telegram_image.
- Undo: undo_last_action.
- Location: set_location_reminder, list_location_reminders, cancel_location_reminder, check_location.
- Home Assistant: ha_get_entities, ha_get_state, ha_search_entities, ha_turn_on, ha_turn_off, ha_toggle, ha_set_climate, ha_cover_control, ha_activate_scene, ha_call_service.
- Skills: create_skill, list_skills, get_skill, update_skill, delete_skill, toggle_skill. (Reusable modules with specialized instructions, triggers, and pre-configured MCP. The agent can create skills on its own when the user requests it.)
- Event Subscriptions: subscribe_event, list_event_subscriptions, cancel_event_subscription, toggle_event_subscription. (Event-driven proactivity: monitor webhooks, keywords, HA state changes, periodic checks.)
`;

  const usageRules = language === 'es'
    ? `
REGLAS DE USO:
- Recordatorio de una sola vez: set_reminder (no schedule_task).
- Tarea recurrente: schedule_task.
- Si hay ambigüedad, prioriza preguntas concretas en texto.
- Usa send_telegram_buttons solo cuando el usuario necesite elegir explícitamente entre 2-4 opciones claras en Telegram.
- Si hay múltiples candidatos para actualizar/eliminar, muestra IDs y pide confirmación.
- Al terminar, entrega recibo claro: qué hiciste, resultado e ID si aplica.

Herramientas disponibles:
`
    : `
USAGE RULES:
- One-time reminder: set_reminder (not schedule_task).
- Recurring task: schedule_task.
- If ambiguous, prefer targeted text questions first.
- Use send_telegram_buttons only when the user must explicitly pick between 2-4 clear Telegram options.
- If multiple update/delete candidates exist, show IDs and request confirmation.
- After execution, provide a clear receipt: what was done, result, and ID when applicable.

Available tools:
`;

  const hostMountsSection = getHostMountsPromptSection();

  return `${header}
${policy}
${persistentData}
${hostMountsSection}
${usageRules}
${toolDescriptions}
${mcpTools && mcpTools.length > 0 ? `

${language === 'es' ? 'Herramientas MCP externas (de servidores MCP conectados)' : 'External MCP tools (from connected MCP servers)'}:
${mcpToolsForPrompt
  .map((t) => `- ${t.qualifiedName}: [MCP:${t.serverId}] ${t.description}`)
  .join('\n')}
${mcpTools.length > maxMcpToolsInPrompt
  ? (language === 'es'
    ? `\n- ... y ${mcpTools.length - maxMcpToolsInPrompt} herramientas MCP más (omitidas para ahorrar contexto).`
    : `\n- ... and ${mcpTools.length - maxMcpToolsInPrompt} more MCP tools (omitted to save context).`)
  : ''}` : ''}
`;
}

// ---------------------------------------------------------------------------
// Tool Execution
// ---------------------------------------------------------------------------

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BROWSE_MAX_WAIT_MS = 20_000;
const BROWSE_CONTENT_MAX_CHARS = 6000;

interface WebsiteCredential {
  site: string;
  username: string;
  password: string;
}

interface BrowseWebsiteOptions {
  action?: string;
  selector?: string;
  value?: string;
  waitForMs?: number;
  credential?: WebsiteCredential | null;
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const clipText = (value: string, maxChars = BROWSE_CONTENT_MAX_CHARS): string => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}... [contenido truncado]`;
};

const extractReadableTextFromHtml = (html: string): { title: string; text: string } => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : '';

  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');

  const mainMatch = text.match(/<main[\s\S]*?<\/main>/i) || text.match(/<article[\s\S]*?<\/article>/i);
  if (mainMatch) {
    text = mainMatch[0];
  }

  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = normalizeText(text);
  text = clipText(text);

  return { title, text };
};

const toHost = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const direct = new URL(trimmed);
    return direct.host.toLowerCase();
  } catch {
    try {
      const withProtocol = new URL(`https://${trimmed.replace(/^\/+/, '')}`);
      return withProtocol.host.toLowerCase();
    } catch {
      return trimmed.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
    }
  }
};

const matchCredentialForTarget = (
  credentials: Array<{ site: string; username: string; password: string }>,
  target: string
): WebsiteCredential | null => {
  const targetHost = toHost(target);
  if (!targetHost) return null;

  for (const credential of credentials) {
    if (!credential?.site || !credential.username) continue;
    const credentialHost = toHost(credential.site);
    if (!credentialHost) continue;

    if (
      credentialHost === targetHost ||
      targetHost.endsWith(`.${credentialHost}`) ||
      credentialHost.endsWith(`.${targetHost}`)
    ) {
      return {
        site: credential.site,
        username: credential.username,
        password: credential.password || '',
      };
    }
  }

  return null;
};

const loadPlaywright = (): any | null => {
  try {
    // Optional dependency: only used when available.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('playwright');
  } catch {
    return null;
  }
};

async function executeWebSearch(query: string): Promise<string> {
  try {
    // Use DuckDuckGo HTML search (no API key needed)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }

    const html = await response.text();
    
    // Parse results from DuckDuckGo HTML
    const results: string[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    
    let match;
    const urls: string[] = [];
    const titles: string[] = [];
    
    while ((match = resultRegex.exec(html)) !== null && titles.length < 8) {
      const url = decodeURIComponent(match[1].replace(/.*uddg=/, '').replace(/&.*$/, ''));
      const title = match[2].replace(/<[^>]*>/g, '').trim();
      if (title && url && !url.includes('duckduckgo.com')) {
        urls.push(url);
        titles.push(title);
      }
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < 8) {
      const snippet = match[1].replace(/<[^>]*>/g, '').trim();
      if (snippet) snippets.push(snippet);
    }

    for (let i = 0; i < titles.length; i++) {
      results.push(`${i + 1}. **${titles[i]}**\n   URL: ${urls[i] || 'N/A'}\n   ${snippets[i] || ''}`);
    }

    if (results.length === 0) {
      // Fallback: try a simpler extraction
      const linkRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]+)<\/a>/gi;
      let fallbackCount = 0;
      while ((match = linkRegex.exec(html)) !== null && fallbackCount < 5) {
        const url = match[1];
        const text = match[2].trim();
        if (text.length > 10 && !url.includes('duckduckgo.com')) {
          results.push(`${fallbackCount + 1}. ${text}\n   URL: ${url}`);
          fallbackCount++;
        }
      }
    }

    return results.length > 0
      ? `Resultados de búsqueda para "${query}":\n\n${results.join('\n\n')}`
      : `No se encontraron resultados para "${query}". Intenta con otros términos de búsqueda.`;
  } catch (error: any) {
    return `Error al buscar: ${error.message}. Intenta de nuevo.`;
  }
}

function normalizeMediaLookupQuery(rawQuery: string): string {
  const original = String(rawQuery || '').trim();
  if (!original) return '';

  const cleaned = original
    .replace(/["“”'`]+/g, ' ')
    .replace(/^(?:oye\s+)?(?:busca(?:me)?|encuentra(?:me)?|quiero(?:\s+ver)?|pon(?:me)?|descarga(?:me|r)?|añade?|agrega?|find|search)\s+/i, '')
    .replace(/^(?:la|el|una|un|pel[ií]cula|peli|serie|show|movie)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || original;
}

function extractMediaIdsFromText(text: string): { imdbId?: string; tmdbId?: number; tvdbId?: number } {
  const source = String(text || '');
  const imdbMatch = source.match(/\b(tt\d{7,10})\b/i);
  const tmdbMatch = source.match(/(?:themoviedb\.org\/movie\/|\btmdb\s*[:#-]?\s*)(\d{2,})/i);
  const tvdbMatch = source.match(/(?:thetvdb\.com\/(?:series|dereferrer\/series)\/|\btvdb\s*[:#-]?\s*)(\d{2,})/i);

  const ids: { imdbId?: string; tmdbId?: number; tvdbId?: number } = {};
  if (imdbMatch) ids.imdbId = imdbMatch[1];
  if (tmdbMatch) ids.tmdbId = parseInt(tmdbMatch[1], 10);
  if (tvdbMatch) ids.tvdbId = parseInt(tvdbMatch[1], 10);
  return ids;
}

async function resolveMovieByInternetId(
  config: radarr.RadarrConfig,
  query: string
): Promise<radarr.RadarrSearchResult | null> {
  const normalized = normalizeMediaLookupQuery(query);
  if (!normalized) return null;
  const webResults = await executeWebSearch(`${normalized} imdb tmdb`);
  const ids = extractMediaIdsFromText(webResults);
  if (!ids.imdbId && !ids.tmdbId) return null;
  return radarr.lookupMovieByExternalId(config, { imdbId: ids.imdbId, tmdbId: ids.tmdbId });
}

async function resolveSeriesByInternetId(
  config: sonarr.SonarrConfig,
  query: string
): Promise<sonarr.SonarrSearchResult | null> {
  const normalized = normalizeMediaLookupQuery(query);
  if (!normalized) return null;
  const webResults = await executeWebSearch(`${normalized} tvdb imdb`);
  const ids = extractMediaIdsFromText(webResults);
  if (!ids.tvdbId && !ids.imdbId) return null;
  return sonarr.lookupSeriesByExternalId(config, { tvdbId: ids.tvdbId, imdbId: ids.imdbId });
}

async function executeFetchWebpage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
      return `La URL devuelve contenido tipo "${contentType}" que no es texto legible.`;
    }

    const html = await response.text();
    const parsed = extractReadableTextFromHtml(html);

    return `Página: ${parsed.title || url}\nURL: ${url}\n\nContenido:\n${parsed.text || 'No se pudo extraer contenido de texto.'}`;
  } catch (error: any) {
    return `Error al acceder a ${url}: ${error.message}`;
  }
}

async function executeBrowseWebsite(url: string, options: BrowseWebsiteOptions = {}): Promise<string> {
  const action = String(options.action || 'read').trim().toLowerCase();
  const waitForMs = Math.max(0, Math.min(BROWSE_MAX_WAIT_MS, Math.floor(Number(options.waitForMs || 0))));
  const playwright = loadPlaywright();

  if (!playwright) {
    if (action === 'read' || action === 'screenshot') {
      const result = await executeFetchWebpage(url);
      return `[Navegador headless no disponible - modo fetch]\n${result}\n\nNota: para login/click/fill instala Playwright en el servidor ("cd server && npm i playwright").`;
    }
    return 'Navegación interactiva no disponible: instala Playwright en el servidor ("cd server && npm i playwright").';
  }

  let browser: any | null = null;
  let context: any | null = null;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (waitForMs > 0) await page.waitForTimeout(waitForMs);

    if (action === 'click') {
      if (!options.selector) {
        return 'Falta "selector" para action=click.';
      }
      await page.click(options.selector, { timeout: 10_000 });
      await page.waitForTimeout(1200);
    } else if (action === 'fill') {
      if (!options.selector) {
        return 'Falta "selector" para action=fill.';
      }
      await page.fill(options.selector, options.value || '', { timeout: 10_000 });
      await page.waitForTimeout(500);
    } else if (action === 'login') {
      const credential = options.credential;
      if (!credential) {
        return 'No hay credenciales web disponibles para este sitio. Configúralas en permisos del agente.';
      }

      const usernameSelector = options.usernameSelector || 'input[type="email"], input[name="email"], input[name="username"], input[type="text"]';
      const passwordSelector = options.passwordSelector || 'input[type="password"], input[name="password"]';
      const submitSelector = options.submitSelector || 'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Iniciar sesión")';

      await page.locator(usernameSelector).first().fill(credential.username, { timeout: 10_000 });
      await page.locator(passwordSelector).first().fill(credential.password, { timeout: 10_000 });
      await page.locator(submitSelector).first().click({ timeout: 10_000 });
      await page.waitForTimeout(Math.max(1500, waitForMs));
    } else if (action === 'screenshot') {
      const shot = await page.screenshot({ fullPage: true, type: 'png' });
      const currentUrl = page.url();
      const title = await page.title();
      return `Captura generada correctamente.\nURL actual: ${currentUrl}\nTítulo: ${title || '(sin título)'}\nTamaño PNG: ${Math.round(shot.byteLength / 1024)} KB`;
    } else if (action !== 'read') {
      return `Acción "${action}" no soportada para browse_website.`;
    }

    const title = await page.title();
    const currentUrl = page.url();
    const bodyText = await page.evaluate(() => {
      const doc = (globalThis as any).document;
      const text = doc?.body?.innerText;
      return typeof text === 'string' ? text : '';
    });
    const normalized = clipText(normalizeText(bodyText || ''));

    return `Página (headless): ${title || currentUrl}\nURL: ${currentUrl}\nAcción: ${action}\n\nContenido:\n${normalized || 'No se pudo extraer texto visible.'}`;
  } catch (error: any) {
    return `Error al navegar de forma headless en ${url}: ${error.message}`;
  } finally {
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore
      }
    }
  }
}

function executeGetCurrentTime(timezone?: string): string {
  const now = new Date();
  const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const resolvedTimezone = timezone || fallbackTimezone;
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  };
  if (resolvedTimezone) {
    try {
      options.timeZone = resolvedTimezone;
    } catch {
      // Invalid timezone — fall through to system default
    }
  }
  const formatted = now.toLocaleDateString('es-ES', options);
  return `Fecha y hora actual: ${formatted}${resolvedTimezone ? ` (zona horaria configurada: ${resolvedTimezone})` : ''}`;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || '00';
  const asUtc = Date.UTC(
    Number(value('year')),
    Number(value('month')) - 1,
    Number(value('day')),
    Number(value('hour')),
    Number(value('minute')),
    Number(value('second')),
  );
  return (asUtc - date.getTime()) / 60_000;
}

function convertLocalDateTimeInZoneToUtcMs(localDateTime: string, timeZone: string): number | null {
  const normalized = localDateTime.trim().replace(' ', 'T');
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2})(?::(\d{2})(?::(\d{2}))?)?)?$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || '0');
  const minute = Number(match[5] || '0');
  const second = Number(match[6] || '0');

  if (
    !Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
    !Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)
  ) {
    return null;
  }

  const initialUtcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = getTimeZoneOffsetMinutes(new Date(initialUtcGuess), timeZone);
  const adjustedUtc = initialUtcGuess - firstOffset * 60_000;
  const secondOffset = getTimeZoneOffsetMinutes(new Date(adjustedUtc), timeZone);
  return initialUtcGuess - secondOffset * 60_000;
}

function toIsoOrNull(value: unknown, timezone?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const hasExplicitTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);

  if (!hasExplicitTimezone && timezone) {
    try {
      const utcMs = convertLocalDateTimeInZoneToUtcMs(trimmed, timezone);
      if (utcMs !== null && Number.isFinite(utcMs)) {
        return new Date(utcMs).toISOString();
      }
    } catch {
      // fallback to native Date parser
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

// ---------------------------------------------------------------------------
// Calendar tool helper
// ---------------------------------------------------------------------------

function resolveCalendarProvider(
  calendarType: string | undefined,
  config: AgentConfig
): CalendarProvider | null {
  const calConfig = config.calendar;
  if (!calConfig) return null;

  const hasValidGoogle = Boolean(
    calConfig.google
    && String(calConfig.google.clientId || '').trim()
    && String(calConfig.google.clientSecret || '').trim()
    && String(calConfig.google.refreshToken || '').trim()
  );
  const hasValidICloud = Boolean(
    calConfig.icloud
    && String(calConfig.icloud.email || '').trim()
    && String(calConfig.icloud.appSpecificPassword || '').trim()
  );

  const type = (calendarType || '').trim().toLowerCase();

  if (type === 'google' && hasValidGoogle && calConfig.google) {
    return createGoogleCalendarProvider(calConfig.google);
  }
  if (type === 'icloud' && hasValidICloud && calConfig.icloud) {
    return createICloudCalendarProvider(calConfig.icloud);
  }

  // Auto-detect: prefer whichever is configured
  if (hasValidGoogle && calConfig.google) return createGoogleCalendarProvider(calConfig.google);
  if (hasValidICloud && calConfig.icloud) return createICloudCalendarProvider(calConfig.icloud);

  return null;
}

function detectCalendarType(config: AgentConfig, explicit?: string): string {
  if (explicit) return explicit;
  if (
    config.calendar?.google
    && String(config.calendar.google.clientId || '').trim()
    && String(config.calendar.google.clientSecret || '').trim()
    && String(config.calendar.google.refreshToken || '').trim()
  ) return 'google';
  if (
    config.calendar?.icloud
    && String(config.calendar.icloud.email || '').trim()
    && String(config.calendar.icloud.appSpecificPassword || '').trim()
  ) return 'icloud';
  return 'unknown';
}

function formatEventForDisplay(
  event: { id: string; title: string; startTime: string; endTime: string; description?: string; location?: string; allDay?: boolean; calendarType: string },
  timezone?: string,
): string {
  const dateOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  };
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  };
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit', minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  };

  const start = event.allDay
    ? new Date(event.startTime).toLocaleDateString('es-ES', dateOptions)
    : new Date(event.startTime).toLocaleString('es-ES', dateTimeOptions);
  const end = event.allDay
    ? ''
    : ` → ${new Date(event.endTime).toLocaleString('es-ES', timeOptions)}`;

  const parts = [`**${event.title}**`, `📅 ${start}${end}`];
  if (event.location) parts.push(`📍 ${event.location}`);
  if (event.description) parts.push(`📝 ${event.description.slice(0, 120)}${event.description.length > 120 ? '...' : ''}`);
  parts.push(`🔑 ID: ${event.id} (${event.calendarType})`);
  return parts.join('\n   ');
}

function resolveCalendarRange(params: Record<string, any>, timezone?: string): { startDate: string; endDate: string; label: string } {
  const rawStart = params.start_date ?? params.startDate ?? params.start_datetime ?? params.startDateTime ?? params.startdatetime;
  const rawEnd = params.end_date ?? params.endDate ?? params.end_datetime ?? params.endDateTime ?? params.enddatetime;
  const explicitStart = toIsoOrNull(rawStart, timezone);
  const explicitEnd = toIsoOrNull(rawEnd, timezone);
  if (explicitStart && explicitEnd) {
    const start = new Date(explicitStart);
    const end = new Date(explicitEnd);
    if (end.getTime() <= start.getTime()) {
      end.setDate(end.getDate() + 1);
    }
    return { startDate: start.toISOString(), endDate: end.toISOString(), label: `${String(rawStart)} — ${String(rawEnd)}` };
  }

  const rawDate = params.date ?? params.day ?? params.on;
  const singleDate = toIsoOrNull(rawDate, timezone);
  if (singleDate) {
    const start = new Date(singleDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startDate: start.toISOString(), endDate: end.toISOString(), label: `${String(rawDate)}` };
  }

  const rawWeekOf = params.week_of ?? params.weekOf;
  const weekOf = toIsoOrNull(rawWeekOf, timezone);
  if (weekOf) {
    const ref = new Date(weekOf);
    const day = ref.getDay();
    const diffToMonday = (day + 6) % 7;
    const start = new Date(ref);
    start.setDate(ref.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { startDate: start.toISOString(), endDate: end.toISOString(), label: `semana de ${String(rawWeekOf)}` };
  }

  const now = new Date();
  const end = new Date(now.getTime() + 30 * 86_400_000);
  return { startDate: now.toISOString(), endDate: end.toISOString(), label: 'próximos 30 días' };
}

function findCalendarCandidates(
  events: CalendarEvent[],
  matchText: string | undefined
): CalendarEvent[] {
  const query = (matchText || '').trim().toLowerCase();
  if (!query) return events;
  return events.filter((event) => {
    const haystack = [event.title, event.description || '', event.location || ''].join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

function buildCalendarAmbiguityMessage(
  action: 'actualizar' | 'eliminar',
  candidates: CalendarEvent[],
  timezone?: string,
): string {
  const lines = candidates.slice(0, 8).map((event, idx) => `${idx + 1}. ${formatEventForDisplay(event, timezone)}`).join('\n\n');
  const more = candidates.length > 8 ? `\n\n…y ${candidates.length - 8} más.` : '';
  return `⚠️ He encontrado varios eventos para ${action}.\nIndícame el *ID exacto* del evento que quieres ${action}:\n\n${lines}${more}`;
}

const CREATE_EVENT_DEDUP_WINDOW_MS = 2 * 60 * 1000;
const recentCreateCalendarEventCalls = new Map<string, number>();

function normalizeDedupText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildCreateCalendarEventDedupKey(
  userId: string,
  agentId: string,
  calendarType: string,
  params: {
    title: string;
    startTime: string;
    endTime: string;
    description?: string;
    location?: string;
    allDay?: boolean;
  }
): string {
  const title = normalizeDedupText(params.title);
  const start = normalizeDedupText(params.startTime);
  const end = normalizeDedupText(params.endTime);
  const description = normalizeDedupText(params.description || '');
  const location = normalizeDedupText(params.location || '');
  const allDay = params.allDay ? '1' : '0';
  return [userId, agentId, calendarType, title, start, end, description, location, allDay].join('|');
}

function isRecentDuplicateCreateCalendarEvent(dedupKey: string): boolean {
  const now = Date.now();
  const previous = recentCreateCalendarEventCalls.get(dedupKey);
  if (previous && now - previous <= CREATE_EVENT_DEDUP_WINDOW_MS) {
    return true;
  }
  recentCreateCalendarEventCalls.set(dedupKey, now);

  if (recentCreateCalendarEventCalls.size > 1500) {
    for (const [key, timestamp] of recentCreateCalendarEventCalls.entries()) {
      if (now - timestamp > CREATE_EVENT_DEDUP_WINDOW_MS) {
        recentCreateCalendarEventCalls.delete(key);
      }
    }
  }

  return false;
}

async function executeCalendarTool(
  toolName: string,
  params: Record<string, any>,
  context: ToolExecutionContext
): Promise<ToolCallResult> {
  const calType = typeof params.calendar_type === 'string' ? params.calendar_type : undefined;
  const agentTimezone = context.agentConfig.timezone;
  const provider = resolveCalendarProvider(calType, context.agentConfig);

  if (!provider) {
    const hasValidGoogle = Boolean(
      context.agentConfig.calendar?.google
      && String(context.agentConfig.calendar.google.clientId || '').trim()
      && String(context.agentConfig.calendar.google.clientSecret || '').trim()
      && String(context.agentConfig.calendar.google.refreshToken || '').trim()
    );
    const hasValidICloud = Boolean(
      context.agentConfig.calendar?.icloud
      && String(context.agentConfig.calendar.icloud.email || '').trim()
      && String(context.agentConfig.calendar.icloud.appSpecificPassword || '').trim()
    );
    const configured: string[] = [];
    if (hasValidGoogle) configured.push('Google Calendar');
    if (hasValidICloud) configured.push('iCloud Calendar');
    return {
      name: toolName,
      success: false,
      result: '',
      error: configured.length === 0
        ? 'No hay calendarios configurados. Configura Google Calendar (OAuth2) o iCloud (email + contraseña de aplicación) en los ajustes del agente.'
        : `Calendario "${calType}" no está configurado. Disponibles: ${configured.join(', ')}.`,
    };
  }

  const resolvedType = detectCalendarType(context.agentConfig, calType);

  try {
    switch (toolName) {
      case 'create_calendar_event': {
        const title = params.title;
        const startTime = params.start_time;
        const endTime = params.end_time;
        if (!title || !startTime || !endTime) {
          return { name: toolName, success: false, result: '', error: 'Faltan parámetros requeridos (title, start_time, end_time)' };
        }
        const allDay = params.all_day === 'true' || params.all_day === true;

        const normalizedStartTime = toIsoOrNull(startTime, agentTimezone);
        const normalizedEndTime = toIsoOrNull(endTime, agentTimezone);
        if (!normalizedStartTime || !normalizedEndTime) {
          return { name: toolName, success: false, result: '', error: 'Los parámetros "start_time" y "end_time" deben ser fechas ISO válidas.' };
        }

        const dedupKey = buildCreateCalendarEventDedupKey(
          context.userId,
          context.agentId,
          resolvedType,
          {
            title,
            startTime: normalizedStartTime,
            endTime: normalizedEndTime,
            description: params.description,
            location: params.location,
            allDay,
          }
        );
        if (isRecentDuplicateCreateCalendarEvent(dedupKey)) {
          return {
            name: toolName,
            success: true,
            result: `🛡️ Evité crear un evento duplicado en ${resolvedType === 'google' ? 'Google Calendar' : 'iCloud Calendar'}: ya se procesó la misma creación hace unos instantes.`,
          };
        }

        const event = await provider.createEvent({
          title,
          startTime: normalizedStartTime,
          endTime: normalizedEndTime,
          description: params.description || undefined,
          location: params.location || undefined,
          allDay,
        });
        return {
          name: toolName,
          success: true,
          result: `📅 Evento creado en ${resolvedType === 'google' ? 'Google Calendar' : 'iCloud Calendar'}:\n   ${formatEventForDisplay(event, agentTimezone)}`,
        };
      }

      case 'list_calendar_events': {
        const resolvedRange = resolveCalendarRange(params, agentTimezone);
        const maxResults = typeof params.max_results === 'number' ? params.max_results : 25;
        const events = await provider.listEvents(resolvedRange.startDate, resolvedRange.endDate, maxResults);
        if (events.length === 0) {
          return { name: toolName, success: true, result: `No hay eventos en el rango ${resolvedRange.label}.` };
        }
        const eventsList = events.map((e, i) => `${i + 1}. ${formatEventForDisplay(e, agentTimezone)}`).join('\n\n');
        return {
          name: toolName,
          success: true,
          result: `📅 Eventos (${events.length}) en ${resolvedType === 'google' ? 'Google Calendar' : 'iCloud Calendar'}:\n\n${eventsList}`,
        };
      }

      case 'search_calendar_events': {
        const query = params.query;
        if (!query) {
          return { name: toolName, success: false, result: '', error: 'Falta el parámetro "query"' };
        }
        const events = await provider.searchEvents(query, params.start_date, params.end_date);
        if (events.length === 0) {
          return { name: toolName, success: true, result: `No se encontraron eventos que coincidan con "${query}".` };
        }
        const eventsList = events.map((e, i) => `${i + 1}. ${formatEventForDisplay(e, agentTimezone)}`).join('\n\n');
        return {
          name: toolName,
          success: true,
          result: `🔍 Eventos encontrados para "${query}" (${events.length}):\n\n${eventsList}`,
        };
      }

      case 'update_calendar_event': {
        let eventId = typeof params.event_id === 'string' ? params.event_id.trim() : '';
        if (!eventId) {
          const { startDate, endDate, label } = resolveCalendarRange(params, agentTimezone);
          const events = await provider.listEvents(startDate, endDate, 80);
          const candidates = findCalendarCandidates(events, typeof params.match_text === 'string' ? params.match_text : undefined);

          if (candidates.length === 0) {
            return {
              name: toolName,
              success: false,
              result: '',
              error: `No encontré eventos para actualizar en ${label}${params.match_text ? ` que coincidan con "${params.match_text}"` : ''}.`,
            };
          }
          if (candidates.length > 1) {
            return {
              name: toolName,
              success: true,
              result: buildCalendarAmbiguityMessage('actualizar', candidates, agentTimezone),
            };
          }
          eventId = candidates[0].id;
        }

        const updates: Record<string, any> = {};
        if (params.title) updates.title = params.title;
        if (params.start_time) {
          const normalized = toIsoOrNull(params.start_time, agentTimezone);
          if (!normalized) {
            return { name: toolName, success: false, result: '', error: 'El parámetro "start_time" debe ser una fecha ISO válida.' };
          }
          updates.startTime = normalized;
        }
        if (params.end_time) {
          const normalized = toIsoOrNull(params.end_time, agentTimezone);
          if (!normalized) {
            return { name: toolName, success: false, result: '', error: 'El parámetro "end_time" debe ser una fecha ISO válida.' };
          }
          updates.endTime = normalized;
        }
        if (params.description) updates.description = params.description;
        if (params.location) updates.location = params.location;

        const updateSummary = [
          `Calendario: ${resolvedType === 'google' ? 'Google Calendar' : 'iCloud Calendar'}`,
          `Evento objetivo: ${eventId}`,
          `Campos a modificar: ${Object.keys(updates).length > 0 ? Object.keys(updates).join(', ') : 'ninguno detectado'}`,
        ].join('\n');
        const updateApproval = await requestCriticalActionApproval(
          context,
          'Actualizar evento de calendario',
          updateSummary
        );
        if (!updateApproval.approved) {
          return { name: toolName, success: false, result: '', error: updateApproval.error || 'Acción no autorizada' };
        }

        const updated = await provider.updateEvent(eventId, updates);
        if (!updated) {
          return { name: toolName, success: false, result: '', error: `No se encontró el evento con ID "${eventId}"` };
        }
        return {
          name: toolName,
          success: true,
          result: `✅ Evento actualizado:\n   ${formatEventForDisplay(updated, agentTimezone)}`,
        };
      }

      case 'delete_calendar_event': {
        let eventId = typeof params.event_id === 'string' ? params.event_id.trim() : '';
        if (!eventId) {
          const { startDate, endDate, label } = resolveCalendarRange(params, agentTimezone);
          const events = await provider.listEvents(startDate, endDate, 80);
          const candidates = findCalendarCandidates(events, typeof params.match_text === 'string' ? params.match_text : undefined);

          if (candidates.length === 0) {
            return {
              name: toolName,
              success: false,
              result: '',
              error: `No encontré eventos para eliminar en ${label}${params.match_text ? ` que coincidan con "${params.match_text}"` : ''}.`,
            };
          }
          if (candidates.length > 1) {
            return {
              name: toolName,
              success: true,
              result: buildCalendarAmbiguityMessage('eliminar', candidates, agentTimezone),
            };
          }
          eventId = candidates[0].id;
        }

        const deleteSummary = [
          `Calendario: ${resolvedType === 'google' ? 'Google Calendar' : 'iCloud Calendar'}`,
          `Evento a eliminar: ${eventId}`,
          'Tipo de acción: eliminación (irreversible)',
        ].join('\n');
        const deleteApproval = await requestCriticalActionApproval(
          context,
          'Eliminar evento de calendario',
          deleteSummary
        );
        if (!deleteApproval.approved) {
          return { name: toolName, success: false, result: '', error: deleteApproval.error || 'Acción no autorizada' };
        }

        const deleted = await provider.deleteEvent(eventId);
        return {
          name: toolName,
          success: deleted,
          result: deleted ? 'Evento eliminado correctamente del calendario.' : 'No se pudo eliminar el evento.',
          error: deleted ? undefined : 'Evento no encontrado',
        };
      }

      default:
        return { name: toolName, success: false, result: '', error: `Herramienta de calendario desconocida: ${toolName}` };
    }
  } catch (error: any) {
    return { name: toolName, success: false, result: '', error: `Error de calendario: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// Gmail Tool Execution
// ---------------------------------------------------------------------------

function formatEmailForDisplay(msg: { id: string; from: string; subject: string; date: string; snippet: string; isUnread: boolean }): string {
  const unreadMarker = msg.isUnread ? '🔵 ' : '';
  return `${unreadMarker}**${msg.subject}**\n   De: ${msg.from}\n   Fecha: ${msg.date}\n   ID: \`${msg.id}\`\n   ${msg.snippet.slice(0, 120)}${msg.snippet.length > 120 ? '…' : ''}`;
}

async function executeGmailTool(
  toolName: string,
  params: Record<string, any>,
  context: ToolExecutionContext
): Promise<ToolCallResult> {
  const gmailConfig = context.agentConfig.gmail;

  if (!gmailConfig || !gmailConfig.clientId || !gmailConfig.clientSecret || !gmailConfig.refreshToken) {
    return {
      name: toolName,
      success: false,
      result: '',
      error: 'Gmail no está configurado. Configura las credenciales OAuth2 de Gmail en los ajustes del agente (sección Integraciones → Gmail).',
    };
  }

  const provider = createGmailProvider(gmailConfig);

  try {
    switch (toolName) {
      case 'list_emails': {
        const query = typeof params.query === 'string' ? params.query : undefined;
        const maxResults = typeof params.max_results === 'number' ? Math.min(params.max_results, 20) : 10;
        const messages = await provider.listMessages(query, maxResults);
        if (messages.length === 0) {
          return { name: toolName, success: true, result: '📭 No hay correos en la bandeja de entrada.' };
        }
        const list = messages.map((m, i) => `${i + 1}. ${formatEmailForDisplay(m)}`).join('\n\n');
        return {
          name: toolName,
          success: true,
          result: `📧 Correos recientes (${messages.length}):\n\n${list}`,
        };
      }

      case 'read_email': {
        const messageId = params.message_id;
        if (!messageId) {
          return { name: toolName, success: false, result: '', error: 'Falta el parámetro "message_id"' };
        }
        const msg = await provider.getMessage(String(messageId));
        return {
          name: toolName,
          success: true,
          result: `📧 **${msg.subject}**\nDe: ${msg.from}\nPara: ${msg.to}\nFecha: ${msg.date}\n${msg.isUnread ? '🔵 No leído' : '✓ Leído'}\n\n---\n\n${msg.body}`,
        };
      }

      case 'search_emails': {
        const query = params.query;
        if (!query) {
          return { name: toolName, success: false, result: '', error: 'Falta el parámetro "query"' };
        }
        const maxResults = typeof params.max_results === 'number' ? Math.min(params.max_results, 20) : 10;
        const messages = await provider.searchMessages(String(query), maxResults);
        if (messages.length === 0) {
          return { name: toolName, success: true, result: `🔍 No se encontraron correos para: "${query}"` };
        }
        const list = messages.map((m, i) => `${i + 1}. ${formatEmailForDisplay(m)}`).join('\n\n');
        return {
          name: toolName,
          success: true,
          result: `🔍 Correos encontrados para "${query}" (${messages.length}):\n\n${list}`,
        };
      }

      case 'send_email': {
        const to = params.to;
        const subject = params.subject;
        const body = params.body;
        if (!to || !subject || !body) {
          return { name: toolName, success: false, result: '', error: 'Faltan parámetros requeridos (to, subject, body)' };
        }
        const sendEmailSummary = [
          `Para: ${to}`,
          `Asunto: ${subject}`,
          params.cc ? `CC: ${params.cc}` : undefined,
          params.bcc ? 'BCC: configurado' : undefined,
          'Vista previa del cuerpo:',
          String(body).slice(0, 800),
        ].filter(Boolean).join('\n');
        const sendEmailApproval = await requestCriticalActionApproval(
          context,
          'Enviar correo de Gmail',
          sendEmailSummary
        );
        if (!sendEmailApproval.approved) {
          return { name: toolName, success: false, result: '', error: sendEmailApproval.error || 'Acción no autorizada' };
        }

        const result = await provider.sendMessage(
          String(to),
          String(subject),
          String(body),
          typeof params.cc === 'string' ? params.cc : undefined,
          typeof params.bcc === 'string' ? params.bcc : undefined
        );
        return {
          name: toolName,
          success: true,
          result: `✅ Correo enviado correctamente.\n   Para: ${to}\n   Asunto: ${subject}\n   ID: ${result.id}`,
        };
      }

      case 'reply_email': {
        const messageId = params.message_id;
        const body = params.body;
        if (!messageId || !body) {
          return { name: toolName, success: false, result: '', error: 'Faltan parámetros requeridos (message_id, body)' };
        }
        const replySummary = [
          `Message ID: ${messageId}`,
          'Vista previa de la respuesta:',
          String(body).slice(0, 800),
        ].join('\n');
        const replyApproval = await requestCriticalActionApproval(
          context,
          'Responder correo de Gmail',
          replySummary
        );
        if (!replyApproval.approved) {
          return { name: toolName, success: false, result: '', error: replyApproval.error || 'Acción no autorizada' };
        }

        const result = await provider.replyToMessage(String(messageId), String(body));
        return {
          name: toolName,
          success: true,
          result: `✅ Respuesta enviada correctamente.\n   Thread: ${result.threadId}\n   ID: ${result.id}`,
        };
      }

      case 'get_unread_email_count': {
        const count = await provider.getUnreadCount();
        return {
          name: toolName,
          success: true,
          result: count === 0
            ? '📭 No tienes correos sin leer.'
            : `📬 Tienes ${count} correo${count === 1 ? '' : 's'} sin leer.`,
        };
      }

      default:
        return { name: toolName, success: false, result: '', error: `Herramienta de Gmail desconocida: ${toolName}` };
    }
  } catch (error: any) {
    return { name: toolName, success: false, result: '', error: `Error de Gmail: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export interface ToolExecutionContext {
  agentConfig: AgentConfig;
  userId: string;
  agentId: string;
  sendTelegramMessage: (message: string) => Promise<boolean>;
  sendTelegramMessageWithButtons?: (message: string, buttons: Array<Array<{ text: string; callback_data: string }>>) => Promise<boolean>;
  downloadTelegramFile?: (fileId: string) => Promise<{ data: Buffer; mimeType: string; fileName: string } | null>;
  addMemory: (info: string) => void;
  addSchedule: (params: {
    id?: string;
    name: string;
    cron: string;
    instruction: string;
    enabled?: boolean;
    startAt?: number;
    frequency?: string;
    conditions?: string;
    timezone?: string;
  }) => string;
  removeSchedule: (taskId: string) => boolean;
  toggleSchedule: (taskId: string, enabled: boolean) => boolean;
  setOneShotTrigger?: (taskId: string, triggerAt: number) => void;
  requestApproval?: (request: {
    type: 'terminal' | 'code' | 'critical_action';
    command?: string;
    code?: string;
    language?: string;
    reason: string;
    actionLabel?: string;
    actionDetails?: string;
  }) => Promise<boolean>;
  recordUsageEvent?: (event: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    source: string;
    tooling?: { webSearch?: boolean; codeExecution?: boolean };
  }) => void;
  recordResourceEvent?: (event: {
    type: string;
    units?: number;
    costUsd?: number;
    metadata?: Record<string, unknown>;
  }) => void;
  /** Check whether the agent's daily budget has been exceeded */
  checkBudget?: () => { exceeded: boolean; currentCostUsd: number; limitUsd: number };
  mcpManager?: MCPClientManager;
}

async function requestCriticalActionApproval(
  context: ToolExecutionContext,
  actionLabel: string,
  actionDetails: string
): Promise<{ approved: boolean; error?: string }> {
  if (!context.requestApproval) {
    return {
      approved: false,
      error: 'No hay mecanismo de aprobación disponible. No se puede ejecutar esta acción crítica sin confirmación explícita del usuario.',
    };
  }

  const approved = await context.requestApproval({
    type: 'critical_action',
    reason: actionLabel,
    actionLabel,
    actionDetails,
  });

  if (!approved) {
    return {
      approved: false,
      error: 'El usuario ha denegado la acción crítica. No se ejecutó ningún cambio.',
    };
  }

  return { approved: true };
}

interface RankedNoteMatch {
  note: storage.Note;
  relevance: number;
}

const inferQueryLanguage = (query: string): 'es' | 'en' => {
  const lowered = query.toLowerCase();
  const spanishHints = [' el ', ' la ', ' de ', ' para ', ' con ', ' nota ', ' notas ', ' editar ', 'actualizar'];
  if (/[áéíóúñ¿¡]/i.test(query)) return 'es';
  if (spanishHints.some((hint) => lowered.includes(hint.trim()))) return 'es';
  return 'en';
};

const buildNoteMemoryCandidates = (notes: storage.Note[]): MemoryCandidate[] =>
  notes.map((note, index) => {
    const date = new Date(note.updatedAt).toISOString();
    const tags = note.tags.length > 0 ? note.tags.join(', ') : 'sin tags';
    const compactContent = note.content.replace(/\s+/g, ' ').trim().slice(0, 420);
    return {
      index,
      role: 'note',
      date,
      content: `Título: ${note.title}\nTags: ${tags}\nContenido: ${compactContent}`,
    };
  });

async function rankNotesForQuery(
  query: string,
  notes: storage.Note[],
  context: ToolExecutionContext
): Promise<RankedNoteMatch[]> {
  if (notes.length === 0) return [];

  const keywordRanked: RankedNoteMatch[] = notes.map((note, index) => ({
    note,
    relevance: Math.max(1, 10 - Math.min(9, index)),
  }));

  if (context.agentConfig.enableSmartRAG === false || notes.length === 1) {
    return keywordRanked;
  }

  try {
    const candidates = buildNoteMemoryCandidates(notes.slice(0, 20));
    const scored = await scoreAndFilterMemories(query, candidates, {
      provider: context.agentConfig.provider,
      model: context.agentConfig.model,
      minRelevance: 0,
      maxReturn: candidates.length,
      language: inferQueryLanguage(query),
    });

    if (scored.length === 0) {
      return keywordRanked;
    }

    const ranked: RankedNoteMatch[] = [];
    const usedIds = new Set<string>();
    for (const match of scored) {
      const note = notes[match.index];
      if (!note || usedIds.has(note.id)) continue;
      ranked.push({ note, relevance: Math.max(0, Math.min(10, match.relevance)) });
      usedIds.add(note.id);
    }

    for (const fallback of keywordRanked) {
      if (usedIds.has(fallback.note.id)) continue;
      ranked.push(fallback);
    }

    return ranked;
  } catch {
    return keywordRanked;
  }
}

export async function executeTool(
  call: ToolCallRequest,
  context: ToolExecutionContext
): Promise<ToolCallResult> {
  const { name, params } = call;
  const { userId, agentId } = context;
  const notesAccessAllowed = context.agentConfig.permissions.notesAccess !== false;
  const schedulerAccessAllowed = context.agentConfig.permissions.schedulerAccess !== false;
  const recordResourceEvent = (
    type: string,
    metadata?: Record<string, unknown>,
    options?: { units?: number; costUsd?: number }
  ) => {
    context.recordResourceEvent?.({
      type,
      metadata,
      units: options?.units,
      costUsd: options?.costUsd,
    });
  };

  try {
    switch (name) {
      case 'web_search': {
        const query = params.query;
        if (!query) return { name, success: false, result: '', error: 'Falta el parámetro "query"' };
        const result = await executeWebSearch(query);
        return { name, success: true, result };
      }

      case 'fetch_webpage': {
        const url = params.url;
        if (!url) return { name, success: false, result: '', error: 'Falta el parámetro "url"' };
        if (!context.agentConfig.permissions.internetAccess) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso de acceso a internet' };
        }
        const urlBlockReason = checkUrlAllowed(url, context.agentConfig.permissions);
        if (urlBlockReason) {
          return { name, success: false, result: '', error: urlBlockReason };
        }
        const result = await executeFetchWebpage(url);
        return { name, success: true, result };
      }

      case 'fetch_image': {
        const url = params.url;
        if (!url) return { name, success: false, result: '', error: 'Falta el parámetro "url"' };
        if (!context.agentConfig.permissions.internetAccess) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso de acceso a internet' };
        }
        const imgUrlBlockReason = checkUrlAllowed(url, context.agentConfig.permissions);
        if (imgUrlBlockReason) {
          return { name, success: false, result: '', error: imgUrlBlockReason };
        }
        try {
          const imgResponse = await fetch(url, {
            headers: {
              'User-Agent': USER_AGENT,
              'Accept': 'image/*,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(30000),
            redirect: 'follow',
          });
          if (!imgResponse.ok) {
            return { name, success: false, result: '', error: `HTTP ${imgResponse.status}: ${imgResponse.statusText}` };
          }
          const contentType = imgResponse.headers.get('content-type') || '';
          if (!contentType.startsWith('image/')) {
            return { name, success: false, result: '', error: `La URL no devuelve una imagen (content-type: ${contentType})` };
          }
          const buffer = Buffer.from(await imgResponse.arrayBuffer());
          const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB
          if (buffer.length > MAX_IMAGE_SIZE) {
            return { name, success: false, result: '', error: `Imagen demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB, máx: 10 MB)` };
          }
          const base64 = buffer.toString('base64');
          const mimeType = contentType.split(';')[0].trim();
          const dataUri = `data:${mimeType};base64,${base64}`;

          // Analyze image content with vision to help the agent decide if it's useful
          let imageDescription = '';
          try {
            const visionResult = await analyzeImage(
              buffer,
              mimeType,
              'Describe brevemente qué muestra esta imagen (contenido, estilo, calidad). ¿Es adecuada para una presentación profesional?',
              context.agentConfig.provider as any,
              context.agentConfig.model,
            );
            imageDescription = visionResult.description;
          } catch {
            imageDescription = '(No se pudo analizar el contenido de la imagen)';
          }

          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          return {
            name,
            success: true,
            result: `Imagen descargada (${(buffer.length / 1024).toFixed(1)} KB, ${mimeType}).\n\n**Análisis de la imagen:** ${imageDescription}\n\nbase64 (usar directamente en images[].base64 de create_powerpoint o imageBase64 de create_pdf):\n${dataUri}`,
          };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error descargando imagen: ${err.message}` };
        }
      }

      case 'browse_website': {
        const url = params.url;
        if (!url) return { name, success: false, result: '', error: 'Falta el parámetro "url"' };
        if (!context.agentConfig.permissions.internetAccess) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso de acceso a internet' };
        }
        if (!context.agentConfig.permissions.headlessBrowser) {
          return { name, success: false, result: '', error: 'El navegador headless no está habilitado' };
        }
        const browseBlockReason = checkUrlAllowed(url, context.agentConfig.permissions);
        if (browseBlockReason) {
          return { name, success: false, result: '', error: browseBlockReason };
        }
        const action = typeof params.action === 'string' ? params.action : undefined;
        const selector = typeof params.selector === 'string' ? params.selector : undefined;
        const value = typeof params.value === 'string' ? params.value : undefined;
        const waitForMs =
          typeof params.wait_for_ms === 'number' && Number.isFinite(params.wait_for_ms)
            ? params.wait_for_ms
            : undefined;
        const usernameSelector = typeof params.username_selector === 'string' ? params.username_selector : undefined;
        const passwordSelector = typeof params.password_selector === 'string' ? params.password_selector : undefined;
        const submitSelector = typeof params.submit_selector === 'string' ? params.submit_selector : undefined;
        const credentialTarget =
          typeof params.credential_site === 'string' && params.credential_site.trim()
            ? params.credential_site.trim()
            : url;
        const credential = matchCredentialForTarget(context.agentConfig.permissions.webCredentials || [], credentialTarget);

        const result = await executeBrowseWebsite(url, {
          action,
          selector,
          value,
          waitForMs,
          credential,
          usernameSelector,
          passwordSelector,
          submitSelector,
        });
        return { name, success: true, result };
      }

      case 'send_telegram_message': {
        const message = params.message;
        if (!message) return { name, success: false, result: '', error: 'Falta el parámetro "message"' };
        const sent = await context.sendTelegramMessage(message);
        recordResourceEvent('agent_tool_call', { tool: name, success: sent });
        return {
          name,
          success: sent,
          result: sent ? 'Mensaje enviado correctamente por Telegram' : 'Error al enviar el mensaje',
        };
      }

      case 'remember': {
        const info = params.info;
        if (!info) return { name, success: false, result: '', error: 'Falta el parámetro "info"' };
        context.addMemory(info);
        return { name, success: true, result: `Información guardada en memoria: "${info}"` };
      }

      // ── Working Memory ──────────────────────────────────────────────────
      case 'update_working_memory': {
        const label = params.label;
        const content = params.content;
        if (!label || !content) return { name, success: false, result: '', error: 'Faltan parámetros requeridos (label, content)' };
        const entry = storage.setWorkingMemory(userId, agentId, label, content);
        recordResourceEvent('agent_tool_call', { tool: name, label });
        return { name, success: true, result: `Memoria de trabajo actualizada — etiqueta: "${label}", id: ${entry.id}` };
      }

      case 'get_working_memory': {
        const label = params.label;
        if (label) {
          const entry = storage.getWorkingMemoryByLabel(userId, agentId, label);
          if (!entry) return { name, success: true, result: `No hay entrada en memoria de trabajo con etiqueta "${label}"` };
          return { name, success: true, result: `[${entry.label}] (actualizado: ${new Date(entry.updatedAt).toISOString()})\n${entry.content}` };
        }
        const all = storage.getAllWorkingMemory(userId, agentId);
        if (all.length === 0) return { name, success: true, result: 'La memoria de trabajo está vacía.' };
        const formatted = all.map((e) => `[${e.label}] (id: ${e.id}, actualizado: ${new Date(e.updatedAt).toISOString()})\n${e.content}`).join('\n---\n');
        return { name, success: true, result: `Memoria de trabajo (${all.length} entradas):\n${formatted}` };
      }

      case 'clear_working_memory': {
        const entryId = params.entry_id;
        if (entryId) {
          const deleted = storage.deleteWorkingMemoryEntry(userId, agentId, entryId);
          return { name, success: deleted, result: deleted ? `Entrada ${entryId} eliminada de memoria de trabajo` : `No se encontró la entrada ${entryId}` };
        }
        const count = storage.clearWorkingMemory(userId, agentId);
        return { name, success: true, result: `Memoria de trabajo limpiada (${count} entradas eliminadas)` };
      }

      case 'get_current_time': {
        const result = executeGetCurrentTime(context.agentConfig.timezone);
        return { name, success: true, result };
      }

      // ── Notes ──────────────────────────────────────────────────────────
      case 'create_note': {
        if (!notesAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar notas.' };
        }
        const title = params.title;
        const content = params.content;
        if (!title || !content) return { name, success: false, result: '', error: 'Faltan parámetros requeridos (title, content)' };
        const tags = params.tags ? params.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        const note = storage.createNote(userId, agentId, title, content, tags);
        recordResourceEvent('agent_note_operation', { operation: 'create_note', noteId: note.id });
        // Track for undo
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: note.id,
          inverseAction: { toolName: 'delete_note', params: { note_id: note.id } },
          timestamp: Date.now(),
        });
        return { name, success: true, result: `Nota creada correctamente:\n- ID: ${note.id}\n- Título: ${note.title}\n- Tags: ${note.tags.length > 0 ? note.tags.join(', ') : 'ninguno'}` };
      }

      case 'get_notes': {
        if (!notesAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar notas.' };
        }
        const notes = storage.getAllNotes(userId, agentId);
        if (notes.length === 0) {
          return { name, success: true, result: 'No hay notas guardadas.' };
        }
        recordResourceEvent('agent_note_operation', { operation: 'get_notes' });
        const notesList = notes.map((n, i) => {
          const date = new Date(n.updatedAt).toLocaleString('es-ES');
          return `${i + 1}. **${n.title}** (ID: ${n.id})\n   ${n.content.slice(0, 100)}${n.content.length > 100 ? '...' : ''}\n   Tags: ${n.tags.length > 0 ? n.tags.join(', ') : '-'} | Actualizada: ${date}`;
        }).join('\n\n');
        return { name, success: true, result: `📝 Notas guardadas (${notes.length}):\n\n${notesList}` };
      }

      case 'search_notes': {
        if (!notesAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar notas.' };
        }
        const query = params.query;
        if (!query) return { name, success: false, result: '', error: 'Falta el parámetro "query"' };
        const candidates = storage.searchNotes(userId, agentId, query, { limit: 20 });
        const rankedMatches = await rankNotesForQuery(query, candidates, context);
        const notes = rankedMatches.map((entry) => entry.note);
        recordResourceEvent('agent_note_operation', { operation: 'search_notes' });
        if (notes.length === 0) {
          return { name, success: true, result: `No se encontraron notas que coincidan con "${query}".` };
        }
        const notesList = rankedMatches.map((entry, i) => {
          const n = entry.note;
          return `${i + 1}. **${n.title}** (ID: ${n.id}) — Relevancia: ${entry.relevance}/10\n   ${n.content.slice(0, 150)}${n.content.length > 150 ? '...' : ''}`;
        }).join('\n\n');
        return { name, success: true, result: `🔍 Notas encontradas para "${query}" (${notes.length}):\n\n${notesList}` };
      }

      case 'update_note': {
        if (!notesAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar notas.' };
        }
        const noteId = typeof params.note_id === 'string' ? params.note_id.trim() : '';
        const noteQuery = typeof params.query === 'string' ? params.query.trim() : '';
        const updates: any = {};
        if (params.title) updates.title = params.title;
        if (params.content) updates.content = params.content;
        if (params.tags) updates.tags = params.tags.split(',').map((t: string) => t.trim()).filter(Boolean);

        if (Object.keys(updates).length === 0) {
          return { name, success: false, result: '', error: 'No hay cambios para aplicar. Proporciona title, content o tags.' };
        }

        let targetNoteId = noteId;
        let resolvedBySmartRag: storage.Note | null = null;

        if (!targetNoteId) {
          if (!noteQuery) {
            return {
              name,
              success: false,
              result: '',
              error: 'Falta "note_id" o "query" para localizar la nota a editar.',
            };
          }

          const candidates = storage.searchNotes(userId, agentId, noteQuery, { limit: 20 });
          const rankedMatches = await rankNotesForQuery(noteQuery, candidates, context);
          resolvedBySmartRag = rankedMatches[0]?.note || null;

          if (!resolvedBySmartRag) {
            return {
              name,
              success: false,
              result: '',
              error: `No encontré una nota para "${noteQuery}". Usa "search_notes" o pasa note_id.`,
            };
          }

          targetNoteId = resolvedBySmartRag.id;
        }

        const updated = storage.updateNote(userId, agentId, targetNoteId, updates);
        if (!updated) return { name, success: false, result: '', error: `No se encontró la nota con ID "${targetNoteId}"` };
        recordResourceEvent('agent_note_operation', { operation: 'update_note', noteId: updated.id });
        const resolution = resolvedBySmartRag
          ? `\nNota localizada con Smart RAG: "${resolvedBySmartRag.title}" (ID: ${resolvedBySmartRag.id}).`
          : '';
        return { name, success: true, result: `Nota "${updated.title}" actualizada correctamente.${resolution}` };
      }

      case 'delete_note': {
        if (!notesAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar notas.' };
        }
        const noteId = params.note_id;
        if (!noteId) return { name, success: false, result: '', error: 'Falta el parámetro "note_id"' };
        const deleted = storage.deleteNote(userId, agentId, noteId);
        if (deleted) {
          recordResourceEvent('agent_note_operation', { operation: 'delete_note', noteId });
        }
        return { name, success: deleted, result: deleted ? 'Nota eliminada correctamente.' : 'No se encontró la nota.', error: deleted ? undefined : 'Nota no encontrada' };
      }

      // ── Lists ──────────────────────────────────────────────────────────
      case 'create_list': {
        const title = params.title;
        if (!title) return { name, success: false, result: '', error: 'Falta el parámetro "title"' };
        const items = params.items ? params.items.split(',').map((i: string) => i.trim()).filter(Boolean) : [];
        const list = storage.createList(userId, agentId, title, items);
        const itemsText = list.items.map((item, idx) => `  ${idx + 1}. ${item.text}`).join('\n');
        // Track for undo
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: list.id,
          inverseAction: { toolName: 'delete_list', params: { title: list.id } },
          timestamp: Date.now(),
        });
        return { name, success: true, result: `📋 Lista "${list.title}" creada (ID: ${list.id}):\n${itemsText || '  (vacía)'}` };
      }

      case 'get_lists': {
        const lists = storage.getAllLists(userId, agentId);
        if (lists.length === 0) {
          return { name, success: true, result: 'No hay listas guardadas.' };
        }
        const listsText = lists.map((l, i) => {
          const itemsPreview = l.items.slice(0, 5).map(item =>
            `  ${item.checked ? '✅' : '⬜'} ${item.text}`
          ).join('\n');
          const more = l.items.length > 5 ? `\n  ... y ${l.items.length - 5} más` : '';
          return `${i + 1}. **${l.title}** (ID: ${l.id}) - ${l.items.length} elementos\n${itemsPreview}${more}`;
        }).join('\n\n');
        return { name, success: true, result: `📋 Listas guardadas (${lists.length}):\n\n${listsText}` };
      }

      case 'get_list': {
        const title = params.title;
        if (!title) return { name, success: false, result: '', error: 'Falta el parámetro "title"' };
        // Try by title first, then by ID
        let list = storage.findListByTitle(userId, agentId, title);
        if (!list) list = storage.getList(userId, agentId, title);
        if (!list) return { name, success: false, result: '', error: `No se encontró la lista "${title}"` };
        const itemsText = list.items.map((item, idx) =>
          `  ${idx + 1}. ${item.checked ? '✅' : '⬜'} ${item.text}`
        ).join('\n');
        return { name, success: true, result: `📋 **${list.title}** (ID: ${list.id}):\n${itemsText || '  (vacía)'}` };
      }

      case 'add_to_list': {
        const title = params.title;
        const items = params.items;
        if (!title || !items) return { name, success: false, result: '', error: 'Faltan parámetros requeridos (title, items)' };
        const list = storage.findListByTitle(userId, agentId, title);
        if (!list) return { name, success: false, result: '', error: `No se encontró la lista "${title}". Usa create_list para crear una nueva.` };
        const newItems = items.split(',').map((i: string) => i.trim()).filter(Boolean);
        const updated = storage.addItemsToList(userId, agentId, list.id, newItems);
        if (!updated) return { name, success: false, result: '', error: 'Error al añadir elementos' };
        // Track for undo: remove the items that were just added
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: `added ${newItems.length} items`,
          inverseAction: newItems.length === 1
            ? { toolName: 'remove_from_list', params: { title: list.title, item: newItems[0] } }
            : null, // multi-item undo not supported via single remove
          timestamp: Date.now(),
        });
        return { name, success: true, result: `✅ Se añadieron ${newItems.length} elemento(s) a "${updated.title}". Total: ${updated.items.length} elementos.` };
      }

      case 'remove_from_list': {
        const title = params.title;
        const item = params.item;
        if (!title || !item) return { name, success: false, result: '', error: 'Faltan parámetros requeridos (title, item)' };
        const list = storage.findListByTitle(userId, agentId, title);
        if (!list) return { name, success: false, result: '', error: `No se encontró la lista "${title}"` };
        const updated = storage.removeItemFromList(userId, agentId, list.id, item);
        if (!updated) return { name, success: false, result: '', error: `No se encontró el elemento "${item}" en la lista` };
        return { name, success: true, result: `✅ Elemento "${item}" eliminado de "${updated.title}". Quedan ${updated.items.length} elementos.` };
      }

      case 'check_list_item': {
        const title = params.title;
        const item = params.item;
        const checked = params.checked === 'true';
        if (!title || !item) return { name, success: false, result: '', error: 'Faltan parámetros requeridos (title, item)' };
        const list = storage.findListByTitle(userId, agentId, title);
        if (!list) return { name, success: false, result: '', error: `No se encontró la lista "${title}"` };
        const updated = storage.toggleListItem(userId, agentId, list.id, item, checked);
        if (!updated) return { name, success: false, result: '', error: `No se encontró el elemento "${item}" en la lista` };
        return { name, success: true, result: `✅ Elemento "${item}" ${checked ? 'marcado como completado' : 'desmarcado'} en "${updated.title}".` };
      }

      case 'delete_list': {
        const title = params.title;
        if (!title) return { name, success: false, result: '', error: 'Falta el parámetro "title"' };
        // Try by title first, then by ID
        const list = storage.findListByTitle(userId, agentId, title);
        const listId = list?.id || title;
        const deleted = storage.deleteList(userId, agentId, listId);
        return { name, success: deleted, result: deleted ? `Lista eliminada correctamente.` : 'No se encontró la lista.', error: deleted ? undefined : 'Lista no encontrada' };
      }

      // ── Scheduler ──────────────────────────────────────────────────────
      case 'schedule_task': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar tareas programadas.' };
        }
        const taskName = params.name;
        const cron = params.cron;
        const instruction = params.instruction;
        if (!taskName || !cron || !instruction) {
          return { name, success: false, result: '', error: 'Faltan parámetros requeridos (name, cron, instruction)' };
        }
        const rawStartAt = typeof params.start_at === 'string' ? Date.parse(params.start_at) : Number.NaN;
        const hasStartAt = typeof params.start_at === 'string' && params.start_at.trim().length > 0;
        if (hasStartAt && !Number.isFinite(rawStartAt)) {
          return { name, success: false, result: '', error: 'El parámetro "start_at" debe ser una fecha ISO válida.' };
        }
        const startAt = hasStartAt ? rawStartAt : undefined;
        const frequency = typeof params.frequency === 'string' && params.frequency.trim()
          ? params.frequency.trim()
          : undefined;
        const conditions = typeof params.conditions === 'string' && params.conditions.trim()
          ? params.conditions.trim()
          : undefined;
        const timezone = typeof params.timezone === 'string' && params.timezone.trim()
          ? params.timezone.trim()
          : context.agentConfig.timezone;

        const taskId = context.addSchedule({
          name: taskName,
          cron,
          instruction,
          enabled: true,
          startAt,
          frequency,
          conditions,
          timezone,
        });
        // Persist the schedule
        storage.saveSchedule(userId, agentId, {
          id: taskId,
          name: taskName,
          cron,
          instruction,
          enabled: true,
          startAt,
          frequency,
          conditions,
          timezone,
          createdAt: Date.now(),
        });
        recordResourceEvent('agent_scheduler_operation', { operation: 'schedule_task', taskId });

        // Track for undo
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: taskId,
          inverseAction: { toolName: 'remove_scheduled_task', params: { task_id: taskId } },
          timestamp: Date.now(),
        });

        const details: string[] = [];
        if (typeof startAt === 'number') {
          details.push(`Inicio: ${new Date(startAt).toLocaleString('es-ES', timezone ? { timeZone: timezone } : undefined)}`);
        }
        if (frequency) details.push(`Frecuencia: ${frequency}`);
        if (conditions) details.push(`Condiciones: ${conditions}`);
        if (timezone) details.push(`Zona horaria: ${timezone}`);

        return {
          name,
          success: true,
          result: `Tarea "${taskName}" programada con cron "${cron}" (ID: ${taskId}). Se ejecutará automáticamente.${details.length > 0 ? `\n${details.join('\n')}` : ''}`,
        };
      }

      case 'list_scheduled_tasks': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar tareas programadas.' };
        }
        const schedules = storage.getAllSchedules(userId, agentId);
        if (schedules.length === 0) {
          return { name, success: true, result: 'No hay tareas programadas.' };
        }
        recordResourceEvent('agent_scheduler_operation', { operation: 'list_scheduled_tasks' });
        const tasksList = schedules.map((s, i) => {
          const status = s.enabled ? '🟢 Activa' : '🔴 Inactiva';
          const date = new Date(s.createdAt).toLocaleString('es-ES');
          const zone = s.timezone || context.agentConfig.timezone;
          const startAt = typeof s.startAt === 'number' && Number.isFinite(s.startAt)
            ? new Date(s.startAt).toLocaleString('es-ES', zone ? { timeZone: zone } : undefined)
            : 'inmediato';
          const lastRun = typeof s.lastRunAt === 'number'
            ? new Date(s.lastRunAt).toLocaleString('es-ES', zone ? { timeZone: zone } : undefined)
            : 'sin ejecuciones';
          const lastStatus = s.lastStatus === 'error' ? '❌ error' : s.lastStatus === 'success' ? '✅ completada' : 'pendiente';
          return `${i + 1}. **${s.name}** (ID: ${s.id})\n   Cron: ${s.cron} | Estado: ${status}\n   Inicio: ${startAt} | Frecuencia: ${s.frequency || '-'}\n   Condiciones: ${s.conditions || '-'} | Zona: ${zone || '-'}\n   Última ejecución: ${lastRun} (${lastStatus})\n   Instrucción: ${s.instruction.slice(0, 100)}${s.instruction.length > 100 ? '...' : ''}\n   Creada: ${date}`;
        }).join('\n\n');
        return { name, success: true, result: `⏰ Tareas programadas (${schedules.length}):\n\n${tasksList}` };
      }

      case 'remove_scheduled_task': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar tareas programadas.' };
        }
        const taskId = params.task_id;
        if (!taskId) return { name, success: false, result: '', error: 'Falta el parámetro "task_id"' };
        // Find by name or ID
        const schedules = storage.getAllSchedules(userId, agentId);
        const found = schedules.find(s => s.id === taskId || s.name.toLowerCase() === taskId.toLowerCase());
        if (!found) return { name, success: false, result: '', error: `No se encontró la tarea "${taskId}"` };
        const deleted = storage.deleteSchedule(userId, agentId, found.id);
        const removedRuntime = context.removeSchedule(found.id);
        if (deleted) {
          recordResourceEvent('agent_scheduler_operation', { operation: 'remove_scheduled_task', taskId: found.id });
        }
        return {
          name,
          success: deleted,
          result: deleted
            ? `Tarea "${found.name}" eliminada correctamente.${removedRuntime ? '' : ' (no estaba activa en runtime)'}`
            : 'Error al eliminar la tarea.',
          error: deleted ? undefined : 'Error al eliminar',
        };
      }

      case 'toggle_scheduled_task': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar tareas programadas.' };
        }
        const taskId = params.task_id;
        const enabled = params.enabled === true || params.enabled === 'true';
        if (!taskId) return { name, success: false, result: '', error: 'Falta el parámetro "task_id"' };
        const schedules = storage.getAllSchedules(userId, agentId);
        const found = schedules.find(s => s.id === taskId || s.name.toLowerCase() === taskId.toLowerCase());
        if (!found) return { name, success: false, result: '', error: `No se encontró la tarea "${taskId}"` };
        const updated = storage.toggleSchedule(userId, agentId, found.id, enabled);
        if (!updated) return { name, success: false, result: '', error: 'Error al actualizar la tarea' };
        context.toggleSchedule(updated.id, enabled);
        recordResourceEvent('agent_scheduler_operation', {
          operation: 'toggle_scheduled_task',
          taskId: updated.id,
          enabled,
        });
        return { name, success: true, result: `Tarea "${updated.name}" ${enabled ? 'activada' : 'desactivada'} correctamente.` };
      }

      // ── Calendar ───────────────────────────────────────────────────────
      case 'create_calendar_event':
      case 'list_calendar_events':
      case 'search_calendar_events':
      case 'update_calendar_event':
      case 'delete_calendar_event': {
        const calendarAccessAllowed = context.agentConfig.permissions.calendarAccess !== false;
        if (!calendarAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar el calendario.' };
        }
        const calendarResult = await executeCalendarTool(name, params, context);
        if (calendarResult.success) {
          recordResourceEvent('agent_calendar_operation', { operation: name });
        }
        return calendarResult;
      }

      // ── Gmail ──────────────────────────────────────────────────────────
      case 'list_emails':
      case 'read_email':
      case 'search_emails':
      case 'send_email':
      case 'reply_email':
      case 'get_unread_email_count': {
        const gmailAccessAllowed = context.agentConfig.permissions.gmailAccess !== false;
        if (!gmailAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para acceder a Gmail.' };
        }
        const gmailResult = await executeGmailTool(name, params, context);
        if (gmailResult.success) {
          recordResourceEvent('agent_gmail_operation', { operation: name });
        }
        return gmailResult;
      }

      // ── Reminders (one-shot) ───────────────────────────────────────────
      case 'set_reminder': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar recordatorios.' };
        }
        const reminderName = params.name;
        const triggerAtStr = params.trigger_at;
        const message = params.message;
        if (!reminderName || !triggerAtStr || !message) {
          return { name, success: false, result: '', error: 'Faltan parámetros requeridos (name, trigger_at, message)' };
        }
        const triggerAtMs = Date.parse(triggerAtStr);
        if (!Number.isFinite(triggerAtMs)) {
          return { name, success: false, result: '', error: 'El parámetro "trigger_at" debe ser una fecha ISO válida.' };
        }
        if (triggerAtMs <= Date.now()) {
          return { name, success: false, result: '', error: 'La fecha del recordatorio debe ser en el futuro.' };
        }
        const timezone = typeof params.timezone === 'string' && params.timezone.trim()
          ? params.timezone.trim()
          : context.agentConfig.timezone;
        const reminderId = context.addSchedule({
          name: `⏰ ${reminderName}`,
          cron: '* * * * *',
          instruction: `[RECORDATORIO] Envía este mensaje al usuario por Telegram:\n\n${message}`,
          enabled: true,
          timezone,
        });
        // Save as one-shot with triggerAt
        storage.saveSchedule(userId, agentId, {
          id: reminderId,
          name: `⏰ ${reminderName}`,
          cron: '* * * * *',
          instruction: `[RECORDATORIO] Envía este mensaje al usuario por Telegram:\n\n${message}`,
          enabled: true,
          oneShot: true,
          triggerAt: triggerAtMs,
          timezone,
          createdAt: Date.now(),
        });
        // Update the runtime task with oneShot+triggerAt
        context.removeSchedule(reminderId);
        context.addSchedule({
          id: reminderId,
          name: `⏰ ${reminderName}`,
          cron: '* * * * *',
          instruction: `[RECORDATORIO] Envía este mensaje al usuario por Telegram:\n\n${message}`,
          enabled: true,
          timezone,
        });
        // Manually set oneShot and triggerAt on the runtime scheduler task
        if (context.setOneShotTrigger) {
          context.setOneShotTrigger(reminderId, triggerAtMs);
        }
        recordResourceEvent('agent_scheduler_operation', { operation: 'set_reminder', taskId: reminderId });
        // Track for undo
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: reminderId,
          inverseAction: { toolName: 'cancel_reminder', params: { reminder_id: reminderId } },
          timestamp: Date.now(),
        });
        const triggerDate = new Date(triggerAtMs).toLocaleString('es-ES', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
          ...(timezone ? { timeZone: timezone } : {}),
        });
        return {
          name,
          success: true,
          result: `⏰ Recordatorio configurado: "${reminderName}"\n📅 Se disparará: ${triggerDate}\n💬 Mensaje: ${message}\n🔑 ID: ${reminderId}`,
        };
      }

      case 'list_reminders': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar recordatorios.' };
        }
        const schedules = storage.getAllSchedules(userId, agentId);
        const reminders = schedules.filter(s => s.oneShot && s.enabled);
        if (reminders.length === 0) {
          return { name, success: true, result: 'No hay recordatorios pendientes.' };
        }
        const remindersList = reminders.map((r, i) => {
          const triggerDate = typeof r.triggerAt === 'number'
            ? new Date(r.triggerAt).toLocaleString('es-ES', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
                ...(r.timezone ? { timeZone: r.timezone } : {}),
              })
            : 'pendiente';
          return `${i + 1}. ${r.name} (ID: ${r.id})\n   📅 ${triggerDate}\n   💬 ${r.instruction.replace(/\[RECORDATORIO\]\s*Envía este mensaje al usuario por Telegram:\s*/i, '').slice(0, 100)}`;
        }).join('\n\n');
        return { name, success: true, result: `⏰ Recordatorios pendientes (${reminders.length}):\n\n${remindersList}` };
      }

      case 'cancel_reminder': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar recordatorios.' };
        }
        const reminderId = params.reminder_id;
        if (!reminderId) return { name, success: false, result: '', error: 'Falta el parámetro "reminder_id"' };
        const schedules = storage.getAllSchedules(userId, agentId);
        const found = schedules.find(s =>
          s.oneShot && (s.id === reminderId || s.name.toLowerCase().includes(reminderId.toLowerCase()))
        );
        if (!found) return { name, success: false, result: '', error: `No se encontró el recordatorio "${reminderId}"` };
        const deleted = storage.deleteSchedule(userId, agentId, found.id);
        context.removeSchedule(found.id);
        return {
          name,
          success: deleted,
          result: deleted ? `❌ Recordatorio "${found.name}" cancelado.` : 'Error al cancelar el recordatorio.',
        };
      }

      case 'postpone_reminder': {
        if (!schedulerAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar recordatorios.' };
        }
        const reminderId = params.reminder_id;
        const newTriggerStr = params.new_trigger_at;
        if (!reminderId || !newTriggerStr) {
          return { name, success: false, result: '', error: 'Faltan parámetros requeridos (reminder_id, new_trigger_at)' };
        }
        const newTriggerMs = Date.parse(newTriggerStr);
        if (!Number.isFinite(newTriggerMs) || newTriggerMs <= Date.now()) {
          return { name, success: false, result: '', error: 'La nueva fecha debe ser válida y en el futuro.' };
        }
        const schedules = storage.getAllSchedules(userId, agentId);
        const found = schedules.find(s =>
          s.oneShot && (s.id === reminderId || s.name.toLowerCase().includes(reminderId.toLowerCase()))
        );
        if (!found) return { name, success: false, result: '', error: `No se encontró el recordatorio "${reminderId}"` };
        const updated = storage.updateSchedule(userId, agentId, found.id, {
          triggerAt: newTriggerMs,
          enabled: true,
        });
        if (!updated) return { name, success: false, result: '', error: 'Error al posponer el recordatorio.' };
        // Update runtime
        context.removeSchedule(found.id);
        context.addSchedule({
          id: found.id,
          name: found.name,
          cron: found.cron,
          instruction: found.instruction,
          enabled: true,
          timezone: found.timezone,
        });
        if (context.setOneShotTrigger) {
          context.setOneShotTrigger(found.id, newTriggerMs);
        }
        const newDate = new Date(newTriggerMs).toLocaleString('es-ES', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
          ...(found.timezone ? { timeZone: found.timezone } : {}),
        });
        return { name, success: true, result: `⏰ Recordatorio "${found.name}" pospuesto a: ${newDate}` };
      }

      // ── Enhanced Lists ─────────────────────────────────────────────────
      case 'update_list_item': {
        const listTitle = params.title;
        const itemText = params.item;
        if (!listTitle || !itemText) return { name, success: false, result: '', error: 'Faltan parámetros requeridos (title, item)' };
        const list = storage.findListByTitle(userId, agentId, listTitle);
        if (!list) return { name, success: false, result: '', error: `No se encontró la lista "${listTitle}"` };
        const updates: any = {};
        if (params.new_text) updates.text = params.new_text;
        if (params.priority && ['alta', 'media', 'baja'].includes(params.priority)) updates.priority = params.priority;
        if (params.due_date) {
          const dueMs = Date.parse(params.due_date);
          if (Number.isFinite(dueMs)) updates.dueDate = dueMs;
        }
        if (params.category) updates.category = params.category;
        const updated = storage.updateListItem(userId, agentId, list.id, itemText, updates);
        if (!updated) return { name, success: false, result: '', error: `No se encontró el elemento "${itemText}" en la lista` };
        const details: string[] = [];
        if (updates.text) details.push(`Texto: ${updates.text}`);
        if (updates.priority) details.push(`Prioridad: ${updates.priority}`);
        if (updates.dueDate) details.push(`Vencimiento: ${new Date(updates.dueDate).toLocaleDateString('es-ES')}`);
        if (updates.category) details.push(`Categoría: ${updates.category}`);
        return { name, success: true, result: `✅ Elemento actualizado en "${updated.title}":\n${details.join('\n')}` };
      }

      case 'get_pending_tasks': {
        const pending = storage.getPendingListItems(userId, agentId);
        if (pending.length === 0) {
          return { name, success: true, result: '🎉 ¡No hay tareas pendientes! Todo completado.' };
        }
        const priorityEmoji: Record<string, string> = { alta: '🔴', media: '🟡', baja: '🟢' };
        const tasksList = pending.map((p, i) => {
          const emoji = p.item.priority ? priorityEmoji[p.item.priority] || '⬜' : '⬜';
          const due = p.item.dueDate ? ` | 📅 ${new Date(p.item.dueDate).toLocaleDateString('es-ES')}` : '';
          const cat = p.item.category ? ` | 🏷️ ${p.item.category}` : '';
          const pri = p.item.priority ? ` | ${emoji} ${p.item.priority}` : '';
          return `${i + 1}. ${emoji} ${p.item.text}\n   📋 Lista: ${p.listTitle}${pri}${due}${cat}`;
        }).join('\n\n');
        return { name, success: true, result: `📝 Tareas pendientes (${pending.length}):\n\n${tasksList}` };
      }

      // ── Expenses ───────────────────────────────────────────────────────
      case 'add_expense': {
        const amount = typeof params.amount === 'number' ? params.amount : parseFloat(String(params.amount || '').replace(',', '.'));
        const description = params.description;
        const category = params.category || 'otros';
        if (!Number.isFinite(amount) || !description) {
          return { name, success: false, result: '', error: 'Faltan parámetros requeridos (amount, description)' };
        }
        const currency = typeof params.currency === 'string' && params.currency.trim() ? params.currency.trim().toUpperCase() : 'EUR';
        const dateMs = params.date ? Date.parse(params.date) : Date.now();
        const recurring = params.recurring === 'true' || params.recurring === true;
        const recurringFrequency = typeof params.recurring_frequency === 'string' ? params.recurring_frequency.trim() : undefined;
        const tags = params.tags ? String(params.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        const expense = storage.createExpense(userId, agentId, {
          amount,
          currency,
          category,
          description,
          date: Number.isFinite(dateMs) ? dateMs : Date.now(),
          recurring,
          recurringFrequency,
          tags,
        });
        recordResourceEvent('agent_expense_operation', { operation: 'add_expense', expenseId: expense.id });
        // Track for undo
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: expense.id,
          inverseAction: { toolName: 'delete_expense', params: { expense_id: expense.id } },
          timestamp: Date.now(),
        });
        const dateStr = new Date(expense.date).toLocaleDateString('es-ES');
        const recurringText = expense.recurring ? ` (recurrente: ${expense.recurringFrequency || 'mensual'})` : '';
        return {
          name,
          success: true,
          result: `💰 Gasto registrado:\n- ${expense.amount.toFixed(2)} ${expense.currency} — ${expense.description}\n- Categoría: ${expense.category}\n- Fecha: ${dateStr}${recurringText}\n- ID: ${expense.id}`,
        };
      }

      case 'list_expenses': {
        const filters: any = {};
        if (params.category) filters.category = params.category;
        if (params.start_date) {
          const ms = Date.parse(params.start_date);
          if (Number.isFinite(ms)) filters.startDate = ms;
        }
        if (params.end_date) {
          const ms = Date.parse(params.end_date);
          if (Number.isFinite(ms)) filters.endDate = ms;
        }
        if (params.query) filters.query = params.query;
        const expenses = storage.searchExpenses(userId, agentId, filters);
        if (expenses.length === 0) {
          return { name, success: true, result: 'No hay gastos registrados con esos filtros.' };
        }
        const total = expenses.reduce((sum, e) => sum + e.amount, 0);
        const currency = expenses[0].currency;
        const expensesList = expenses.slice(0, 20).map((e, i) => {
          const dateStr = new Date(e.date).toLocaleDateString('es-ES');
          const rec = e.recurring ? ' 🔄' : '';
          return `${i + 1}. ${e.amount.toFixed(2)} ${e.currency} — ${e.description} (${e.category})${rec}\n   📅 ${dateStr} | ID: ${e.id}`;
        }).join('\n\n');
        const moreText = expenses.length > 20 ? `\n\n... y ${expenses.length - 20} más` : '';
        return {
          name,
          success: true,
          result: `💰 Gastos (${expenses.length}) | Total: ${total.toFixed(2)} ${currency}\n\n${expensesList}${moreText}`,
        };
      }

      case 'expense_summary': {
        let startDate: number | undefined;
        let endDate: number | undefined;
        const period = typeof params.period === 'string' ? params.period.trim().toLowerCase() : '';
        const now = new Date();
        if (period === 'hoy') {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
          endDate = now.getTime();
        } else if (period === 'esta_semana') {
          const dayOfWeek = now.getDay();
          const monday = new Date(now);
          monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
          monday.setHours(0, 0, 0, 0);
          startDate = monday.getTime();
          endDate = now.getTime();
        } else if (period === 'este_mes') {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          endDate = now.getTime();
        } else if (period === 'este_año' || period === 'este_ano') {
          startDate = new Date(now.getFullYear(), 0, 1).getTime();
          endDate = now.getTime();
        } else {
          if (params.start_date) {
            const ms = Date.parse(params.start_date);
            if (Number.isFinite(ms)) startDate = ms;
          }
          if (params.end_date) {
            const ms = Date.parse(params.end_date);
            if (Number.isFinite(ms)) endDate = ms;
          }
        }
        const summary = storage.getExpenseSummary(userId, agentId, startDate, endDate);
        if (summary.count === 0) {
          return { name, success: true, result: 'No hay gastos registrados en ese período.' };
        }
        const categoryBreakdown = Object.entries(summary.byCategory)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, amt]) => `  • ${cat}: ${amt.toFixed(2)} ${summary.currency}`)
          .join('\n');
        const periodLabel = period || (startDate && endDate
          ? `${new Date(startDate).toLocaleDateString('es-ES')} — ${new Date(endDate).toLocaleDateString('es-ES')}`
          : 'todo el historial');
        return {
          name,
          success: true,
          result: `📊 Resumen de gastos (${periodLabel}):\n\n💰 Total: ${summary.total.toFixed(2)} ${summary.currency}\n📊 ${summary.count} gastos registrados\n\nDesglose por categoría:\n${categoryBreakdown}`,
        };
      }

      case 'delete_expense': {
        const expenseId = params.expense_id;
        if (!expenseId) return { name, success: false, result: '', error: 'Falta el parámetro "expense_id"' };
        const deleted = storage.deleteExpense(userId, agentId, expenseId);
        if (deleted) {
          recordResourceEvent('agent_expense_operation', { operation: 'delete_expense', expenseId });
        }
        return {
          name,
          success: deleted,
          result: deleted ? '🗑️ Gasto eliminado correctamente.' : 'No se encontró el gasto.',
          error: deleted ? undefined : 'Gasto no encontrado',
        };
      }

      case 'export_expenses': {
        let startDate: number | undefined;
        let endDate: number | undefined;
        if (params.start_date) {
          const ms = Date.parse(params.start_date);
          if (Number.isFinite(ms)) startDate = ms;
        }
        if (params.end_date) {
          const ms = Date.parse(params.end_date);
          if (Number.isFinite(ms)) endDate = ms;
        }
        const csv = storage.exportExpensesToCSV(userId, agentId, startDate, endDate);
        if (csv.split('\n').length <= 1) {
          return { name, success: true, result: 'No hay gastos para exportar.' };
        }
        return {
          name,
          success: true,
          result: `📄 Exportación CSV de gastos:\n\n\`\`\`\n${csv}\n\`\`\`\n\nPuedes copiar este CSV y pegarlo en una hoja de cálculo.`,
        };
      }

      // ── Telegram Buttons ───────────────────────────────────────────────
      case 'send_telegram_buttons': {
        const msgText = params.message;
        const buttonsStr = params.buttons;
        if (!msgText || !buttonsStr) {
          return { name, success: false, result: '', error: 'Faltan parámetros requeridos (message, buttons)' };
        }
        let inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
        try {
          inlineKeyboard = JSON.parse(buttonsStr);
        } catch {
          return { name, success: false, result: '', error: 'El formato de botones es inválido. Debe ser JSON array de arrays.' };
        }
        if (context.sendTelegramMessageWithButtons) {
          const sent = await context.sendTelegramMessageWithButtons(msgText, inlineKeyboard);
          return {
            name,
            success: sent,
            result: sent ? 'Mensaje con botones enviado por Telegram.' : 'Error al enviar el mensaje con botones.',
          };
        }
        // Fallback: send as regular message with text buttons
        const buttonText = inlineKeyboard.map(row =>
          row.map(btn => btn.text).join(' | ')
        ).join('\n');
        const sent = await context.sendTelegramMessage(`${msgText}\n\n${buttonText}`);
        return {
          name,
          success: sent,
          result: sent ? 'Mensaje con opciones enviado por Telegram (sin botones interactivos).' : 'Error al enviar.',
        };
      }

      // ── File/Document Processing ───────────────────────────────────────
      case 'process_telegram_file': {
        const fileId = params.file_id;
        if (!fileId) return { name, success: false, result: '', error: 'Falta el parámetro "file_id"' };
        if (!context.downloadTelegramFile) {
          return { name, success: false, result: '', error: 'La descarga de archivos de Telegram no está disponible.' };
        }
        const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : 'read';
        try {
          const downloaded = await context.downloadTelegramFile(fileId);
          if (!downloaded) {
            return { name, success: false, result: '', error: 'No se pudo descargar el archivo de Telegram. Puede que sea demasiado grande (>20MB) o haya expirado.' };
          }
          const { data, mimeType, fileName } = downloaded;
          let extractedText = '';

          // Extract text based on MIME type
          if (mimeType.includes('audio/') || mimeType.includes('video/ogg')) {
            // Audio files — transcribe with Whisper
            try {
              const transcription = await transcribeAudio(data, mimeType, fileName);
              extractedText = transcription.text.trim()
                ? `[Transcripción de audio (${transcription.provider}, idioma: ${transcription.language || 'auto'}, duración: ${transcription.duration ? `${Math.round(transcription.duration)}s` : '?'})]\n\n${transcription.text.trim()}`
                : '[Audio procesado pero no se detectó contenido de voz.]';
            } catch (err: any) {
              extractedText = `[Audio: ${fileName}, tipo: ${mimeType}, tamaño: ${Math.round(data.length / 1024)} KB. Error al transcribir: ${err.message}. Usa transcribe_telegram_audio para reintentar.]`;
            }
          } else if (mimeType.includes('text/') || mimeType.includes('application/json') || mimeType.includes('application/xml') || mimeType.includes('application/javascript')) {
            // Plain text files
            extractedText = data.toString('utf-8').slice(0, 15000);
          } else if (mimeType.includes('application/pdf')) {
            // Basic PDF text extraction (look for text streams)
            const pdfRaw = data.toString('latin1');
            const textParts: string[] = [];
            // Extract text between BT and ET operators
            const btRegex = /BT\s([\s\S]*?)ET/g;
            let btMatch;
            while ((btMatch = btRegex.exec(pdfRaw)) !== null) {
              const block = btMatch[1];
              const tjRegex = /\(([^)]*)\)\s*Tj|\[(.*?)\]\s*TJ/g;
              let tjMatch;
              while ((tjMatch = tjRegex.exec(block)) !== null) {
                const text = tjMatch[1] || (tjMatch[2] || '').replace(/\([^)]*\)/g, (m) => m.slice(1, -1)).replace(/-?\d+\.?\d*/g, ' ');
                if (text.trim()) textParts.push(text.trim());
              }
            }
            extractedText = textParts.join(' ').replace(/\s+/g, ' ').trim();
            if (!extractedText) {
              extractedText = `[PDF detectado: ${fileName}, ${Math.round(data.length / 1024)} KB. No se pudo extraer texto legible — puede ser un PDF escaneado/imagen. Instala un paquete OCR en el servidor para procesarlo.]`;
            } else {
              extractedText = extractedText.slice(0, 15000);
            }
          } else if (mimeType.includes('image/')) {
            // Images — try AI vision analysis, fall back to basic info
            try {
              const visionResult = await analyzeImage(
                data,
                mimeType,
                'Describe esta imagen en detalle. Si contiene texto, transcríbelo completo.',
                context.agentConfig.provider,
                context.agentConfig.model
              );
              extractedText = `[Análisis de imagen por IA (${visionResult.provider}/${visionResult.model})]\n\n${visionResult.description}`;
            } catch {
              extractedText = `[Imagen recibida: ${fileName}, tipo: ${mimeType}, tamaño: ${Math.round(data.length / 1024)} KB. Usa analyze_telegram_image para analizar la imagen con IA.]`;
            }
          } else if (mimeType.includes('application/vnd.openxmlformats') || mimeType.includes('application/msword')) {
            // Office documents — basic XML extraction for docx
            if (fileName.endsWith('.docx')) {
              const textContent = data.toString('utf-8');
              const xmlTextRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
              const parts: string[] = [];
              let xMatch;
              while ((xMatch = xmlTextRegex.exec(textContent)) !== null) {
                if (xMatch[1]) parts.push(xMatch[1]);
              }
              extractedText = parts.join(' ').slice(0, 15000) || `[Documento Office: ${fileName}. No se pudo extraer texto.]`;
            } else {
              extractedText = `[Documento Office: ${fileName}, tipo: ${mimeType}, tamaño: ${Math.round(data.length / 1024)} KB.]`;
            }
          } else {
            extractedText = `[Archivo recibido: ${fileName}, tipo: ${mimeType}, tamaño: ${Math.round(data.length / 1024)} KB. Tipo no soportado para extracción de texto.]`;
          }

          // Store the file reference
          storage.storeTelegramFile(userId, agentId, {
            telegramFileId: fileId,
            fileName,
            mimeType,
            fileSize: data.length,
            extractedText: extractedText.slice(0, 5000),
            type: mimeType.includes('image/') ? 'photo' : 'document',
          });

          // Handle action
          if (action === 'save_note' && extractedText) {
            const noteTitle = params.note_title || `📎 ${fileName}`;
            storage.createNote(userId, agentId, noteTitle, extractedText, ['telegram', 'archivo']);
            return {
              name,
              success: true,
              result: `📎 Archivo "${fileName}" procesado y guardado como nota "${noteTitle}".\n\nContenido extraído (primeros 500 chars):\n${extractedText.slice(0, 500)}${extractedText.length > 500 ? '...' : ''}`,
            };
          }

          recordResourceEvent('agent_file_processing', { fileName, mimeType });
          return {
            name,
            success: true,
            result: `📎 Archivo "${fileName}" procesado (${mimeType}, ${Math.round(data.length / 1024)} KB).\n\nContenido extraído:\n${extractedText.slice(0, 3000)}${extractedText.length > 3000 ? '\n\n... [contenido truncado]' : ''}`,
          };
        } catch (error: any) {
          return { name, success: false, result: '', error: `Error procesando archivo: ${error.message}` };
        }
      }

      // ── Audio Transcription ────────────────────────────────────────────
      case 'transcribe_telegram_audio': {
        const fileId = params.file_id;
        if (!fileId) return { name, success: false, result: '', error: 'Falta el parámetro "file_id"' };
        if (!context.downloadTelegramFile) {
          return { name, success: false, result: '', error: 'La descarga de archivos de Telegram no está disponible.' };
        }
        const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : 'read';
        try {
          const downloaded = await context.downloadTelegramFile(fileId);
          if (!downloaded) {
            return { name, success: false, result: '', error: 'No se pudo descargar el audio de Telegram. Puede que sea demasiado grande (>20MB) o haya expirado.' };
          }
          const { data, mimeType, fileName } = downloaded;

          // Transcribe with Whisper
          const transcription = await transcribeAudio(data, mimeType, fileName);
          const transcribedText = transcription.text.trim();

          if (!transcribedText) {
            return { name, success: true, result: '🎤 Audio procesado pero no se detectó contenido de voz.' };
          }

          // Store the file reference
          storage.storeTelegramFile(userId, agentId, {
            telegramFileId: fileId,
            fileName,
            mimeType,
            fileSize: data.length,
            extractedText: transcribedText.slice(0, 5000),
            type: 'document',
          });

          recordResourceEvent('agent_audio_transcription', {
            fileName,
            mimeType,
            provider: transcription.provider,
            duration: transcription.duration,
            language: transcription.language,
          });

          // Handle action
          if (action === 'save_note') {
            const noteTitle = params.note_title || `🎤 Transcripción de audio`;
            const noteContent = `Transcripción de audio (${transcription.provider}, idioma: ${transcription.language || 'auto'}, duración: ${transcription.duration ? `${Math.round(transcription.duration)}s` : '?'}):\n\n${transcribedText}`;
            storage.createNote(userId, agentId, noteTitle, noteContent, ['telegram', 'audio', 'transcripción']);
            return {
              name,
              success: true,
              result: `🎤 Audio transcrito y guardado como nota "${noteTitle}".\n\nTranscripción (${transcription.provider}):\n${transcribedText}`,
            };
          }

          return {
            name,
            success: true,
            result: `🎤 Audio transcrito correctamente (${transcription.provider}, idioma: ${transcription.language || 'auto'}, duración: ${transcription.duration ? `${Math.round(transcription.duration)}s` : '?'}).\n\nTranscripción:\n${transcribedText}`,
          };
        } catch (error: any) {
          return { name, success: false, result: '', error: `Error transcribiendo audio: ${error.message}` };
        }
      }

      // ── Image Analysis ─────────────────────────────────────────────────
      case 'analyze_telegram_image': {
        const fileId = params.file_id;
        if (!fileId) return { name, success: false, result: '', error: 'Falta el parámetro "file_id"' };
        if (!context.downloadTelegramFile) {
          return { name, success: false, result: '', error: 'La descarga de archivos de Telegram no está disponible.' };
        }
        const action = typeof params.action === 'string' ? params.action.trim().toLowerCase() : 'read';
        const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
        try {
          const downloaded = await context.downloadTelegramFile(fileId);
          if (!downloaded) {
            return { name, success: false, result: '', error: 'No se pudo descargar la imagen de Telegram. Puede que sea demasiado grande (>20MB) o haya expirado.' };
          }
          const { data, mimeType, fileName } = downloaded;

          if (!mimeType.includes('image/')) {
            return { name, success: false, result: '', error: `El archivo "${fileName}" no es una imagen (tipo: ${mimeType}).` };
          }

          // Analyze with vision LLM
          const analysis = await analyzeImage(
            data,
            mimeType,
            prompt || 'Describe esta imagen en detalle. Si contiene texto, transcríbelo completo. Si es un gráfico, describe los datos y tendencias.',
            context.agentConfig.provider,
            context.agentConfig.model
          );

          // Store the file reference
          storage.storeTelegramFile(userId, agentId, {
            telegramFileId: fileId,
            fileName,
            mimeType,
            fileSize: data.length,
            extractedText: analysis.description.slice(0, 5000),
            type: 'photo',
          });

          recordResourceEvent('agent_image_analysis', {
            fileName,
            mimeType,
            provider: analysis.provider,
            model: analysis.model,
          });

          // Handle action
          if (action === 'save_note') {
            const noteTitle = params.note_title || `📷 Análisis de imagen`;
            storage.createNote(userId, agentId, noteTitle, analysis.description, ['telegram', 'imagen', 'análisis']);
            return {
              name,
              success: true,
              result: `📷 Imagen analizada y guardada como nota "${noteTitle}".\n\nAnálisis (${analysis.provider}/${analysis.model}):\n${analysis.description}`,
            };
          }

          return {
            name,
            success: true,
            result: `📷 Imagen analizada correctamente (${analysis.provider}/${analysis.model}).\n\nAnálisis:\n${analysis.description}`,
          };
        } catch (error: any) {
          return { name, success: false, result: '', error: `Error analizando imagen: ${error.message}` };
        }
      }

      // ── Undo ───────────────────────────────────────────────────────────
      case 'undo_last_action': {
        const lastEntry = storage.popUndoEntry(userId, agentId);
        if (!lastEntry) {
          return { name, success: false, result: '', error: 'No hay acciones para deshacer.' };
        }
        if (!lastEntry.inverseAction) {
          return { name, success: false, result: '', error: `La última acción "${lastEntry.toolName}" no se puede deshacer automáticamente.` };
        }
        // Execute the inverse action
        const inverseCall = { name: lastEntry.inverseAction.toolName, params: lastEntry.inverseAction.params };
        try {
          const inverseResult = await executeTool(inverseCall, context);
          recordResourceEvent('agent_undo', { originalTool: lastEntry.toolName });
          const timeStr = new Date(lastEntry.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          return {
            name,
            success: inverseResult.success,
            result: inverseResult.success
              ? `↩️ Acción "${lastEntry.toolName}" (${timeStr}) deshecha correctamente.\nDetalle: ${inverseResult.result.slice(0, 300)}`
              : `⚠️ Error al deshacer "${lastEntry.toolName}": ${inverseResult.error || 'Error desconocido'}`,
            error: inverseResult.success ? undefined : inverseResult.error,
          };
        } catch (error: any) {
          return { name, success: false, result: '', error: `Error al ejecutar undo: ${error.message}` };
        }
      }

      // ── Location-Based Reminders ───────────────────────────────────────
      case 'set_location_reminder': {
        const reminderName = params.name;
        const message = params.message;
        const lat = typeof params.latitude === 'number' ? params.latitude : parseFloat(String(params.latitude || ''));
        const lng = typeof params.longitude === 'number' ? params.longitude : parseFloat(String(params.longitude || ''));
        const radius = typeof params.radius_meters === 'number' ? params.radius_meters : 200;
        if (!reminderName || !message) {
          return { name, success: false, result: '', error: 'Faltan parámetros requeridos (name, message)' };
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return { name, success: false, result: '', error: 'Las coordenadas (latitude, longitude) deben ser números válidos.' };
        }
        const locReminder = storage.createLocationReminder(userId, agentId, {
          name: reminderName,
          message,
          latitude: lat,
          longitude: lng,
          radiusMeters: radius,
        });
        recordResourceEvent('agent_location_reminder', { operation: 'create', reminderId: locReminder.id });
        // Push undo entry
        storage.pushUndoEntry(userId, agentId, {
          id: `undo-${Date.now()}`,
          toolName: name,
          params,
          result: locReminder.id,
          inverseAction: { toolName: 'cancel_location_reminder', params: { reminder_id: locReminder.id } },
          timestamp: Date.now(),
        });
        return {
          name,
          success: true,
          result: `📍 Recordatorio de ubicación creado: "${reminderName}"\n📌 Coordenadas: ${lat.toFixed(6)}, ${lng.toFixed(6)}\n📏 Radio: ${radius}m\n💬 Mensaje: ${message}\n🔑 ID: ${locReminder.id}\n\nSe activará cuando compartas tu ubicación por Telegram y estés dentro del radio.`,
        };
      }

      case 'list_location_reminders': {
        const reminders = storage.getAllLocationReminders(userId, agentId);
        if (reminders.length === 0) {
          return { name, success: true, result: 'No hay recordatorios de ubicación activos.' };
        }
        const remindersList = reminders
          .filter(r => r.enabled)
          .map((r, i) => {
            const created = new Date(r.createdAt).toLocaleDateString('es-ES');
            return `${i + 1}. 📍 **${r.name}** (ID: ${r.id})\n   📌 ${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)} | 📏 ${r.radiusMeters}m\n   💬 ${r.message.slice(0, 100)}\n   📅 Creado: ${created}`;
          }).join('\n\n');
        return {
          name,
          success: true,
          result: `📍 Recordatorios de ubicación activos (${reminders.filter(r => r.enabled).length}):\n\n${remindersList || 'Ninguno activo.'}`,
        };
      }

      case 'cancel_location_reminder': {
        const reminderId = params.reminder_id;
        if (!reminderId) return { name, success: false, result: '', error: 'Falta el parámetro "reminder_id"' };
        const reminders = storage.getAllLocationReminders(userId, agentId);
        const found = reminders.find(r =>
          r.id === reminderId || r.name.toLowerCase().includes(reminderId.toLowerCase())
        );
        if (!found) return { name, success: false, result: '', error: `No se encontró el recordatorio de ubicación "${reminderId}"` };
        const deleted = storage.deleteLocationReminder(userId, agentId, found.id);
        return {
          name,
          success: deleted,
          result: deleted ? `❌ Recordatorio de ubicación "${found.name}" cancelado.` : 'Error al cancelar.',
        };
      }

      case 'check_location': {
        const lat = typeof params.latitude === 'number' ? params.latitude : parseFloat(String(params.latitude || ''));
        const lng = typeof params.longitude === 'number' ? params.longitude : parseFloat(String(params.longitude || ''));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return { name, success: false, result: '', error: 'Coordenadas inválidas.' };
        }
        const reminders = storage.getAllLocationReminders(userId, agentId).filter(r => r.enabled);
        if (reminders.length === 0) {
          return { name, success: true, result: 'No hay recordatorios de ubicación activos.' };
        }
        const triggered: string[] = [];
        const nearby: string[] = [];
        const cooldownMs = 30 * 60 * 1000; // 30 minutes cooldown

        for (const reminder of reminders) {
          const { isNear, distanceMeters } = storage.checkLocationProximity(
            lat, lng, reminder.latitude, reminder.longitude, reminder.radiusMeters
          );
          if (isNear) {
            // Check cooldown to avoid spamming
            if (reminder.lastTriggered && (Date.now() - reminder.lastTriggered) < cooldownMs) {
              nearby.push(`📍 "${reminder.name}" — estás dentro del radio (${distanceMeters}m) pero ya fue notificado recientemente.`);
              continue;
            }
            triggered.push(`🔔 **${reminder.name}**: ${reminder.message} (a ${distanceMeters}m)`);
            // Update last triggered
            storage.updateLocationReminder(userId, agentId, reminder.id, { lastTriggered: Date.now() });
            // Send Telegram notification
            context.sendTelegramMessage(`🔔📍 Recordatorio de ubicación:\n\n*${reminder.name}*\n${reminder.message}\n\n📏 Estás a ${distanceMeters}m del punto configurado.`).catch(() => {});
          } else if (distanceMeters <= reminder.radiusMeters * 3) {
            nearby.push(`📍 "${reminder.name}" — a ${distanceMeters}m (radio: ${reminder.radiusMeters}m)`);
          }
        }

        const parts: string[] = [];
        if (triggered.length > 0) {
          parts.push(`📍 Recordatorios activados (${triggered.length}):\n${triggered.join('\n')}`);
        }
        if (nearby.length > 0) {
          parts.push(`📍 Recordatorios cercanos:\n${nearby.join('\n')}`);
        }
        if (parts.length === 0) {
          parts.push(`📍 Ubicación recibida (${lat.toFixed(6)}, ${lng.toFixed(6)}). No hay recordatorios cercanos.`);
        }
        return { name, success: true, result: parts.join('\n\n') };
      }

      // ── Radarr (Movies) ────────────────────────────────────────────────
      case 'radarr_search_movie': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media (Radarr/Sonarr).' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado. Configúralo en Integraciones del agente.' };
        }
        const query = params.query;
        if (!query) return { name, success: false, result: '', error: 'Falta el parámetro "query"' };
        try {
          const rawQuery = String(query).trim();
          const normalizedQuery = normalizeMediaLookupQuery(rawQuery);

          // Check if query is an external ID lookup (imdb:xxx, tmdb:xxx)
          const imdbMatch = rawQuery.match(/^imdb:(tt\d+)$/i);
          const tmdbMatch = rawQuery.match(/^tmdb:(\d+)$/i);

          if (imdbMatch || tmdbMatch) {
            // Direct ID lookup with fallback
            const ids: { imdbId?: string; tmdbId?: number } = {};
            if (imdbMatch) ids.imdbId = imdbMatch[1];
            if (tmdbMatch) ids.tmdbId = parseInt(tmdbMatch[1]);

            const movie = await radarr.lookupMovieByExternalId(radarrConfig, ids);
            if (!movie) {
              return { name, success: true, result: `🎬 No se encontró ninguna película con el ID proporcionado (${query}).` };
            }
            const rating = movie.ratings?.tmdb?.value ? ` | ⭐ ${movie.ratings.tmdb.value.toFixed(1)}` : '';
            const genres = movie.genres?.slice(0, 3).join(', ') || '';
            recordResourceEvent('agent_media_operation', { operation: 'radarr_search_by_id', query });
            return { name, success: true, result: `🎬 Película identificada con exactitud:\n\n1. **${movie.title}** (${movie.year}) [TMDB: ${movie.tmdbId}]${movie.imdbId ? ` [IMDb: ${movie.imdbId}]` : ''}${rating}\n   ${genres ? `🎭 ${genres} | ` : ''}${movie.runtime ? `⏱️ ${movie.runtime}min` : ''}\n   ${movie.overview ? movie.overview.slice(0, 200) + (movie.overview.length > 200 ? '...' : '') : 'Sin sinopsis'}\n\n💡 Usa radarr_add_movie con tmdb_id=${movie.tmdbId}${movie.imdbId ? ` o imdb_id="${movie.imdbId}"` : ''} para añadirla.` };
          }

          const resolvedFromWeb = await resolveMovieByInternetId(radarrConfig, normalizedQuery);
          if (resolvedFromWeb) {
            const rating = resolvedFromWeb.ratings?.tmdb?.value ? ` | ⭐ ${resolvedFromWeb.ratings.tmdb.value.toFixed(1)}` : '';
            const genres = resolvedFromWeb.genres?.slice(0, 3).join(', ') || '';
            recordResourceEvent('agent_media_operation', { operation: 'radarr_search_by_web_id', query: normalizedQuery });
            return { name, success: true, result: `🎬 Película identificada por ID externo (resuelto desde internet):\n\n1. **${resolvedFromWeb.title}** (${resolvedFromWeb.year}) [TMDB: ${resolvedFromWeb.tmdbId}]${resolvedFromWeb.imdbId ? ` [IMDb: ${resolvedFromWeb.imdbId}]` : ''}${rating}\n   ${genres ? `🎭 ${genres} | ` : ''}${resolvedFromWeb.runtime ? `⏱️ ${resolvedFromWeb.runtime}min` : ''}\n   ${resolvedFromWeb.overview ? resolvedFromWeb.overview.slice(0, 200) + (resolvedFromWeb.overview.length > 200 ? '...' : '') : 'Sin sinopsis'}\n\n💡 Usa radarr_add_movie con tmdb_id=${resolvedFromWeb.tmdbId}${resolvedFromWeb.imdbId ? ` o imdb_id="${resolvedFromWeb.imdbId}"` : ''} para añadirla.` };
          }

          // Regular text search with disambiguation
          let { results, needsDisambiguation, disambiguation } = await radarr.searchMoviesWithDisambiguation(radarrConfig, normalizedQuery);
          if (results.length === 0 && normalizedQuery !== rawQuery) {
            const fallback = await radarr.searchMoviesWithDisambiguation(radarrConfig, rawQuery);
            results = fallback.results;
            needsDisambiguation = fallback.needsDisambiguation;
            disambiguation = fallback.disambiguation;
          }
          if (results.length === 0) {
            return { name, success: true, result: `🎬 No se encontraron películas para "${rawQuery}".` };
          }

          // If disambiguation needed, format specifically to ask the user
          if (needsDisambiguation && disambiguation) {
            const optionsList = disambiguation.options.map((opt, i) => {
              return `${i + 1}. **${disambiguation.title}** (${opt.year}) [TMDB: ${opt.tmdbId}]${opt.imdbId ? ` [IMDb: ${opt.imdbId}]` : ''}\n   ${opt.overview || 'Sin sinopsis'}`;
            }).join('\n\n');
            recordResourceEvent('agent_media_operation', { operation: 'radarr_search_disambiguation', query: normalizedQuery });
            return { name, success: true, result: `🎬 He encontrado varias películas con el título "${disambiguation.title}" de diferentes años (${disambiguation.years.join(', ')}).\n\n⚠️ **¿De qué año te refieres?**\n\n${optionsList}\n\n💡 Indícame el año o el número de la opción para identificarla con exactitud.` };
          }

          const moviesList = results.slice(0, 10).map((m, i) => {
            const rating = m.ratings?.tmdb?.value ? ` | ⭐ ${m.ratings.tmdb.value.toFixed(1)}` : '';
            const genres = m.genres?.slice(0, 3).join(', ') || '';
            return `${i + 1}. **${m.title}** (${m.year}) [TMDB: ${m.tmdbId}]${m.imdbId ? ` [IMDb: ${m.imdbId}]` : ''}${rating}\n   ${genres ? `🎭 ${genres} | ` : ''}${m.runtime ? `⏱️ ${m.runtime}min` : ''}\n   ${m.overview ? m.overview.slice(0, 150) + (m.overview.length > 150 ? '...' : '') : 'Sin sinopsis'}`;
          }).join('\n\n');
          recordResourceEvent('agent_media_operation', { operation: 'radarr_search', query: normalizedQuery });
          return { name, success: true, result: `🎬 Resultados de búsqueda para "${rawQuery}" (${results.length}):\n\n${moviesList}\n\n💡 Usa radarr_add_movie con el tmdb_id (o imdb_id) para añadir una película.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error buscando en Radarr: ${err.message}` };
        }
      }

      case 'radarr_add_movie': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        const tmdbId = typeof params.tmdb_id === 'number' ? params.tmdb_id : (params.tmdb_id ? parseInt(String(params.tmdb_id)) : NaN);
        const imdbId = typeof params.imdb_id === 'string' && params.imdb_id.trim() ? params.imdb_id.trim() : undefined;

        if (!Number.isFinite(tmdbId) && !imdbId) {
          return { name, success: false, result: '', error: 'Falta al menos uno de: "tmdb_id" (número) o "imdb_id" (string). Proporciona uno para identificar la película.' };
        }

        try {
          // Resolve the movie using external IDs with fallback
          let resolvedTmdbId = Number.isFinite(tmdbId) ? tmdbId : 0;

          // If we only have imdb_id (or want to validate), do a lookup with fallback
          if (!Number.isFinite(tmdbId) && imdbId) {
            const lookup = await radarr.lookupMovieByExternalId(radarrConfig, { imdbId });
            if (!lookup) {
              return { name, success: false, result: '', error: `No se pudo resolver la película con IMDb ID "${imdbId}". Intenta con un tmdb_id.` };
            }
            resolvedTmdbId = lookup.tmdbId;
          }

          // Check if already in library (using all available IDs)
          const existing = await radarr.isMovieInLibraryByExternalId(radarrConfig, {
            tmdbId: Number.isFinite(resolvedTmdbId) ? resolvedTmdbId : undefined,
            imdbId,
          });
          if (existing) {
            const fileStatus = existing.hasFile ? '✅ Descargada' : '⏳ Pendiente de descarga';
            return { name, success: true, result: `🎬 "${existing.title}" (${existing.year}) ya está en la biblioteca.\n📦 Estado: ${fileStatus}\n🔑 ID: ${existing.id}${existing.imdbId ? ` | IMDb: ${existing.imdbId}` : ''} | TMDB: ${existing.tmdbId}` };
          }
          const searchForMovie = params.search === 'true';
          const movie = await radarr.addMovie(radarrConfig, resolvedTmdbId, { searchForMovie });
          recordResourceEvent('agent_media_operation', { operation: 'radarr_add', movieId: movie.id, title: movie.title });
          const nextStep = searchForMovie
            ? '🔍 Búsqueda de descarga iniciada automáticamente'
            : `⏸️ Añadida sin búsqueda automática.\n\n💡 Usa radarr_get_releases con movie_id=${movie.id} para ver las opciones de descarga y elegir la mejor.`;
          return { name, success: true, result: `🎬 Película añadida a Radarr:\n- **${movie.title}** (${movie.year})\n- 🔑 ID: ${movie.id} | TMDB: ${movie.tmdbId}${movie.imdbId ? ` | IMDb: ${movie.imdbId}` : ''}\n- ${nextStep}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error añadiendo película: ${err.message}` };
        }
      }

      case 'radarr_library': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        try {
          let movies = await radarr.getLibraryMovies(radarrConfig);
          const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';
          if (query) {
            movies = movies.filter(m => m.title.toLowerCase().includes(query));
          }
          if (movies.length === 0) {
            return { name, success: true, result: query ? `🎬 No hay películas que coincidan con "${query}" en la biblioteca.` : '🎬 La biblioteca de Radarr está vacía.' };
          }
          const moviesList = movies.slice(0, 25).map((m, i) => {
            const fileStatus = m.hasFile ? '✅' : '❌';
            const quality = m.movieFile?.quality?.quality?.name || '-';
            const size = m.sizeOnDisk > 0 ? `${(m.sizeOnDisk / 1073741824).toFixed(1)} GB` : '-';
            return `${i + 1}. ${fileStatus} **${m.title}** (${m.year}) [ID: ${m.id}]\n   📦 Calidad: ${quality} | 💾 ${size}`;
          }).join('\n');
          const moreText = movies.length > 25 ? `\n\n... y ${movies.length - 25} más` : '';
          recordResourceEvent('agent_media_operation', { operation: 'radarr_library' });
          return { name, success: true, result: `🎬 Biblioteca de Radarr (${movies.length} películas):\n\n${moviesList}${moreText}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando biblioteca: ${err.message}` };
        }
      }

      case 'radarr_movie_status': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        const title = params.title;
        if (!title) return { name, success: false, result: '', error: 'Falta el parámetro "title"' };
        try {
          const movie = await radarr.findMovieInLibrary(radarrConfig, title);
          if (!movie) {
            return { name, success: true, result: `🎬 "${title}" no está en la biblioteca de Radarr.` };
          }
          const fileStatus = movie.hasFile ? '✅ Descargada' : '❌ No descargada';
          const quality = movie.movieFile?.quality?.quality?.name || '-';
          const size = movie.sizeOnDisk > 0 ? `${(movie.sizeOnDisk / 1073741824).toFixed(1)} GB` : '-';
          const monitored = movie.monitored ? '🟢 Monitorizada' : '🔴 No monitorizada';
          return { name, success: true, result: `🎬 **${movie.title}** (${movie.year})\n🔑 ID: ${movie.id} | TMDB: ${movie.tmdbId}${movie.imdbId ? ` | IMDb: ${movie.imdbId}` : ''}\n📦 Estado: ${fileStatus}\n🎥 Calidad: ${quality} | 💾 Tamaño: ${size}\n${monitored} | Estado: ${movie.status}\n${movie.genres?.length ? `🎭 Géneros: ${movie.genres.join(', ')}` : ''}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando película: ${err.message}` };
        }
      }

      case 'radarr_queue': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        try {
          const queue = await radarr.getQueue(radarrConfig);
          if (queue.length === 0) {
            return { name, success: true, result: '🎬 No hay descargas activas en Radarr.' };
          }
          const queueList = queue.map((item, i) => {
            const progress = item.size > 0 ? ((1 - item.sizeleft / item.size) * 100).toFixed(1) : '0';
            const sizeTotal = (item.size / 1073741824).toFixed(2);
            const sizeLeft = (item.sizeleft / 1073741824).toFixed(2);
            const quality = item.quality?.quality?.name || '-';
            const timeLeft = item.timeleft || 'calculando...';
            const statusIcon = item.trackedDownloadState === 'downloading' ? '⬇️' :
              item.trackedDownloadState === 'importPending' ? '📥' :
              item.trackedDownloadState === 'failedPending' ? '❌' : '⏳';
            return `${i + 1}. ${statusIcon} **${item.title}**\n   📊 ${progress}% | ⏱️ ${timeLeft} | 💾 ${sizeLeft}/${sizeTotal} GB\n   🎥 ${quality} | 📡 ${item.protocol || '-'} | ${item.downloadClient || '-'}`;
          }).join('\n\n');
          recordResourceEvent('agent_media_operation', { operation: 'radarr_queue' });
          return { name, success: true, result: `🎬 Descargas activas de Radarr (${queue.length}):\n\n${queueList}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando cola: ${err.message}` };
        }
      }

      case 'radarr_get_releases': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        const movieId = typeof params.movie_id === 'number' ? params.movie_id : parseInt(String(params.movie_id));
        if (!Number.isFinite(movieId)) {
          return { name, success: false, result: '', error: 'Falta el parámetro "movie_id" (número)' };
        }
        const minSizeGb = Number.isFinite(Number(params.min_size_gb)) ? Number(params.min_size_gb) : null;
        const maxSizeGb = Number.isFinite(Number(params.max_size_gb)) ? Number(params.max_size_gb) : null;
        if (minSizeGb !== null && minSizeGb < 0) {
          return { name, success: false, result: '', error: '"min_size_gb" debe ser >= 0.' };
        }
        if (maxSizeGb !== null && maxSizeGb < 0) {
          return { name, success: false, result: '', error: '"max_size_gb" debe ser >= 0.' };
        }
        if (minSizeGb !== null && maxSizeGb !== null && minSizeGb > maxSizeGb) {
          return { name, success: false, result: '', error: '"min_size_gb" no puede ser mayor que "max_size_gb".' };
        }
        try {
          const movie = await radarr.getMovie(radarrConfig, movieId);
          let fetchedLimit = 5;
          let expandedSearches = 1;
          let candidateReleases = await radarr.getMovieReleases(radarrConfig, movieId, fetchedLimit);

          const inSizeRange = (bytes: number): boolean => {
            const sizeGb = bytes / 1073741824;
            if (minSizeGb !== null && sizeGb < minSizeGb) return false;
            if (maxSizeGb !== null && sizeGb > maxSizeGb) return false;
            return true;
          };

          let releases = candidateReleases.filter((r) => inSizeRange(r.size));
          while (releases.length < 5 && fetchedLimit < 120 && candidateReleases.length >= fetchedLimit) {
            fetchedLimit = Math.min(fetchedLimit * 2, 120);
            candidateReleases = await radarr.getMovieReleases(radarrConfig, movieId, fetchedLimit);
            releases = candidateReleases.filter((r) => inSizeRange(r.size));
            expandedSearches += 1;
          }

          releases = releases.slice(0, 5);
          if (releases.length === 0) {
            const sizeFilterText = minSizeGb !== null || maxSizeGb !== null
              ? ` con el filtro de tamaño${minSizeGb !== null ? ` mínimo ${minSizeGb} GB` : ''}${maxSizeGb !== null ? `${minSizeGb !== null ? ' y' : ''} máximo ${maxSizeGb} GB` : ''}`
              : '';
            return { name, success: true, result: `🎬 No se encontraron releases disponibles para "${movie.title}"${sizeFilterText}.` };
          }
          const releasesList = releases.map((r, i) => {
            const ratio = r.leechers > 0 ? (r.seeders / r.leechers).toFixed(1) : (r.seeders > 0 ? '∞' : '0');
            const sizeGB = (r.size / 1073741824).toFixed(2);
            const quality = r.quality?.quality?.name || 'Desconocida';
            const rejections = r.rejections && r.rejections.length > 0 ? `\n   ⚠️ Rechazos: ${r.rejections.join(', ')}` : '\n   ✅ Sin rechazos';
            const langs = r.languages?.map(l => l.name).join(', ') || '-';
            return `**${i + 1}.** ${r.title}\n   📊 Ratio peers: ${ratio} (${r.seeders}S/${r.leechers}L) | 🎥 ${quality} | 💾 ${sizeGB} GB\n   📡 Indexador: ${r.indexer} | 🌐 ${r.protocol} | 🗣️ ${langs}${rejections}\n   🔑 GUID: ${r.guid} | IndexerID: ${r.indexerId}`;
          }).join('\n\n');
          recordResourceEvent('agent_media_operation', { operation: 'radarr_get_releases', movieId });
          const filtersSummary = minSizeGb !== null || maxSizeGb !== null
            ? `\nFiltro aplicado: ${minSizeGb !== null ? `≥ ${minSizeGb} GB` : ''}${minSizeGb !== null && maxSizeGb !== null ? ' y ' : ''}${maxSizeGb !== null ? `≤ ${maxSizeGb} GB` : ''}.`
            : '';
          const expansionSummary = expandedSearches > 1
            ? `\nBúsqueda ampliada automáticamente más allá de las primeras opciones (${fetchedLimit} candidatas revisadas).`
            : '';
          return { name, success: true, result: `🎬 Top ${releases.length} releases para "${movie.title}" (ordenadas por ratio de peers):\n\n${releasesList}${filtersSummary}${expansionSummary}\n\n💡 Indica qué opción quieres descargar (1-${releases.length}) y usaré radarr_grab_release con el GUID correspondiente.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error obteniendo releases: ${err.message}` };
        }
      }

      case 'radarr_grab_release': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        const guid = params.guid;
        const indexerId = typeof params.indexer_id === 'number' ? params.indexer_id : parseInt(String(params.indexer_id));
        if (!guid) {
          return { name, success: false, result: '', error: 'Falta el parámetro "guid"' };
        }
        if (!Number.isFinite(indexerId)) {
          return { name, success: false, result: '', error: 'Falta el parámetro "indexer_id" (número)' };
        }
        try {
          await radarr.grabMovieRelease(radarrConfig, guid, indexerId);
          recordResourceEvent('agent_media_operation', { operation: 'radarr_grab_release', guid });
          return { name, success: true, result: `✅ Release enviada a descargar correctamente. Puedes comprobar el progreso con radarr_queue.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error descargando release: ${err.message}` };
        }
      }

      case 'radarr_delete_movie': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const radarrConfig = context.agentConfig.media?.radarr;
        if (!radarrConfig) {
          return { name, success: false, result: '', error: 'Radarr no está configurado.' };
        }
        const movieId = typeof params.movie_id === 'number' ? params.movie_id : parseInt(String(params.movie_id));
        if (!Number.isFinite(movieId)) {
          return { name, success: false, result: '', error: 'Falta el parámetro "movie_id" (número)' };
        }
        const deleteFiles = params.delete_files === 'true' || params.delete_files === true;
        try {
          const movie = await radarr.getMovie(radarrConfig, movieId);
          const deleteApproval = await requestCriticalActionApproval(
            context,
            'Eliminar película en Radarr',
            [
              `Película: ${movie.title} (${movie.year})`,
              `ID interno: ${movie.id}`,
              `Eliminar archivos del disco: ${deleteFiles ? 'sí' : 'no'}`,
            ].join('\n')
          );
          if (!deleteApproval.approved) {
            return { name, success: false, result: '', error: deleteApproval.error || 'Acción no autorizada' };
          }

          await radarr.deleteMovie(radarrConfig, movieId, deleteFiles);
          recordResourceEvent('agent_media_operation', { operation: 'radarr_delete', movieId, title: movie.title });
          return { name, success: true, result: `🗑️ Película "${movie.title}" eliminada de Radarr.${deleteFiles ? ' Los archivos también fueron eliminados del disco.' : ''}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error eliminando película: ${err.message}` };
        }
      }

      // ── Sonarr (Series) ────────────────────────────────────────────────
      case 'sonarr_search_series': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media (Radarr/Sonarr).' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado. Configúralo en Integraciones del agente.' };
        }
        const query = params.query;
        if (!query) return { name, success: false, result: '', error: 'Falta el parámetro "query"' };
        try {
          const rawQuery = String(query).trim();
          const normalizedQuery = normalizeMediaLookupQuery(rawQuery);

          // Check if query is an external ID lookup (tvdb:xxx, imdb:xxx)
          const tvdbMatch = rawQuery.match(/^tvdb:(\d+)$/i);
          const imdbMatch = rawQuery.match(/^imdb:(tt\d+)$/i);

          if (tvdbMatch || imdbMatch) {
            // Direct ID lookup with fallback
            const ids: { tvdbId?: number; imdbId?: string } = {};
            if (tvdbMatch) ids.tvdbId = parseInt(tvdbMatch[1]);
            if (imdbMatch) ids.imdbId = imdbMatch[1];

            const series = await sonarr.lookupSeriesByExternalId(sonarrConfig, ids);
            if (!series) {
              return { name, success: true, result: `📺 No se encontró ninguna serie con el ID proporcionado (${query}).` };
            }
            const rating = series.ratings?.value ? ` | ⭐ ${series.ratings.value.toFixed(1)}` : '';
            const genres = series.genres?.slice(0, 3).join(', ') || '';
            const seasons = series.seasonCount ? `📅 ${series.seasonCount} temporada${series.seasonCount > 1 ? 's' : ''}` : '';
            recordResourceEvent('agent_media_operation', { operation: 'sonarr_search_by_id', query });
            return { name, success: true, result: `📺 Serie identificada con exactitud:\n\n1. **${series.title}** (${series.year}) [TVDB: ${series.tvdbId}]${series.imdbId ? ` [IMDb: ${series.imdbId}]` : ''}${rating}\n   ${genres ? `🎭 ${genres} | ` : ''}${seasons}${series.network ? ` | 📡 ${series.network}` : ''}\n   ${series.overview ? series.overview.slice(0, 200) + (series.overview.length > 200 ? '...' : '') : 'Sin sinopsis'}\n\n💡 Usa sonarr_add_series con tvdb_id=${series.tvdbId}${series.imdbId ? ` o imdb_id="${series.imdbId}"` : ''} para añadirla.` };
          }

          const resolvedFromWeb = await resolveSeriesByInternetId(sonarrConfig, normalizedQuery);
          if (resolvedFromWeb) {
            const rating = resolvedFromWeb.ratings?.value ? ` | ⭐ ${resolvedFromWeb.ratings.value.toFixed(1)}` : '';
            const genres = resolvedFromWeb.genres?.slice(0, 3).join(', ') || '';
            const seasons = resolvedFromWeb.seasonCount ? `📅 ${resolvedFromWeb.seasonCount} temporada${resolvedFromWeb.seasonCount > 1 ? 's' : ''}` : '';
            recordResourceEvent('agent_media_operation', { operation: 'sonarr_search_by_web_id', query: normalizedQuery });
            return { name, success: true, result: `📺 Serie identificada por ID externo (resuelto desde internet):\n\n1. **${resolvedFromWeb.title}** (${resolvedFromWeb.year}) [TVDB: ${resolvedFromWeb.tvdbId}]${resolvedFromWeb.imdbId ? ` [IMDb: ${resolvedFromWeb.imdbId}]` : ''}${rating}\n   ${genres ? `🎭 ${genres} | ` : ''}${seasons}${resolvedFromWeb.network ? ` | 📡 ${resolvedFromWeb.network}` : ''}\n   ${resolvedFromWeb.overview ? resolvedFromWeb.overview.slice(0, 200) + (resolvedFromWeb.overview.length > 200 ? '...' : '') : 'Sin sinopsis'}\n\n💡 Usa sonarr_add_series con tvdb_id=${resolvedFromWeb.tvdbId}${resolvedFromWeb.imdbId ? ` o imdb_id="${resolvedFromWeb.imdbId}"` : ''} para añadirla.` };
          }

          // Regular text search with disambiguation
          let { results, needsDisambiguation, disambiguation } = await sonarr.searchSeriesWithDisambiguation(sonarrConfig, normalizedQuery);
          if (results.length === 0 && normalizedQuery !== rawQuery) {
            const fallback = await sonarr.searchSeriesWithDisambiguation(sonarrConfig, rawQuery);
            results = fallback.results;
            needsDisambiguation = fallback.needsDisambiguation;
            disambiguation = fallback.disambiguation;
          }
          if (results.length === 0) {
            return { name, success: true, result: `📺 No se encontraron series para "${rawQuery}".` };
          }

          // If disambiguation needed, format specifically to ask the user
          if (needsDisambiguation && disambiguation) {
            const optionsList = disambiguation.options.map((opt, i) => {
              return `${i + 1}. **${disambiguation.title}** (${opt.year}) [TVDB: ${opt.tvdbId}]${opt.imdbId ? ` [IMDb: ${opt.imdbId}]` : ''}${opt.network ? ` | 📡 ${opt.network}` : ''}\n   ${opt.overview || 'Sin sinopsis'}`;
            }).join('\n\n');
            recordResourceEvent('agent_media_operation', { operation: 'sonarr_search_disambiguation', query: normalizedQuery });
            return { name, success: true, result: `📺 He encontrado varias series con el título "${disambiguation.title}" de diferentes años (${disambiguation.years.join(', ')}).\n\n⚠️ **¿De qué año te refieres?**\n\n${optionsList}\n\n💡 Indícame el año o el número de la opción para identificarla con exactitud.` };
          }

          const seriesList = results.slice(0, 10).map((s, i) => {
            const rating = s.ratings?.value ? ` | ⭐ ${s.ratings.value.toFixed(1)}` : '';
            const genres = s.genres?.slice(0, 3).join(', ') || '';
            const seasons = s.seasonCount ? `📅 ${s.seasonCount} temporada${s.seasonCount > 1 ? 's' : ''}` : '';
            return `${i + 1}. **${s.title}** (${s.year}) [TVDB: ${s.tvdbId}]${s.imdbId ? ` [IMDb: ${s.imdbId}]` : ''}${rating}\n   ${genres ? `🎭 ${genres} | ` : ''}${seasons}${s.network ? ` | 📡 ${s.network}` : ''}\n   ${s.overview ? s.overview.slice(0, 150) + (s.overview.length > 150 ? '...' : '') : 'Sin sinopsis'}`;
          }).join('\n\n');
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_search', query: normalizedQuery });
          return { name, success: true, result: `📺 Resultados de búsqueda para "${rawQuery}" (${results.length}):\n\n${seriesList}\n\n💡 Usa sonarr_add_series con el tvdb_id (o imdb_id) para añadir una serie. Puedes especificar temporadas concretas con monitor_seasons.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error buscando en Sonarr: ${err.message}` };
        }
      }

      case 'sonarr_add_series': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        const tvdbId = typeof params.tvdb_id === 'number' ? params.tvdb_id : (params.tvdb_id ? parseInt(String(params.tvdb_id)) : NaN);
        const imdbId = typeof params.imdb_id === 'string' && params.imdb_id.trim() ? params.imdb_id.trim() : undefined;

        if (!Number.isFinite(tvdbId) && !imdbId) {
          return { name, success: false, result: '', error: 'Falta al menos uno de: "tvdb_id" (número) o "imdb_id" (string). Proporciona uno para identificar la serie.' };
        }

        try {
          // Resolve the series using external IDs with fallback
          let resolvedTvdbId = Number.isFinite(tvdbId) ? tvdbId : 0;

          // If we only have imdb_id (or want to validate), do a lookup with fallback
          if (!Number.isFinite(tvdbId) && imdbId) {
            const lookup = await sonarr.lookupSeriesByExternalId(sonarrConfig, { imdbId });
            if (!lookup) {
              return { name, success: false, result: '', error: `No se pudo resolver la serie con IMDb ID "${imdbId}". Intenta con un tvdb_id.` };
            }
            resolvedTvdbId = lookup.tvdbId;
          }

          // Check if already in library (using all available IDs)
          const existing = await sonarr.isSeriesInLibraryByExternalId(sonarrConfig, {
            tvdbId: Number.isFinite(resolvedTvdbId) ? resolvedTvdbId : undefined,
            imdbId,
          });
          if (existing) {
            const episodeStats = `${existing.episodeFileCount}/${existing.totalEpisodeCount} episodios descargados`;
            return { name, success: true, result: `📺 "${existing.title}" (${existing.year}) ya está en la biblioteca.\n📊 ${episodeStats}\n📅 ${existing.seasonCount} temporada${existing.seasonCount > 1 ? 's' : ''}\n🔑 ID: ${existing.id}${existing.imdbId ? ` | IMDb: ${existing.imdbId}` : ''} | TVDB: ${existing.tvdbId}` };
          }
          const searchForMissing = params.search !== 'false';
          const seriesType = (['standard', 'anime', 'daily'].includes(params.series_type)) ? params.series_type as 'standard' | 'anime' | 'daily' : undefined;
          let monitoredSeasons: number[] | undefined;
          if (typeof params.monitor_seasons === 'string' && params.monitor_seasons.trim()) {
            monitoredSeasons = params.monitor_seasons.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => Number.isFinite(n));
          }
          const series = await sonarr.addSeries(sonarrConfig, resolvedTvdbId, {
            searchForMissingEpisodes: searchForMissing,
            seriesType,
            monitoredSeasons,
          });
          const seasonInfo = monitoredSeasons
            ? `Temporadas monitorizadas: ${monitoredSeasons.join(', ')}`
            : 'Todas las temporadas monitorizadas';
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_add', seriesId: series.id, title: series.title });
          return { name, success: true, result: `📺 Serie añadida a Sonarr:\n- **${series.title}** (${series.year})\n- 🔑 ID: ${series.id} | TVDB: ${series.tvdbId}${series.imdbId ? ` | IMDb: ${series.imdbId}` : ''}\n- 📅 ${seasonInfo}\n- ${searchForMissing ? '🔍 Búsqueda de episodios iniciada automáticamente' : '⏸️ Añadida sin búsqueda automática'}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error añadiendo serie: ${err.message}` };
        }
      }

      case 'sonarr_library': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        try {
          let series = await sonarr.getLibrarySeries(sonarrConfig);
          const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';
          if (query) {
            series = series.filter(s => s.title.toLowerCase().includes(query));
          }
          if (series.length === 0) {
            return { name, success: true, result: query ? `📺 No hay series que coincidan con "${query}" en la biblioteca.` : '📺 La biblioteca de Sonarr está vacía.' };
          }
          const seriesList = series.slice(0, 25).map((s, i) => {
            const episodeProgress = `${s.episodeFileCount}/${s.totalEpisodeCount}`;
            const percent = s.totalEpisodeCount > 0 ? ((s.episodeFileCount / s.totalEpisodeCount) * 100).toFixed(0) : '0';
            const size = s.sizeOnDisk > 0 ? `${(s.sizeOnDisk / 1073741824).toFixed(1)} GB` : '-';
            const statusIcon = s.episodeFileCount === s.totalEpisodeCount && s.totalEpisodeCount > 0 ? '✅' : '📥';
            return `${i + 1}. ${statusIcon} **${s.title}** (${s.year}) [ID: ${s.id}]\n   📊 ${episodeProgress} episodios (${percent}%) | 📅 ${s.seasonCount} temp. | 💾 ${size}`;
          }).join('\n');
          const moreText = series.length > 25 ? `\n\n... y ${series.length - 25} más` : '';
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_library' });
          return { name, success: true, result: `📺 Biblioteca de Sonarr (${series.length} series):\n\n${seriesList}${moreText}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando biblioteca: ${err.message}` };
        }
      }

      case 'sonarr_series_status': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        const title = params.title;
        if (!title) return { name, success: false, result: '', error: 'Falta el parámetro "title"' };
        try {
          const series = await sonarr.findSeriesInLibrary(sonarrConfig, title);
          if (!series) {
            return { name, success: true, result: `📺 "${title}" no está en la biblioteca de Sonarr.` };
          }
          const monitored = series.monitored ? '🟢 Monitorizada' : '🔴 No monitorizada';
          const size = series.sizeOnDisk > 0 ? `${(series.sizeOnDisk / 1073741824).toFixed(1)} GB` : '-';
          let seasonDetails = '';
          if (series.seasons && series.seasons.length > 0) {
            seasonDetails = '\n\n📅 Temporadas:\n' + series.seasons
              .filter(s => s.seasonNumber > 0)
              .map(s => {
                const stats = s.statistics;
                if (stats) {
                  const percent = stats.totalEpisodeCount > 0 ? ((stats.episodeFileCount / stats.totalEpisodeCount) * 100).toFixed(0) : '0';
                  const statusIcon = stats.episodeFileCount === stats.totalEpisodeCount && stats.totalEpisodeCount > 0 ? '✅' : '📥';
                  return `  ${statusIcon} T${s.seasonNumber}: ${stats.episodeFileCount}/${stats.totalEpisodeCount} episodios (${percent}%) ${s.monitored ? '🟢' : '🔴'}`;
                }
                return `  T${s.seasonNumber}: ${s.monitored ? '🟢 Monitorizada' : '🔴 No monitorizada'}`;
              }).join('\n');
          }
          return { name, success: true, result: `📺 **${series.title}** (${series.year})\n🔑 ID: ${series.id} | TVDB: ${series.tvdbId}${series.imdbId ? ` | IMDb: ${series.imdbId}` : ''}\n📊 ${series.episodeFileCount}/${series.totalEpisodeCount} episodios descargados\n📅 ${series.seasonCount} temporada${series.seasonCount > 1 ? 's' : ''}\n${monitored} | Estado: ${series.status}\n💾 Tamaño: ${size}${series.network ? `\n📡 Network: ${series.network}` : ''}${series.genres?.length ? `\n🎭 Géneros: ${series.genres.join(', ')}` : ''}${seasonDetails}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando serie: ${err.message}` };
        }
      }

      case 'sonarr_season_episodes': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        const seriesId = typeof params.series_id === 'number' ? params.series_id : parseInt(String(params.series_id));
        const seasonNum = typeof params.season === 'number' ? params.season : parseInt(String(params.season));
        if (!Number.isFinite(seriesId) || !Number.isFinite(seasonNum)) {
          return { name, success: false, result: '', error: 'Faltan parámetros "series_id" y "season" (números)' };
        }
        try {
          const series = await sonarr.getSeries(sonarrConfig, seriesId);
          const episodes = await sonarr.getSeasonEpisodes(sonarrConfig, seriesId, seasonNum);
          if (episodes.length === 0) {
            return { name, success: true, result: `📺 No se encontraron episodios para "${series.title}" T${seasonNum}.` };
          }
          const episodesList = episodes.map((ep) => {
            const fileIcon = ep.hasFile ? '✅' : '❌';
            const quality = ep.episodeFile?.quality?.quality?.name || '';
            const airDate = ep.airDate || 'TBA';
            return `  ${fileIcon} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}: ${ep.title} (${airDate})${quality ? ` [${quality}]` : ''} [EpID: ${ep.id}]`;
          }).join('\n');
          const downloaded = episodes.filter(e => e.hasFile).length;
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_season_episodes', seriesId, season: seasonNum });
          return { name, success: true, result: `📺 **${series.title}** — Temporada ${seasonNum}\n📊 ${downloaded}/${episodes.length} episodios descargados\n\n${episodesList}\n\n💡 Usa sonarr_search_download con series_id=${seriesId} y season=${seasonNum} para buscar descargas de esta temporada. Para episodios concretos usa episode_ids.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando episodios: ${err.message}` };
        }
      }

      case 'sonarr_search_download': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        const seriesId = typeof params.series_id === 'number' ? params.series_id : parseInt(String(params.series_id));
        if (!Number.isFinite(seriesId)) {
          return { name, success: false, result: '', error: 'Falta el parámetro "series_id" (número)' };
        }
        try {
          const series = await sonarr.getSeries(sonarrConfig, seriesId);
          // Specific episodes?
          if (typeof params.episode_ids === 'string' && params.episode_ids.trim()) {
            const episodeIds = params.episode_ids.split(',').map((id: string) => parseInt(id.trim())).filter((n: number) => Number.isFinite(n));
            if (episodeIds.length === 0) {
              return { name, success: false, result: '', error: 'Los episode_ids proporcionados no son válidos.' };
            }
            await sonarr.searchEpisodes(sonarrConfig, episodeIds);
            recordResourceEvent('agent_media_operation', { operation: 'sonarr_search_episodes', seriesId, episodeIds });
            return { name, success: true, result: `🔍 Búsqueda de descarga iniciada para ${episodeIds.length} episodio(s) de "${series.title}".` };
          }
          // Specific season?
          const seasonNum = typeof params.season === 'number' ? params.season : (typeof params.season === 'string' ? parseInt(params.season) : NaN);
          if (Number.isFinite(seasonNum)) {
            await sonarr.searchSeason(sonarrConfig, seriesId, seasonNum);
            recordResourceEvent('agent_media_operation', { operation: 'sonarr_search_season', seriesId, season: seasonNum });
            return { name, success: true, result: `🔍 Búsqueda de descarga iniciada para "${series.title}" Temporada ${seasonNum}.` };
          }
          // Whole series
          await sonarr.searchSeriesDownload(sonarrConfig, seriesId);
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_search_series_download', seriesId });
          return { name, success: true, result: `🔍 Búsqueda de descarga iniciada para toda la serie "${series.title}".` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error lanzando búsqueda: ${err.message}` };
        }
      }

      case 'sonarr_queue': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        try {
          const queue = await sonarr.getQueue(sonarrConfig);
          if (queue.length === 0) {
            return { name, success: true, result: '📺 No hay descargas activas en Sonarr.' };
          }
          const queueList = queue.map((item, i) => {
            const progress = item.size > 0 ? ((1 - item.sizeleft / item.size) * 100).toFixed(1) : '0';
            const sizeTotal = (item.size / 1073741824).toFixed(2);
            const sizeLeft = (item.sizeleft / 1073741824).toFixed(2);
            const quality = item.quality?.quality?.name || '-';
            const timeLeft = item.timeleft || 'calculando...';
            const statusIcon = item.trackedDownloadState === 'downloading' ? '⬇️' :
              item.trackedDownloadState === 'importPending' ? '📥' :
              item.trackedDownloadState === 'failedPending' ? '❌' : '⏳';
            const seriesTitle = item.series?.title || '';
            const episodeInfo = item.episode ? `S${String(item.episode.seasonNumber).padStart(2, '0')}E${String(item.episode.episodeNumber).padStart(2, '0')} - ${item.episode.title}` : item.title;
            return `${i + 1}. ${statusIcon} **${seriesTitle}** ${episodeInfo}\n   📊 ${progress}% | ⏱️ ${timeLeft} | 💾 ${sizeLeft}/${sizeTotal} GB\n   🎥 ${quality} | 📡 ${item.protocol || '-'} | ${item.downloadClient || '-'}`;
          }).join('\n\n');
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_queue' });
          return { name, success: true, result: `📺 Descargas activas de Sonarr (${queue.length}):\n\n${queueList}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error consultando cola: ${err.message}` };
        }
      }

      case 'sonarr_get_releases': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        try {
          let releases: Awaited<ReturnType<typeof sonarr.getEpisodeReleases>> = [];
          let contextTitle = '';

          const episodeId = typeof params.episode_id === 'number' ? params.episode_id : (typeof params.episode_id === 'string' ? parseInt(params.episode_id) : NaN);
          const seriesId = typeof params.series_id === 'number' ? params.series_id : (typeof params.series_id === 'string' ? parseInt(params.series_id) : NaN);
          const seasonNum = typeof params.season === 'number' ? params.season : (typeof params.season === 'string' ? parseInt(params.season) : NaN);
          const minSizeGb = Number.isFinite(Number(params.min_size_gb)) ? Number(params.min_size_gb) : null;
          const maxSizeGb = Number.isFinite(Number(params.max_size_gb)) ? Number(params.max_size_gb) : null;

          if (minSizeGb !== null && minSizeGb < 0) {
            return { name, success: false, result: '', error: '"min_size_gb" debe ser >= 0.' };
          }
          if (maxSizeGb !== null && maxSizeGb < 0) {
            return { name, success: false, result: '', error: '"max_size_gb" debe ser >= 0.' };
          }
          if (minSizeGb !== null && maxSizeGb !== null && minSizeGb > maxSizeGb) {
            return { name, success: false, result: '', error: '"min_size_gb" no puede ser mayor que "max_size_gb".' };
          }

          const inSizeRange = (bytes: number): boolean => {
            const sizeGb = bytes / 1073741824;
            if (minSizeGb !== null && sizeGb < minSizeGb) return false;
            if (maxSizeGb !== null && sizeGb > maxSizeGb) return false;
            return true;
          };

          let fetchedLimit = 5;
          let expandedSearches = 1;

          if (Number.isFinite(episodeId)) {
            let candidates = await sonarr.getEpisodeReleases(sonarrConfig, episodeId, fetchedLimit);
            releases = candidates.filter((r) => inSizeRange(r.size));
            while (releases.length < 5 && fetchedLimit < 120 && candidates.length >= fetchedLimit) {
              fetchedLimit = Math.min(fetchedLimit * 2, 120);
              candidates = await sonarr.getEpisodeReleases(sonarrConfig, episodeId, fetchedLimit);
              releases = candidates.filter((r) => inSizeRange(r.size));
              expandedSearches += 1;
            }
            contextTitle = `episodio ID ${episodeId}`;
          } else if (Number.isFinite(seriesId) && Number.isFinite(seasonNum)) {
            const series = await sonarr.getSeries(sonarrConfig, seriesId);
            let candidates = await sonarr.getSeasonReleases(sonarrConfig, seriesId, seasonNum, fetchedLimit);
            releases = candidates.filter((r) => inSizeRange(r.size));
            while (releases.length < 5 && fetchedLimit < 120 && candidates.length >= fetchedLimit) {
              fetchedLimit = Math.min(fetchedLimit * 2, 120);
              candidates = await sonarr.getSeasonReleases(sonarrConfig, seriesId, seasonNum, fetchedLimit);
              releases = candidates.filter((r) => inSizeRange(r.size));
              expandedSearches += 1;
            }
            contextTitle = `"${series.title}" Temporada ${seasonNum}`;
          } else {
            return { name, success: false, result: '', error: 'Debes proporcionar episode_id, o series_id + season.' };
          }

          releases = releases.slice(0, 5);

          if (releases.length === 0) {
            const sizeFilterText = minSizeGb !== null || maxSizeGb !== null
              ? ` con el filtro de tamaño${minSizeGb !== null ? ` mínimo ${minSizeGb} GB` : ''}${maxSizeGb !== null ? `${minSizeGb !== null ? ' y' : ''} máximo ${maxSizeGb} GB` : ''}`
              : '';
            return { name, success: true, result: `📺 No se encontraron releases disponibles para ${contextTitle}${sizeFilterText}.` };
          }
          const releasesList = releases.map((r, i) => {
            const ratio = r.leechers > 0 ? (r.seeders / r.leechers).toFixed(1) : (r.seeders > 0 ? '∞' : '0');
            const sizeGB = (r.size / 1073741824).toFixed(2);
            const quality = r.quality?.quality?.name || 'Desconocida';
            const rejections = r.rejections && r.rejections.length > 0 ? `\n   ⚠️ Rechazos: ${r.rejections.join(', ')}` : '\n   ✅ Sin rechazos';
            const langs = r.languages?.map(l => l.name).join(', ') || '-';
            const seasonInfo = r.fullSeason ? ' [Temporada completa]' : '';
            return `**${i + 1}.** ${r.title}${seasonInfo}\n   📊 Ratio peers: ${ratio} (${r.seeders}S/${r.leechers}L) | 🎥 ${quality} | 💾 ${sizeGB} GB\n   📡 Indexador: ${r.indexer} | 🌐 ${r.protocol} | 🗣️ ${langs}${rejections}\n   🔑 GUID: ${r.guid} | IndexerID: ${r.indexerId}`;
          }).join('\n\n');
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_get_releases' });
          const filtersSummary = minSizeGb !== null || maxSizeGb !== null
            ? `\nFiltro aplicado: ${minSizeGb !== null ? `≥ ${minSizeGb} GB` : ''}${minSizeGb !== null && maxSizeGb !== null ? ' y ' : ''}${maxSizeGb !== null ? `≤ ${maxSizeGb} GB` : ''}.`
            : '';
          const expansionSummary = expandedSearches > 1
            ? `\nBúsqueda ampliada automáticamente más allá de las primeras opciones (${fetchedLimit} candidatas revisadas).`
            : '';
          return { name, success: true, result: `📺 Top ${releases.length} releases para ${contextTitle} (ordenadas por ratio de peers):\n\n${releasesList}${filtersSummary}${expansionSummary}\n\n💡 Indica qué opción quieres descargar (1-${releases.length}) y usaré sonarr_grab_release con el GUID correspondiente.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error obteniendo releases: ${err.message}` };
        }
      }

      case 'sonarr_grab_release': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        const guid = params.guid;
        const indexerId = typeof params.indexer_id === 'number' ? params.indexer_id : parseInt(String(params.indexer_id));
        if (!guid) {
          return { name, success: false, result: '', error: 'Falta el parámetro "guid"' };
        }
        if (!Number.isFinite(indexerId)) {
          return { name, success: false, result: '', error: 'Falta el parámetro "indexer_id" (número)' };
        }
        try {
          await sonarr.grabEpisodeRelease(sonarrConfig, guid, indexerId);
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_grab_release', guid });
          return { name, success: true, result: `✅ Release enviada a descargar correctamente. Puedes comprobar el progreso con sonarr_queue.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error descargando release: ${err.message}` };
        }
      }

      case 'sonarr_delete_series': {
        const mediaAccessAllowed = context.agentConfig.permissions.mediaAccess !== false;
        if (!mediaAccessAllowed) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso para gestionar media.' };
        }
        const sonarrConfig = context.agentConfig.media?.sonarr;
        if (!sonarrConfig) {
          return { name, success: false, result: '', error: 'Sonarr no está configurado.' };
        }
        const seriesId = typeof params.series_id === 'number' ? params.series_id : parseInt(String(params.series_id));
        if (!Number.isFinite(seriesId)) {
          return { name, success: false, result: '', error: 'Falta el parámetro "series_id" (número)' };
        }
        const deleteFiles = params.delete_files === 'true' || params.delete_files === true;
        try {
          const series = await sonarr.getSeries(sonarrConfig, seriesId);
          const deleteApproval = await requestCriticalActionApproval(
            context,
            'Eliminar serie en Sonarr',
            [
              `Serie: ${series.title} (${series.year})`,
              `ID interno: ${series.id}`,
              `Eliminar archivos del disco: ${deleteFiles ? 'sí' : 'no'}`,
            ].join('\n')
          );
          if (!deleteApproval.approved) {
            return { name, success: false, result: '', error: deleteApproval.error || 'Acción no autorizada' };
          }

          await sonarr.deleteSeries(sonarrConfig, seriesId, deleteFiles);
          recordResourceEvent('agent_media_operation', { operation: 'sonarr_delete', seriesId, title: series.title });
          return { name, success: true, result: `🗑️ Serie "${series.title}" eliminada de Sonarr.${deleteFiles ? ' Los archivos también fueron eliminados del disco.' : ''}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error eliminando serie: ${err.message}` };
        }
      }

      // ── Home Assistant (Smart Home) ──────────────────────────────────
      case 'ha_get_entities': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado. Configúralo en Integraciones del agente.' };
        }
        try {
          const domain = params.domain ? String(params.domain).trim() : '';
          const entities = domain
            ? await homeAssistant.getEntitiesByDomain(haConfig, domain)
            : await homeAssistant.getStates(haConfig);
          if (entities.length === 0) {
            return { name, success: true, result: domain ? `No se encontraron entidades de tipo "${domain}" en Home Assistant.` : 'No se encontraron entidades en Home Assistant.' };
          }
          const maxShow = 50;
          const list = entities.slice(0, maxShow).map(homeAssistant.formatEntityState).join('\n');
          const suffix = entities.length > maxShow ? `\n\n... y ${entities.length - maxShow} entidades más.` : '';
          return { name, success: true, result: `🏠 Entidades${domain ? ` (${domain})` : ''} encontradas (${entities.length}):\n\n${list}${suffix}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al obtener entidades de HA: ${err.message}` };
        }
      }

      case 'ha_get_state': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        try {
          const state = await homeAssistant.getEntityState(haConfig, entityId);
          return { name, success: true, result: `🏠 ${homeAssistant.formatEntityState(state)}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al obtener estado de "${entityId}": ${err.message}` };
        }
      }

      case 'ha_search_entities': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const query = String(params.query || '').trim();
        if (!query) return { name, success: false, result: '', error: 'Falta el parámetro "query"' };
        try {
          const results = await homeAssistant.searchEntities(haConfig, query);
          if (results.length === 0) {
            return { name, success: true, result: `🔍 No se encontraron entidades que coincidan con "${query}".` };
          }
          const list = results.slice(0, 30).map(homeAssistant.formatEntityState).join('\n');
          return { name, success: true, result: `🔍 Resultados para "${query}" (${results.length}):\n\n${list}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error buscando entidades: ${err.message}` };
        }
      }

      case 'ha_list_areas': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        try {
          const areas = await homeAssistant.listAreas(haConfig);
          if (areas.length === 0) {
            return { name, success: true, result: '🏠 No hay áreas configuradas en Home Assistant.' };
          }
          const list = areas.map(a => {
            const entities = a.entityIds.length > 0
              ? a.entityIds.join(', ')
              : '(sin dispositivos)';
            return `📍 ${a.name} (${a.id}): ${entities}`;
          }).join('\n');
          return { name, success: true, result: `🏠 Áreas en Home Assistant (${areas.length}):\n\n${list}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error listando áreas: ${err.message}` };
        }
      }

      case 'ha_turn_on': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        try {
          const turnOnApproval = await requestCriticalActionApproval(
            context,
            'Controlar dispositivo en Home Assistant (encender)',
            [
              `Entidad: ${entityId}`,
              params.brightness !== undefined ? `Brillo objetivo: ${params.brightness}%` : undefined,
              params.color_temp !== undefined ? `Temperatura de color: ${params.color_temp}` : undefined,
              params.rgb_color ? `Color RGB: ${params.rgb_color}` : undefined,
            ].filter(Boolean).join('\n')
          );
          if (!turnOnApproval.approved) {
            return { name, success: false, result: '', error: turnOnApproval.error || 'Acción no autorizada' };
          }

          const domain = entityId.split('.')[0];
          const options: { brightness?: number; color_temp?: number; rgb_color?: [number, number, number] } = {};
          if (params.brightness !== undefined) {
            options.brightness = Math.round((Number(params.brightness) / 100) * 255);
          }
          if (params.color_temp !== undefined) options.color_temp = Number(params.color_temp);
          if (params.rgb_color) {
            const parts = String(params.rgb_color).split(',').map(Number);
            if (parts.length === 3) options.rgb_color = [parts[0], parts[1], parts[2]];
          }
          if (domain === 'light') {
            await homeAssistant.turnOnLight(haConfig, entityId, options);
          } else {
            await homeAssistant.callService(haConfig, domain, 'turn_on', { entity_id: entityId });
          }
          const brightnessNote = options.brightness !== undefined ? ` (brillo: ${params.brightness}%)` : '';
          return { name, success: true, result: `💡 ${entityId} encendido${brightnessNote}.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al encender "${entityId}": ${err.message}` };
        }
      }

      case 'ha_turn_off': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        try {
          const turnOffApproval = await requestCriticalActionApproval(
            context,
            'Controlar dispositivo en Home Assistant (apagar)',
            `Entidad: ${entityId}`
          );
          if (!turnOffApproval.approved) {
            return { name, success: false, result: '', error: turnOffApproval.error || 'Acción no autorizada' };
          }

          const domain = entityId.split('.')[0];
          if (domain === 'light') {
            await homeAssistant.turnOffLight(haConfig, entityId);
          } else {
            await homeAssistant.callService(haConfig, domain, 'turn_off', { entity_id: entityId });
          }
          return { name, success: true, result: `🌑 ${entityId} apagado.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al apagar "${entityId}": ${err.message}` };
        }
      }

      case 'ha_toggle': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        try {
          const toggleApproval = await requestCriticalActionApproval(
            context,
            'Controlar dispositivo en Home Assistant (toggle)',
            `Entidad: ${entityId}`
          );
          if (!toggleApproval.approved) {
            return { name, success: false, result: '', error: toggleApproval.error || 'Acción no autorizada' };
          }

          const domain = entityId.split('.')[0];
          await homeAssistant.callService(haConfig, domain, 'toggle', { entity_id: entityId });
          return { name, success: true, result: `🔄 ${entityId} alternado (toggle).` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al alternar "${entityId}": ${err.message}` };
        }
      }

      case 'ha_set_climate': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        try {
          const temperature = params.temperature !== undefined ? Number(params.temperature) : undefined;
          const hvacMode = params.hvac_mode ? String(params.hvac_mode).trim() : undefined;

          const climateApproval = await requestCriticalActionApproval(
            context,
            'Configurar clima en Home Assistant',
            [
              `Entidad: ${entityId}`,
              temperature !== undefined ? `Temperatura objetivo: ${temperature}` : undefined,
              hvacMode ? `Modo HVAC: ${hvacMode}` : undefined,
            ].filter(Boolean).join('\n')
          );
          if (!climateApproval.approved) {
            return { name, success: false, result: '', error: climateApproval.error || 'Acción no autorizada' };
          }
          
          if (hvacMode && !temperature) {
            await homeAssistant.setClimateMode(haConfig, entityId, hvacMode);
            return { name, success: true, result: `🌡️ ${entityId} — modo configurado a "${hvacMode}".` };
          } else if (temperature !== undefined) {
            await homeAssistant.setClimateTemperature(haConfig, entityId, temperature, hvacMode);
            return { name, success: true, result: `🌡️ ${entityId} — temperatura objetivo: ${temperature}°${hvacMode ? ` (modo: ${hvacMode})` : ''}.` };
          } else {
            return { name, success: false, result: '', error: 'Especifica al menos temperature o hvac_mode.' };
          }
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al configurar clima "${entityId}": ${err.message}` };
        }
      }

      case 'ha_cover_control': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        const action = String(params.action || '').trim().toLowerCase();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        if (!['open', 'close', 'stop'].includes(action)) {
          return { name, success: false, result: '', error: 'El parámetro "action" debe ser "open", "close" o "stop".' };
        }
        try {
          const coverApproval = await requestCriticalActionApproval(
            context,
            'Controlar persiana/cortina en Home Assistant',
            `Entidad: ${entityId}\nAcción: ${action}`
          );
          if (!coverApproval.approved) {
            return { name, success: false, result: '', error: coverApproval.error || 'Acción no autorizada' };
          }

          const serviceMap: Record<string, string> = { open: 'open_cover', close: 'close_cover', stop: 'stop_cover' };
          await homeAssistant.callService(haConfig, 'cover', serviceMap[action], { entity_id: entityId });
          const actionText: Record<string, string> = { open: 'abierta', close: 'cerrada', stop: 'detenida' };
          return { name, success: true, result: `🪟 ${entityId} — ${actionText[action]}.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error controlando persiana "${entityId}": ${err.message}` };
        }
      }

      case 'ha_activate_scene': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const entityId = String(params.entity_id || '').trim();
        if (!entityId) return { name, success: false, result: '', error: 'Falta el parámetro "entity_id"' };
        try {
          const sceneApproval = await requestCriticalActionApproval(
            context,
            'Activar escena en Home Assistant',
            `Escena: ${entityId}`
          );
          if (!sceneApproval.approved) {
            return { name, success: false, result: '', error: sceneApproval.error || 'Acción no autorizada' };
          }

          await homeAssistant.activateScene(haConfig, entityId);
          return { name, success: true, result: `🎭 Escena "${entityId}" activada.` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al activar escena "${entityId}": ${err.message}` };
        }
      }

      case 'ha_call_service': {
        const haConfig = context.agentConfig.homeAssistant;
        if (!haConfig) {
          return { name, success: false, result: '', error: 'Home Assistant no está configurado.' };
        }
        const domain = String(params.domain || '').trim();
        const service = String(params.service || '').trim();
        if (!domain || !service) {
          return { name, success: false, result: '', error: 'Faltan los parámetros "domain" y "service".' };
        }
        let data: Record<string, any> = {};
        if (params.data) {
          try {
            data = JSON.parse(String(params.data));
          } catch {
            return { name, success: false, result: '', error: 'El parámetro "data" debe ser JSON válido.' };
          }
        }
        try {
          const serviceApproval = await requestCriticalActionApproval(
            context,
            'Ejecutar servicio custom en Home Assistant',
            [
              `Servicio: ${domain}.${service}`,
              `Payload: ${JSON.stringify(data).slice(0, 600)}`,
            ].join('\n')
          );
          if (!serviceApproval.approved) {
            return { name, success: false, result: '', error: serviceApproval.error || 'Acción no autorizada' };
          }

          const result = await homeAssistant.callService(haConfig, domain, service, data);
          const affected = Array.isArray(result) ? result.length : 0;
          return { name, success: true, result: `✅ Servicio ${domain}.${service} ejecutado correctamente (${affected} entidades afectadas).` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error al llamar servicio ${domain}.${service}: ${err.message}` };
        }
      }

      // ── Skills ────────────────────────────────────────────────────────
      case 'create_skill': {
        const skillName = params.name;
        const description = params.description;
        const instructions = params.instructions;
        if (!skillName) return { name, success: false, result: '', error: 'Falta el parámetro "name"' };
        if (!description) return { name, success: false, result: '', error: 'Falta el parámetro "description"' };
        if (!instructions) return { name, success: false, result: '', error: 'Falta el parámetro "instructions"' };

        const tags = params.tags ? String(params.tags).split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        const triggers = params.triggers ? String(params.triggers).split(',').map((t: string) => t.trim()).filter(Boolean) : [];
        const triggerConditions = params.trigger_conditions || undefined;
        const priority = typeof params.priority === 'number' ? params.priority : 50;

        const skill = skills.createSkillFromParams(userId, agentId, {
          name: skillName,
          description,
          instructions,
          tags,
          triggers,
          triggerConditions,
          priority,
          author: 'agent',
        });

        return { name, success: true, result: `✅ Habilidad "${skill.name}" creada (ID: ${skill.id}).\nDescripción: ${skill.description}\nTags: ${skill.tags.join(', ') || 'ninguno'}\nTriggers: ${skill.triggers.events.join(', ') || 'ninguno'}\nPrioridad: ${skill.priority}\nEstado: activa` };
      }

      case 'list_skills': {
        const allSkills = skills.getSkillSummaries(userId, agentId);
        if (allSkills.length === 0) {
          return { name, success: true, result: 'No hay habilidades configuradas. Usa create_skill para crear una nueva.' };
        }
        const list = allSkills.map((s) =>
          `- "${s.name}" (ID: ${s.id}, v${s.version})\n  ${s.description}\n  Estado: ${s.enabled ? '✅ activa' : '❌ inactiva'} | Prioridad: ${s.priority}\n  Tags: ${s.tags.join(', ') || 'ninguno'}\n  Triggers: ${s.triggers.events.join(', ') || 'ninguno'}`
        ).join('\n\n');
        return { name, success: true, result: `Habilidades del agente (${allSkills.length}):\n\n${list}` };
      }

      case 'get_skill': {
        const skillId = params.skill_id;
        if (!skillId) return { name, success: false, result: '', error: 'Falta el parámetro "skill_id"' };

        // Try by ID first, then search by name
        let skill = skills.getSkill(userId, agentId, skillId);
        if (!skill) {
          const found = skills.searchSkills(userId, agentId, skillId);
          if (found.length > 0) skill = found[0];
        }
        if (!skill) return { name, success: false, result: '', error: `Habilidad "${skillId}" no encontrada` };

        return { name, success: true, result: `Habilidad: ${skill.name} (ID: ${skill.id})\nVersión: ${skill.version}\nAutor: ${skill.author}\nDescripción: ${skill.description}\nEstado: ${skill.enabled ? 'activa' : 'inactiva'}\nPrioridad: ${skill.priority}\nTags: ${skill.tags.join(', ') || 'ninguno'}\nTriggers: ${skill.triggers.events.join(', ') || 'ninguno'}${skill.triggers.conditions ? `\nCondiciones: ${skill.triggers.conditions}` : ''}\nMCP Servers: ${skill.mcpServers.map((s) => s.id).join(', ') || 'ninguno'}\n\nInstrucciones:\n${skill.instructions}` };
      }

      case 'update_skill': {
        const skillId = params.skill_id;
        if (!skillId) return { name, success: false, result: '', error: 'Falta el parámetro "skill_id"' };

        let skill = skills.getSkill(userId, agentId, skillId);
        if (!skill) {
          const found = skills.searchSkills(userId, agentId, skillId);
          if (found.length > 0) skill = found[0];
        }
        if (!skill) return { name, success: false, result: '', error: `Habilidad "${skillId}" no encontrada` };

        if (params.name) skill.name = params.name;
        if (params.description) skill.description = params.description;
        if (params.instructions) skill.instructions = params.instructions;
        if (params.tags) skill.tags = String(params.tags).split(',').map((t: string) => t.trim()).filter(Boolean);
        if (params.triggers) skill.triggers.events = String(params.triggers).split(',').map((t: string) => t.trim()).filter(Boolean);
        if (typeof params.priority === 'number') skill.priority = params.priority;
        if (params.enabled !== undefined) skill.enabled = String(params.enabled) === 'true';
        skill.updatedAt = Date.now();

        skills.saveSkill(userId, agentId, skill);
        return { name, success: true, result: `✅ Habilidad "${skill.name}" actualizada (ID: ${skill.id}).` };
      }

      case 'delete_skill': {
        const skillId = params.skill_id;
        if (!skillId) return { name, success: false, result: '', error: 'Falta el parámetro "skill_id"' };
        const deleted = skills.deleteSkill(userId, agentId, skillId);
        if (!deleted) return { name, success: false, result: '', error: `Habilidad "${skillId}" no encontrada` };
        return { name, success: true, result: `✅ Habilidad "${skillId}" eliminada.` };
      }

      case 'toggle_skill': {
        const skillId = params.skill_id;
        const enabled = String(params.enabled) === 'true';
        if (!skillId) return { name, success: false, result: '', error: 'Falta el parámetro "skill_id"' };
        const toggled = skills.toggleSkill(userId, agentId, skillId, enabled);
        if (!toggled) return { name, success: false, result: '', error: `Habilidad "${skillId}" no encontrada` };
        return { name, success: true, result: `✅ Habilidad "${toggled.name}" ${enabled ? 'activada' : 'desactivada'}.` };
      }

      // ── Event Subscriptions ──────────────────────────────────────────────
      case 'subscribe_event': {
        const subName = params.name;
        const subType = params.type as eventSubs.EventSubscription['type'];
        const eventPattern = params.event_pattern;
        const instruction = params.instruction;

        if (!subName) return { name, success: false, result: '', error: 'Falta el parámetro "name"' };
        if (!subType) return { name, success: false, result: '', error: 'Falta el parámetro "type"' };
        if (!eventPattern) return { name, success: false, result: '', error: 'Falta el parámetro "event_pattern"' };
        if (!instruction) return { name, success: false, result: '', error: 'Falta el parámetro "instruction"' };

        const validTypes = ['webhook', 'poll', 'keyword', 'ha_state', 'custom'];
        if (!validTypes.includes(subType)) {
          return { name, success: false, result: '', error: `Tipo inválido "${subType}". Válidos: ${validTypes.join(', ')}` };
        }

        const sub = eventSubs.createSubscription(userId, agentId, {
          name: subName,
          type: subType,
          eventPattern,
          instruction,
          enabled: true,
          conditions: params.conditions || undefined,
          cooldownMinutes: typeof params.cooldown_minutes === 'number' ? params.cooldown_minutes : 5,
          pollIntervalMinutes: typeof params.poll_interval_minutes === 'number' ? params.poll_interval_minutes : 60,
          pollTarget: params.poll_target || undefined,
          haEntityId: params.ha_entity_id || undefined,
          haTargetState: params.ha_target_state || undefined,
          keyword: params.keyword || undefined,
        });

        return { name, success: true, result: `✅ Suscripción de eventos "${sub.name}" creada (ID: ${sub.id}).\nTipo: ${sub.type}\nPatrón: ${sub.eventPattern}\nCooldown: ${sub.cooldownMinutes} min\n${sub.pollIntervalMinutes ? `Intervalo poll: ${sub.pollIntervalMinutes} min\n` : ''}Estado: activa` };
      }

      case 'list_event_subscriptions': {
        const allSubs = eventSubs.getAllSubscriptions(userId, agentId);
        if (allSubs.length === 0) {
          return { name, success: true, result: 'No hay suscripciones de eventos. Usa subscribe_event para crear una.' };
        }
        const list = allSubs.map((s) =>
          `- "${s.name}" (ID: ${s.id})\n  Tipo: ${s.type} | Patrón: ${s.eventPattern}\n  Estado: ${s.enabled ? '✅ activa' : '❌ inactiva'}\n  Cooldown: ${s.cooldownMinutes} min | Disparos: ${s.fireCount}${s.lastFiredAt ? ` | Último: ${new Date(s.lastFiredAt).toLocaleString('es-ES')}` : ''}`
        ).join('\n\n');
        return { name, success: true, result: `Suscripciones de eventos (${allSubs.length}):\n\n${list}` };
      }

      case 'cancel_event_subscription': {
        const subId = params.subscription_id;
        if (!subId) return { name, success: false, result: '', error: 'Falta el parámetro "subscription_id"' };

        // Try by ID first, then search by name
        let deleted = eventSubs.deleteSubscription(userId, agentId, subId);
        if (!deleted) {
          const allSubs = eventSubs.getAllSubscriptions(userId, agentId);
          const match = allSubs.find((s) => s.name.toLowerCase() === subId.toLowerCase());
          if (match) {
            deleted = eventSubs.deleteSubscription(userId, agentId, match.id);
          }
        }
        if (!deleted) return { name, success: false, result: '', error: `Suscripción "${subId}" no encontrada` };
        return { name, success: true, result: `✅ Suscripción "${subId}" eliminada.` };
      }

      case 'toggle_event_subscription': {
        const subId = params.subscription_id;
        const enabled = String(params.enabled) === 'true';
        if (!subId) return { name, success: false, result: '', error: 'Falta el parámetro "subscription_id"' };

        let toggled = eventSubs.toggleSubscription(userId, agentId, subId, enabled);
        if (!toggled) {
          const allSubs = eventSubs.getAllSubscriptions(userId, agentId);
          const match = allSubs.find((s) => s.name.toLowerCase() === subId.toLowerCase());
          if (match) {
            toggled = eventSubs.toggleSubscription(userId, agentId, match.id, enabled);
          }
        }
        if (!toggled) return { name, success: false, result: '', error: `Suscripción "${subId}" no encontrada` };
        return { name, success: true, result: `✅ Suscripción "${toggled.name}" ${enabled ? 'activada' : 'desactivada'}.` };
      }

      // ── Terminal & Code Execution (Security-Hardened) ─────────────────
      case 'run_terminal_command': {
        if (!context.agentConfig.permissions.terminalAccess) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso de acceso al terminal del sistema. Activa "Acceso al terminal" en los permisos del agente.' };
        }
        const command = params.command;
        const reason = params.reason;
        if (!command) return { name, success: false, result: '', error: 'Falta el parámetro "command"' };
        if (!reason) return { name, success: false, result: '', error: 'Falta el parámetro "reason" (debes explicar por qué necesitas ejecutar este comando)' };

        const workingDir = typeof params.working_directory === 'string' ? params.working_directory : undefined;

        // ── Security pre-checks ──
        const { validation: cmdValidation, riskWarnings, auditEntry: cmdAudit } = preExecutionCheck({
          agentId,
          userId,
          type: 'terminal',
          command,
          reason,
          workingDirectory: workingDir,
        });

        if (!cmdValidation.allowed) {
          recordResourceEvent('agent_terminal_blocked', {
            command: command.slice(0, 200),
            reason: cmdValidation.reason,
            severity: cmdValidation.severity,
          });
          return {
            name,
            success: false,
            result: '',
            error: `${cmdValidation.reason}\n\nEste comando ha sido bloqueado por el sistema de seguridad. Intenta una alternativa segura o explica al usuario lo que necesitas hacer.`,
          };
        }

        // Build approval message with risk warnings if any
        let approvalReason = reason;
        if (riskWarnings.length > 0) {
          approvalReason += `\n\n⚠️ Advertencias de seguridad:\n${riskWarnings.map(w => `- ${w}`).join('\n')}`;
        }

        // Request user approval
        if (context.requestApproval) {
          const approved = await context.requestApproval({
            type: 'terminal',
            command,
            reason: approvalReason,
          });
          if (!approved) {
            cmdAudit.approved = false;
            return { name, success: false, result: '', error: 'El usuario ha denegado la ejecución del comando. Informa al usuario y pregunta si quiere una alternativa.' };
          }
          cmdAudit.approved = true;
        } else {
          return { name, success: false, result: '', error: 'No hay mecanismo de aprobación disponible. No se puede ejecutar el comando sin la confirmación del usuario.' };
        }

        // ── Execute with hardened settings ──
        const timeoutMs = typeof params.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) ? params.timeout_ms : 30000;
        const execStartTime = Date.now();

        try {
          const { execSync } = await import('child_process');
          const os = await import('os');
          const cwd = workingDir || os.homedir();
          const safeEnv = sanitizeEnvironment();
          const output = execSync(command, {
            cwd,
            timeout: Math.min(timeoutMs, 120000), // Max 2 minutes
            encoding: 'utf-8',
            maxBuffer: 1024 * 1024, // 1MB
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
            env: safeEnv,
          });
          const truncatedOutput = output.length > 4000 ? output.slice(0, 4000) + '\n... (salida truncada)' : output;
          updateAuditEntryResult(cmdAudit.id, 'success', Date.now() - execStartTime);
          recordResourceEvent('agent_terminal_command', { command: command.slice(0, 200), success: true });
          return { name, success: true, result: `✅ Comando ejecutado correctamente.\n\nComando: ${command}\nDirectorio: ${cwd}\n\nSalida:\n${truncatedOutput || '(sin salida)'}` };
        } catch (execError: any) {
          const stderr = execError.stderr ? String(execError.stderr).slice(0, 2000) : '';
          const stdout = execError.stdout ? String(execError.stdout).slice(0, 2000) : '';
          const execResult = execError.killed ? 'timeout' : 'error';
          updateAuditEntryResult(cmdAudit.id, execResult, Date.now() - execStartTime);
          recordResourceEvent('agent_terminal_command', { command: command.slice(0, 200), success: false });
          return { name, success: false, result: stdout || '', error: `Error ejecutando comando: ${execError.message}${stderr ? `\nStderr: ${stderr}` : ''}` };
        }
      }

      case 'execute_code': {
        if (!context.agentConfig.permissions.codeExecution) {
          return { name, success: false, result: '', error: 'El agente no tiene permiso de ejecución de código. Activa "Ejecución de código" en los permisos del agente.' };
        }
        const code = params.code;
        const reason = params.reason;
        const language = typeof params.language === 'string' ? params.language.toLowerCase().trim() : 'python';
        if (!code) return { name, success: false, result: '', error: 'Falta el parámetro "code"' };
        if (!reason) return { name, success: false, result: '', error: 'Falta el parámetro "reason" (debes explicar por qué necesitas ejecutar este código)' };

        // ── Security pre-checks ──
        const { validation: codeValidation, auditEntry: codeAudit } = preExecutionCheck({
          agentId,
          userId,
          type: 'code',
          code,
          language,
          reason,
        });

        if (!codeValidation.allowed) {
          recordResourceEvent('agent_code_blocked', {
            language,
            reason: codeValidation.reason,
            severity: codeValidation.severity,
          });
          return {
            name,
            success: false,
            result: '',
            error: `${codeValidation.reason}\n\nEste código ha sido bloqueado por el sistema de seguridad. Reescribe el código sin patrones peligrosos o explica al usuario lo que necesitas hacer.`,
          };
        }

        // Request user approval
        if (context.requestApproval) {
          const approved = await context.requestApproval({
            type: 'code',
            code,
            language,
            reason,
          });
          if (!approved) {
            codeAudit.approved = false;
            return { name, success: false, result: '', error: 'El usuario ha denegado la ejecución del código. Informa al usuario y pregunta si quiere una alternativa.' };
          }
          codeAudit.approved = true;
        } else {
          return { name, success: false, result: '', error: 'No hay mecanismo de aprobación disponible. No se puede ejecutar código sin la confirmación del usuario.' };
        }

        const timeoutMs = typeof params.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) ? params.timeout_ms : 60000;

        // Map language to interpreter/command
        const languageMap: Record<string, { cmd: string; ext: string; args: string[] }> = {
          python: { cmd: 'python3', ext: '.py', args: [] },
          python3: { cmd: 'python3', ext: '.py', args: [] },
          node: { cmd: 'node', ext: '.js', args: [] },
          nodejs: { cmd: 'node', ext: '.js', args: [] },
          javascript: { cmd: 'node', ext: '.js', args: [] },
          bash: { cmd: 'bash', ext: '.sh', args: [] },
          sh: { cmd: 'sh', ext: '.sh', args: [] },
          powershell: { cmd: 'powershell', ext: '.ps1', args: ['-File'] },
        };

        const langConfig = languageMap[language];
        if (!langConfig) {
          return { name, success: false, result: '', error: `Lenguaje no soportado: "${language}". Soportados: ${Object.keys(languageMap).join(', ')}` };
        }

        const codeExecStartTime = Date.now();

        try {
          const fs = await import('fs');
          const os = await import('os');
          const { execSync } = await import('child_process');

          // Write code to a secure temporary file (crypto-random name)
          const tmpFile = secureTemporaryFilePath(langConfig.ext);
          fs.writeFileSync(tmpFile, code, { encoding: 'utf-8', mode: 0o600 });

          try {
            const cmdArgs = langConfig.args.length > 0 ? `${langConfig.args.join(' ')} ` : '';
            // Use sanitized path argument to prevent injection
            const safeTmpFile = sanitizeCommandArg(tmpFile);
            const fullCmd = `${langConfig.cmd} ${cmdArgs}${safeTmpFile}`;
            const safeEnv = sanitizeEnvironment();
            const output = execSync(fullCmd, {
              cwd: os.homedir(),
              timeout: Math.min(timeoutMs, 300000), // Max 5 minutes
              encoding: 'utf-8',
              maxBuffer: 2 * 1024 * 1024, // 2MB
              env: safeEnv,
            });
            const truncatedOutput = output.length > 6000 ? output.slice(0, 6000) + '\n... (salida truncada)' : output;
            updateAuditEntryResult(codeAudit.id, 'success', Date.now() - codeExecStartTime);
            recordResourceEvent('agent_code_execution', { language, success: true });
            return { name, success: true, result: `✅ Código (${language}) ejecutado correctamente.\n\nSalida:\n${truncatedOutput || '(sin salida)'}` };
          } finally {
            // Clean up temp file securely
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
          }
        } catch (execError: any) {
          const stderr = execError.stderr ? String(execError.stderr).slice(0, 3000) : '';
          const stdout = execError.stdout ? String(execError.stdout).slice(0, 2000) : '';
          const codeExecResult = execError.killed ? 'timeout' : 'error';
          updateAuditEntryResult(codeAudit.id, codeExecResult, Date.now() - codeExecStartTime);
          recordResourceEvent('agent_code_execution', { language, success: false });
          return { name, success: false, result: stdout || '', error: `Error ejecutando código (${language}): ${execError.message}${stderr ? `\nStderr: ${stderr}` : ''}` };
        }
      }

      // ── Document Tools ────────────────────────────────────────────────

      case 'read_word': {
        const filePath = params.file_path;
        if (!filePath) return { name, success: false, result: '', error: 'Falta el parámetro "file_path"' };
        try {
          const result = await documentTools.readWord(filePath);
          const stylesInfo = result.styles.length > 0 ? `\nEstilos encontrados: ${result.styles.join(', ')}` : '';
          const metaInfo = result.metadata.warnings ? `\nAdvertencias: ${result.metadata.warnings}` : '';
          const textPreview = result.text.length > 5000 ? result.text.slice(0, 5000) + '\n... (texto truncado)' : result.text;
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          return { name, success: true, result: `📄 Documento Word leído correctamente.${stylesInfo}${metaInfo}\n\nContenido:\n${textPreview}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error leyendo Word: ${err.message}` };
        }
      }

      case 'create_word': {
        const fileName = params.file_name;
        if (!fileName) return { name, success: false, result: '', error: 'Falta el parámetro "file_name"' };
        if (!params.content) return { name, success: false, result: '', error: 'Falta el parámetro "content"' };
        try {
          const content = typeof params.content === 'string' ? JSON.parse(params.content) : params.content;
          const formatting = params.formatting
            ? (typeof params.formatting === 'string' ? JSON.parse(params.formatting) : params.formatting)
            : undefined;
          const result = await documentTools.createWord({ userId, agentId, fileName, content, formatting });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safeName = require('path').basename(fileName);
          const downloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safeName)}`;
          return { name, success: true, result: `✅ Documento Word creado (${(result.size / 1024).toFixed(1)} KB).\n\n📥 [Descargar ${safeName}](${downloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error creando Word: ${err.message}` };
        }
      }

      case 'edit_word': {
        const sourceFilePath = params.source_file_path;
        const outputFileName = params.output_file_name;
        if (!sourceFilePath) return { name, success: false, result: '', error: 'Falta el parámetro "source_file_path"' };
        if (!outputFileName) return { name, success: false, result: '', error: 'Falta el parámetro "output_file_name"' };
        if (!params.operations) return { name, success: false, result: '', error: 'Falta el parámetro "operations"' };
        try {
          const operations = typeof params.operations === 'string' ? JSON.parse(params.operations) : params.operations;
          const result = await documentTools.editWord({ userId, agentId, sourceFilePath, outputFileName, operations });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safeName = require('path').basename(outputFileName);
          const downloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safeName)}`;
          return { name, success: true, result: `✅ Documento Word editado (${(result.size / 1024).toFixed(1)} KB) — ${operations.length} operación(es).\n\n📥 [Descargar ${safeName}](${downloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error editando Word: ${err.message}` };
        }
      }

      case 'read_pdf': {
        const filePath = params.file_path;
        if (!filePath) return { name, success: false, result: '', error: 'Falta el parámetro "file_path"' };
        try {
          const result = await documentTools.readPdf(filePath);
          const meta = Object.entries(result.metadata).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
          const textPreview = result.text.length > 5000 ? result.text.slice(0, 5000) + '\n... (texto truncado)' : result.text;
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          return { name, success: true, result: `📄 PDF leído: ${result.pageCount} páginas.${meta ? `\nMetadatos: ${meta}` : ''}\n\nContenido:\n${textPreview}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error leyendo PDF: ${err.message}` };
        }
      }

      case 'create_pdf': {
        const fileName = params.file_name;
        if (!fileName) return { name, success: false, result: '', error: 'Falta el parámetro "file_name"' };
        if (!params.content) return { name, success: false, result: '', error: 'Falta el parámetro "content"' };
        try {
          const content = typeof params.content === 'string' ? JSON.parse(params.content) : params.content;
          const result = await documentTools.createPdf({ userId, agentId, fileName, content });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safePdfName = require('path').basename(fileName);
          const pdfDownloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safePdfName)}`;
          return { name, success: true, result: `✅ PDF creado (${(result.size / 1024).toFixed(1)} KB).\n\n📥 [Descargar ${safePdfName}](${pdfDownloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error creando PDF: ${err.message}` };
        }
      }

      case 'annotate_pdf': {
        const sourceFilePath = params.source_file_path;
        const outputFileName = params.output_file_name;
        if (!sourceFilePath) return { name, success: false, result: '', error: 'Falta el parámetro "source_file_path"' };
        if (!outputFileName) return { name, success: false, result: '', error: 'Falta el parámetro "output_file_name"' };
        if (!params.annotations) return { name, success: false, result: '', error: 'Falta el parámetro "annotations"' };
        try {
          const annotations = typeof params.annotations === 'string' ? JSON.parse(params.annotations) : params.annotations;
          const result = await documentTools.annotatePdf({ userId, agentId, sourceFilePath, outputFileName, annotations });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safeAnnotatedName = require('path').basename(outputFileName);
          const annotatedDownloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safeAnnotatedName)}`;
          return { name, success: true, result: `✅ PDF anotado (${(result.size / 1024).toFixed(1)} KB) — ${annotations.length} anotaciones añadidas.\n\n📥 [Descargar ${safeAnnotatedName}](${annotatedDownloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error anotando PDF: ${err.message}` };
        }
      }

      case 'create_powerpoint': {
        const fileName = params.file_name;
        if (!fileName) return { name, success: false, result: '', error: 'Falta el parámetro "file_name"' };
        if (!params.slides) return { name, success: false, result: '', error: 'Falta el parámetro "slides"' };
        try {
          const slides = typeof params.slides === 'string' ? JSON.parse(params.slides) : params.slides;
          const result = await documentTools.createPowerPoint({
            userId,
            agentId,
            fileName,
            slides,
            title: typeof params.title === 'string' ? params.title : undefined,
            author: typeof params.author === 'string' ? params.author : undefined,
            subject: typeof params.subject === 'string' ? params.subject : undefined,
          });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safePptxName = require('path').basename(fileName);
          const pptxDownloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safePptxName)}`;
          return { name, success: true, result: `✅ PowerPoint creado (${(result.size / 1024).toFixed(1)} KB) — ${slides.length} diapositivas.\n\n📥 [Descargar ${safePptxName}](${pptxDownloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error creando PowerPoint: ${err.message}` };
        }
      }

      case 'edit_powerpoint': {
        const sourceFilePath = params.source_file_path;
        const outputFileName = params.output_file_name;
        if (!sourceFilePath) return { name, success: false, result: '', error: 'Falta el parámetro "source_file_path"' };
        if (!outputFileName) return { name, success: false, result: '', error: 'Falta el parámetro "output_file_name"' };
        if (!params.operations) return { name, success: false, result: '', error: 'Falta el parámetro "operations"' };
        try {
          const operations = typeof params.operations === 'string' ? JSON.parse(params.operations) : params.operations;
          const result = await documentTools.editPowerPoint({ userId, agentId, sourceFilePath, outputFileName, operations });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safeName = require('path').basename(outputFileName);
          const downloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safeName)}`;
          return { name, success: true, result: `✅ PowerPoint editado (${(result.size / 1024).toFixed(1)} KB) — ${operations.length} operación(es).\n\n📥 [Descargar ${safeName}](${downloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error editando PowerPoint: ${err.message}` };
        }
      }

      case 'read_excel': {
        const filePath = params.file_path;
        if (!filePath) return { name, success: false, result: '', error: 'Falta el parámetro "file_path"' };
        try {
          const result = await documentTools.readExcel(filePath);
          const summary = result.sheets.map((s) => {
            const headerLine = s.headers.length > 0 ? `Encabezados: ${s.headers.join(' | ')}` : '';
            const preview = s.data.slice(0, 10).map((r) => r.join(' | ')).join('\n');
            return `📊 Hoja "${s.name}" (${s.rowCount} filas × ${s.columnCount} cols)\n${headerLine}\n${preview}${s.data.length > 10 ? '\n... (mostrando 10 de ' + s.data.length + ' filas)' : ''}`;
          }).join('\n\n');
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          return { name, success: true, result: `Excel leído: ${result.sheets.length} hoja(s).\n\n${summary}` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error leyendo Excel: ${err.message}` };
        }
      }

      case 'create_excel': {
        const fileName = params.file_name;
        if (!fileName) return { name, success: false, result: '', error: 'Falta el parámetro "file_name"' };
        if (!params.sheets) return { name, success: false, result: '', error: 'Falta el parámetro "sheets"' };
        try {
          const sheets = typeof params.sheets === 'string' ? JSON.parse(params.sheets) : params.sheets;
          const result = await documentTools.createExcel({
            userId,
            agentId,
            fileName,
            sheets,
            author: typeof params.author === 'string' ? params.author : undefined,
          });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safeXlsxName = require('path').basename(fileName);
          const xlsxDownloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safeXlsxName)}`;
          return { name, success: true, result: `✅ Excel creado (${(result.size / 1024).toFixed(1)} KB) — ${sheets.length} hoja(s).\n\n📥 [Descargar ${safeXlsxName}](${xlsxDownloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error creando Excel: ${err.message}` };
        }
      }

      case 'edit_excel': {
        const sourceFilePath = params.source_file_path;
        const outputFileName = params.output_file_name;
        if (!sourceFilePath) return { name, success: false, result: '', error: 'Falta el parámetro "source_file_path"' };
        if (!outputFileName) return { name, success: false, result: '', error: 'Falta el parámetro "output_file_name"' };
        if (!params.operations) return { name, success: false, result: '', error: 'Falta el parámetro "operations"' };
        try {
          const operations = typeof params.operations === 'string' ? JSON.parse(params.operations) : params.operations;
          const result = await documentTools.editExcel({ userId, agentId, sourceFilePath, outputFileName, operations });
          recordResourceEvent('agent_tool_call', { tool: name, success: true });
          const safeEditedName = require('path').basename(outputFileName);
          const editedXlsxDownloadUrl = `/api/agents/${encodeURIComponent(agentId)}/documents/${encodeURIComponent(safeEditedName)}`;
          return { name, success: true, result: `✅ Excel editado (${(result.size / 1024).toFixed(1)} KB) — ${operations.length} operación(es) aplicada(s).\n\n📥 [Descargar ${safeEditedName}](${editedXlsxDownloadUrl})` };
        } catch (err: any) {
          return { name, success: false, result: '', error: `Error editando Excel: ${err.message}` };
        }
      }

      default: {
        // Check if it's an MCP tool call (prefixed with mcp_)
        if (name.startsWith('mcp_') && context.mcpManager) {
          const mcpResult = await context.mcpManager.callTool(name, params);
          recordResourceEvent('agent_mcp_tool_call', {
            tool: name,
            serverId: name.split('__')[0]?.replace('mcp_', '') || 'unknown',
            success: mcpResult.success,
          });
          return {
            name,
            success: mcpResult.success,
            result: mcpResult.content,
            error: mcpResult.error,
          };
        }
        return { name, success: false, result: '', error: `Herramienta desconocida: ${name}` };
      }
    }
  } catch (error: any) {
    return { name, success: false, result: '', error: `Error ejecutando ${name}: ${error.message}` };
  }
}

// ---------------------------------------------------------------------------
// Legacy fallback: parse tool calls embedded in text
// ---------------------------------------------------------------------------

export function parseToolCalls(text: string): { toolCalls: ToolCallRequest[]; cleanText: string } {
  const toolCalls: ToolCallRequest[] = [];
  let cleanText = text;

  // 1. Try standard <tool_call>JSON</tool_call> format
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = toolCallRegex.exec(text)) !== null) {
    const parsed = tryParseToolCallJson(match[1].trim());
    if (parsed) {
      toolCalls.push(parsed);
    }
    cleanText = cleanText.replace(match[0], '').trim();
  }

  // 2. Also try <function_call>JSON</function_call> format
  if (toolCalls.length === 0) {
    const fnCallRegex = /<function_call>\s*([\s\S]*?)\s*<\/function_call>/g;
    while ((match = fnCallRegex.exec(text)) !== null) {
      const parsed = tryParseToolCallJson(match[1].trim());
      if (parsed) {
        toolCalls.push(parsed);
      }
      cleanText = cleanText.replace(match[0], '').trim();
    }
  }

  // 3. Try bare JSON objects with "name" key on their own lines
  if (toolCalls.length === 0) {
    const compactXmlRegex = /<([a-zA-Z][a-zA-Z0-9_:.-]*)\s+([^<>]*?)\s*\/>/g;
    while ((match = compactXmlRegex.exec(text)) !== null) {
      const toolName = match[1].trim();
      if (!toolName || !/^[a-zA-Z0-9_:.\-]+$/.test(toolName)) continue;

      const rawAttrs = match[2] || '';
      const attrs: Record<string, string> = {};
      const attrRegex = /([a-zA-Z_][a-zA-Z0-9_\-]*)\s*=\s*"([\s\S]*?)"(?=\s+[a-zA-Z_][a-zA-Z0-9_\-]*\s*=|\s*$)/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        attrs[attrMatch[1]] = decodeXmlAttribute(attrMatch[2]);
      }

      const params: Record<string, any> = {};
      for (const [key, value] of Object.entries(attrs)) {
        if (key === 'params' || key === 'parameters' || key === 'arguments' || key === 'variants') {
          try {
            const parsedObj = JSON.parse(value);
            if (parsedObj && typeof parsedObj === 'object' && !Array.isArray(parsedObj)) {
              Object.assign(params, parsedObj);
              continue;
            }
          } catch {
            // fall through and keep raw value
          }
        }
        params[key] = value;
      }

      toolCalls.push({ name: toolName, params });
      cleanText = cleanText.replace(match[0], '').trim();
    }
  }

  // 4. Try bare JSON objects with "name" key on their own lines
  if (toolCalls.length === 0) {
    const bareJsonRegex = /^\s*(\{\s*"name"\s*:\s*"[a-z_]+"\s*,\s*"(?:parameters|params|arguments)"\s*:\s*\{[\s\S]*?\}\s*\})\s*$/gm;
    while ((match = bareJsonRegex.exec(text)) !== null) {
      const parsed = tryParseToolCallJson(match[1].trim());
      if (parsed) {
        toolCalls.push(parsed);
        cleanText = cleanText.replace(match[0], '').trim();
      }
    }
  }

  return { toolCalls, cleanText };
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Try to parse a JSON string as a tool call.
 * Handles "params", "parameters", and "arguments" keys.
 */
function tryParseToolCallJson(jsonStr: string): ToolCallRequest | null {
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.name && typeof parsed.name === 'string') {
      return {
        name: parsed.name,
        params: parsed.params || parsed.parameters || parsed.arguments || {},
      };
    }
  } catch {
    // Try to recover malformed JSON
    try {
      const nameMatch = jsonStr.match(/"name"\s*:\s*"([^"]+)"/);
      const paramsMatch = jsonStr.match(/"(?:params|parameters|arguments)"\s*:\s*(\{[\s\S]*\})/);
      if (nameMatch) {
        return {
          name: nameMatch[1],
          params: paramsMatch ? JSON.parse(paramsMatch[1]) : {},
        };
      }
    } catch {
      // Skip unparseable tool call
    }
  }
  return null;
}
