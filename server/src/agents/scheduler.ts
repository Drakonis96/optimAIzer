// ---------------------------------------------------------------------------
// Scheduler Service — Cron-like task execution using simple interval matching
// ---------------------------------------------------------------------------

export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  enabled: boolean;
  startAt?: number;
  frequency?: string;
  conditions?: string;
  timezone?: string;
  lastRun?: number;
  oneShot?: boolean;
  triggerAt?: number;
}

export interface SchedulerService {
  start(): void;
  stop(): void;
  addTask(task: ScheduledTask): void;
  removeTask(taskId: string): void;
  getTasks(): ScheduledTask[];
  onTaskTrigger(handler: (task: ScheduledTask) => void): void;
  onOneShotFired?: (task: ScheduledTask) => void;
}

// ---------------------------------------------------------------------------
// Simple cron parser (handles common patterns without external deps)
// Format: minute hour day month weekday
// Supports: *, specific numbers, ranges (1-5), lists (1,3,5), */N
// ---------------------------------------------------------------------------

interface CronParts {
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
}

function parseCronExpression(cron: string): CronParts | null {
  const normalizedCron = normalizeCronDescription(cron);
  const parts = normalizedCron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  return {
    minute: parts[0],
    hour: parts[1],
    day: parts[2],
    month: parts[3],
    weekday: parts[4],
  };
}

function normalizeCronDescription(input: string): string {
  // If it already looks like a cron expression, return it
  if (/^[\d*\/,\-\s]+$/.test(input.trim()) && input.trim().split(/\s+/).length === 5) {
    return input.trim();
  }

  // Try to convert natural language descriptions to cron
  const lower = input.toLowerCase().trim();

  // "todos los días a las 14:00" / "every day at 14:00"
  const dailyMatch = lower.match(/(?:todos los días|every day|diariamente|daily).*?(\d{1,2})[:\.](\d{2})/);
  if (dailyMatch) {
    return `${parseInt(dailyMatch[2])} ${parseInt(dailyMatch[1])} * * *`;
  }

  // "a las 14:00" / "at 14:00"
  const atTimeMatch = lower.match(/(?:a las|at)\s+(\d{1,2})[:\.](\d{2})/);
  if (atTimeMatch) {
    return `${parseInt(atTimeMatch[2])} ${parseInt(atTimeMatch[1])} * * *`;
  }

  // "cada hora" / "every hour"
  if (lower.includes('cada hora') || lower.includes('every hour')) {
    return '0 * * * *';
  }

  // "cada 30 minutos" / "every 30 minutes"
  const minuteMatch = lower.match(/cada\s+(\d+)\s+minutos?|every\s+(\d+)\s+minutes?/);
  if (minuteMatch) {
    const mins = parseInt(minuteMatch[1] || minuteMatch[2]);
    return `*/${mins} * * * *`;
  }

  // "lunes a las 9:00" / "monday at 9:00"
  const weekdayMap: Record<string, number> = {
    domingo: 0, sunday: 0, lunes: 1, monday: 1, martes: 2, tuesday: 2,
    miércoles: 3, miercoles: 3, wednesday: 3, jueves: 4, thursday: 4,
    viernes: 5, friday: 5, sábado: 6, sabado: 6, saturday: 6,
  };

  for (const [day, num] of Object.entries(weekdayMap)) {
    const dayMatch = lower.match(new RegExp(`${day}.*?(\\d{1,2})[:\\.](\\d{2})`));
    if (dayMatch) {
      return `${parseInt(dayMatch[2])} ${parseInt(dayMatch[1])} * * ${num}`;
    }
  }

  // Return the original input as-is (will fail cron validation, which is fine)
  return input;
}

function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;

  // Step: */N
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2));
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // List: 1,3,5
  if (field.includes(',')) {
    return field.split(',').some(part => matchesCronField(part.trim(), value));
  }

  // Range: 1-5
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    if (!isNaN(start) && !isNaN(end)) {
      return value >= start && value <= end;
    }
  }

  // Exact number
  const num = parseInt(field);
  return !isNaN(num) && num === value;
}

function shouldRunNow(cron: CronParts, now: Date, timezone?: string): boolean {
  let minutes: number, hours: number, day: number, month: number, weekday: number;

  if (timezone) {
    try {
      // Convert to the task's timezone using Intl
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric',
        day: 'numeric', month: 'numeric', weekday: 'short',
        hour12: false,
      }).formatToParts(now);

      const get = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((p) => p.type === type)?.value ?? '';

      minutes = parseInt(get('minute'));
      hours = parseInt(get('hour'));
      day = parseInt(get('day'));
      month = parseInt(get('month'));
      const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      weekday = weekdayMap[get('weekday')] ?? now.getDay();
    } catch {
      // Invalid timezone — fall back to server time
      minutes = now.getMinutes();
      hours = now.getHours();
      day = now.getDate();
      month = now.getMonth() + 1;
      weekday = now.getDay();
    }
  } else {
    minutes = now.getMinutes();
    hours = now.getHours();
    day = now.getDate();
    month = now.getMonth() + 1;
    weekday = now.getDay();
  }

  return (
    matchesCronField(cron.minute, minutes) &&
    matchesCronField(cron.hour, hours) &&
    matchesCronField(cron.day, day) &&
    matchesCronField(cron.month, month) &&
    matchesCronField(cron.weekday, weekday)
  );
}

// ---------------------------------------------------------------------------
// Scheduler implementation
// ---------------------------------------------------------------------------

export function createScheduler(): SchedulerService {
  let tasks: ScheduledTask[] = [];
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let triggerHandler: ((task: ScheduledTask) => void) | null = null;
  let oneShotHandler: ((task: ScheduledTask) => void) | null = null;
  let running = false;

  function checkTasks(): void {
    const now = new Date();
    const nowMs = now.getTime();

    for (const task of tasks) {
      if (!task.enabled) continue;

      // One-shot trigger-at check (timestamp-based, no cron needed)
      if (task.oneShot && typeof task.triggerAt === 'number' && Number.isFinite(task.triggerAt)) {
        if (nowMs >= task.triggerAt) {
          // Don't fire twice
          const oneMinuteAgo = nowMs - 60_000;
          if (task.lastRun && task.lastRun > oneMinuteAgo) continue;

          task.lastRun = nowMs;
          task.enabled = false;
          console.log(`[Scheduler] One-shot reminder fired: "${task.name}"`);

          if (triggerHandler) {
            try {
              triggerHandler(task);
            } catch (error: any) {
              console.error(`[Scheduler] Error in handler for "${task.name}":`, error.message);
            }
          }
          if (oneShotHandler) {
            try {
              oneShotHandler(task);
            } catch { /* ignore */ }
          }
        }
        continue;
      }

      if (typeof task.startAt === 'number' && Number.isFinite(task.startAt) && nowMs < task.startAt) {
        continue;
      }

      const cron = parseCronExpression(task.cron);
      if (!cron) continue;

      if (shouldRunNow(cron, now, task.timezone)) {
        // Don't run more than once per minute
        const oneMinuteAgo = nowMs - 60_000;
        if (task.lastRun && task.lastRun > oneMinuteAgo) continue;

        task.lastRun = nowMs;
        console.log(`[Scheduler] Triggering task: "${task.name}" (cron: ${task.cron})`);

        if (triggerHandler) {
          try {
            triggerHandler(task);
          } catch (error: any) {
            console.error(`[Scheduler] Error in handler for "${task.name}":`, error.message);
          }
        }

        // Auto-disable one-shot cron tasks after firing
        if (task.oneShot) {
          task.enabled = false;
          console.log(`[Scheduler] One-shot task "${task.name}" auto-disabled after execution`);
          if (oneShotHandler) {
            try {
              oneShotHandler(task);
            } catch { /* ignore */ }
          }
        }
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      // Check every 30 seconds
      intervalId = setInterval(checkTasks, 30_000);
      console.log(`[Scheduler] Started with ${tasks.length} tasks`);
    },

    stop() {
      running = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      console.log('[Scheduler] Stopped');
    },

    addTask(task: ScheduledTask) {
      // Remove existing with same id
      tasks = tasks.filter(t => t.id !== task.id);
      tasks.push(task);
      console.log(`[Scheduler] Added task: "${task.name}" (cron: ${task.cron})`);
    },

    removeTask(taskId: string) {
      tasks = tasks.filter(t => t.id !== taskId);
    },

    getTasks() {
      return [...tasks];
    },

    onTaskTrigger(handler) {
      triggerHandler = handler;
    },

    set onOneShotFired(handler: ((task: ScheduledTask) => void) | undefined) {
      oneShotHandler = handler || null;
    },
  };
}
