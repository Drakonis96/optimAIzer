// ---------------------------------------------------------------------------
// Terminal & Code Execution Security Module
// ---------------------------------------------------------------------------
// Provides command validation, code analysis, rate limiting, audit logging,
// path validation, and environment sanitization for AI-driven executions.
// ---------------------------------------------------------------------------

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityValidationResult {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  matchedPattern?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: number;
  agentId: string;
  userId: string;
  type: 'terminal' | 'code';
  command?: string;
  code?: string;
  language?: string;
  reason: string;
  approved: boolean;
  blocked: boolean;
  blockReason?: string;
  executionResult?: 'success' | 'error' | 'timeout';
  durationMs?: number;
  workingDirectory?: string;
}

export interface RateLimitConfig {
  maxExecutionsPerMinute: number;
  maxExecutionsPerHour: number;
  cooldownAfterBlockMs: number;
}

// ---------------------------------------------------------------------------
// Dangerous Command Patterns — Static blocklist
// ---------------------------------------------------------------------------

/** Commands/patterns that should NEVER be executed regardless of approval */
const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string; severity: 'high' | 'critical' }> = [
  // ── Destructive filesystem operations ──
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\s*\/\s*$/i, reason: 'Eliminación recursiva del sistema de archivos raíz', severity: 'critical' },
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?\s*\/\s*$/i, reason: 'Eliminación recursiva del sistema de archivos raíz', severity: 'critical' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/($|\s)/i, reason: 'Eliminación recursiva forzada de /', severity: 'critical' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+\/($|\s)/i, reason: 'Eliminación recursiva forzada de /', severity: 'critical' },
  { pattern: /\brm\b.*--no-preserve-root/i, reason: 'Intento de eliminar raíz del sistema', severity: 'critical' },
  { pattern: /\bmkfs\b/i, reason: 'Formateo de sistema de archivos', severity: 'critical' },
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Formateo de disco (Windows)', severity: 'critical' },
  { pattern: /\bdd\s+.*\bof=\/dev\/[sh]d[a-z]/i, reason: 'Escritura directa a dispositivo de disco', severity: 'critical' },
  { pattern: /\bdd\s+.*\bof=\/dev\/nvme/i, reason: 'Escritura directa a dispositivo NVMe', severity: 'critical' },
  { pattern: />\s*\/dev\/[sh]d[a-z]/i, reason: 'Redirección a dispositivo de disco', severity: 'critical' },

  // ── Reverse shells / Remote code execution ──
  { pattern: /\bbash\s+-i\s+>&?\s*\/dev\/tcp\//i, reason: 'Reverse shell via bash', severity: 'critical' },
  { pattern: /\bnc\s+(-[a-zA-Z]*e[a-zA-Z]*\s+|.*-e\s+).*\b(ba)?sh\b/i, reason: 'Reverse shell via netcat', severity: 'critical' },
  { pattern: /\bncat\s+.*(-[a-zA-Z]*e[a-zA-Z]*\s+|--exec).*\b(ba)?sh\b/i, reason: 'Reverse shell via ncat', severity: 'critical' },
  { pattern: /\bsocat\b.*\bexec\b.*\bsh\b/i, reason: 'Reverse shell via socat', severity: 'critical' },
  { pattern: /\bpython[23]?\s+-c\s+.*\bsocket\b.*\bconnect\b/i, reason: 'Reverse shell via Python', severity: 'critical' },
  { pattern: /\bperl\s+-e\s+.*\bsocket\b.*\bINET\b/i, reason: 'Reverse shell via Perl', severity: 'critical' },
  { pattern: /\bruby\s+-r\s*socket\b/i, reason: 'Reverse shell via Ruby', severity: 'critical' },
  { pattern: /\bphp\s+-r\s+.*\bfsockopen\b/i, reason: 'Reverse shell via PHP', severity: 'critical' },
  { pattern: /\/dev\/tcp\/[\d.]+\/\d+/i, reason: 'Conexión TCP directa sospechosa', severity: 'critical' },
  { pattern: /\bmkfifo\b.*\bnc\b/i, reason: 'Named pipe con netcat (técnica de reverse shell)', severity: 'critical' },

  // ── Curl/wget piped to shell (remote code execution) ──
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/i, reason: 'Ejecución remota: curl piped a shell', severity: 'critical' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/i, reason: 'Ejecución remota: wget piped a shell', severity: 'critical' },
  { pattern: /\bcurl\b.*\|\s*python/i, reason: 'Ejecución remota: curl piped a python', severity: 'critical' },
  { pattern: /\bwget\b.*-O\s*-\s*\|\s*(ba)?sh\b/i, reason: 'Ejecución remota: wget piped a shell', severity: 'critical' },

  // ── Credential/secret exfiltration ──
  { pattern: /\bcat\b.*\/(etc\/shadow|etc\/passwd|\.ssh\/|\.gnupg\/|\.aws\/credentials)/i, reason: 'Lectura de archivos de credenciales del sistema', severity: 'critical' },
  { pattern: /\bcat\b.*\.env\b.*\|\s*(curl|wget|nc|ncat)/i, reason: 'Exfiltración de variables de entorno', severity: 'critical' },
  { pattern: /\benv\b\s*\|\s*(curl|wget|nc|ncat)/i, reason: 'Exfiltración de variables de entorno', severity: 'critical' },
  { pattern: /\b(curl|wget|nc)\b.*\$\(cat\b/i, reason: 'Exfiltración de archivos via red', severity: 'high' },

  // ── Privilege escalation attempts ──
  { pattern: /\bchmod\s+[0-7]*[4-7][0-7]{2}\s+\/usr\/bin\/|chmod\s+u\+s\b/i, reason: 'Intento de establecer SUID bit', severity: 'critical' },
  { pattern: /\bchown\s+root\b/i, reason: 'Intento de cambiar propietario a root', severity: 'high' },
  { pattern: /\bvisudo\b/i, reason: 'Modificación de sudoers', severity: 'critical' },
  { pattern: /echo\s+.*>>\s*\/etc\/sudoers/i, reason: 'Modificación directa de sudoers', severity: 'critical' },

  // ── System integrity attacks ──
  { pattern: /\b(systemctl|service)\s+(stop|disable)\s+(firewalld|iptables|ufw|apparmor|selinux)/i, reason: 'Desactivación de firewall o sistema de seguridad', severity: 'critical' },
  { pattern: /\biptables\s+-F\b/i, reason: 'Eliminación de todas las reglas de firewall', severity: 'critical' },
  { pattern: /\bufw\s+disable\b/i, reason: 'Desactivación de UFW', severity: 'critical' },
  { pattern: /\bsetenforce\s+0\b/i, reason: 'Desactivación de SELinux', severity: 'critical' },

  // ── Crypto miners / malware ──
  { pattern: /\b(xmrig|minerd|cpuminer|cgminer|bfgminer)\b/i, reason: 'Detección de herramienta de minería de criptomonedas', severity: 'critical' },
  { pattern: /stratum\+tcp:\/\//i, reason: 'Conexión a pool de minería de criptomonedas', severity: 'critical' },

  // ── Fork bombs ──
  { pattern: /:\(\)\{.*:\|:.*\}/i, reason: 'Fork bomb detectada', severity: 'critical' },
  { pattern: /\bfork\b.*\bwhile\b.*\btrue\b/i, reason: 'Fork bomb potencial', severity: 'critical' },

  // ── Suspicious package/binary installs from unknown sources ──
  { pattern: /\bchmod\s+\+x\b.*\/(tmp|var\/tmp)\//i, reason: 'Haciendo ejecutable un archivo en directorio temporal', severity: 'high' },

  // ── Kernel module manipulation ──
  { pattern: /\binsmod\b/i, reason: 'Inserción de módulo de kernel', severity: 'critical' },
  { pattern: /\brmmod\b/i, reason: 'Eliminación de módulo de kernel', severity: 'high' },
  { pattern: /\bmodprobe\b/i, reason: 'Manipulación de módulo de kernel', severity: 'high' },

  // ── Network sniffing / manipulation ──
  { pattern: /\btcpdump\b.*-w\b/i, reason: 'Captura de tráfico de red a archivo', severity: 'high' },
  { pattern: /\btshark\b.*-w\b/i, reason: 'Captura de tráfico de red a archivo', severity: 'high' },

  // ── History/log wiping ──
  { pattern: />\s*\/dev\/null\s*2>&1\s*;\s*history\s+-c/i, reason: 'Intento de ocultar actividad y borrar historial', severity: 'critical' },
  { pattern: /\bhistory\s+-c\b/i, reason: 'Borrado de historial de shell', severity: 'high' },
  { pattern: /\bshred\b.*\/(var\/log|\.bash_history)/i, reason: 'Destrucción de logs del sistema', severity: 'critical' },
  { pattern: /\btruncate\b.*\/(var\/log)/i, reason: 'Truncado de logs del sistema', severity: 'critical' },
];

/** High-risk commands that require extra warning (not blocked, but flagged) */
const HIGH_RISK_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/i, reason: 'Comando con privilegios elevados (sudo)' },
  { pattern: /\bsu\s+-?\s*$/i, reason: 'Cambio a usuario root' },
  { pattern: /\brm\s+-[a-zA-Z]*r/i, reason: 'Eliminación recursiva de archivos' },
  { pattern: /\bkill\s+-9/i, reason: 'Terminación forzosa de proceso' },
  { pattern: /\bkillall\b/i, reason: 'Terminación de múltiples procesos' },
  { pattern: /\bshutdown\b/i, reason: 'Apagado del sistema' },
  { pattern: /\breboot\b/i, reason: 'Reinicio del sistema' },
  { pattern: /\bcrontab\s+-e/i, reason: 'Edición de tareas programadas del sistema' },
  { pattern: /echo\b.*>>\?\s*\/etc\//i, reason: 'Modificación de archivos de configuración del sistema' },
  { pattern: /\bapt\s+(remove|purge)\b/i, reason: 'Eliminación de paquetes del sistema' },
  { pattern: /\bbrew\s+uninstall\b/i, reason: 'Eliminación de paquetes (Homebrew)' },
  { pattern: /\bnpm\s+(-g\s+)?uninstall\b/i, reason: 'Eliminación global de paquetes npm' },
  { pattern: /\bpip\s+uninstall\b/i, reason: 'Eliminación de paquetes Python' },
];

// ---------------------------------------------------------------------------
// Dangerous Code Patterns
// ---------------------------------------------------------------------------

const BLOCKED_CODE_PATTERNS: Array<{ pattern: RegExp; reason: string; severity: 'high' | 'critical'; languages?: string[] }> = [
  // ── Network-based attacks ──
  { pattern: /\bsocket\b.*\bconnect\b/i, reason: 'Conexión de socket saliente (posible reverse shell)', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bsubprocess\b.*\b(Popen|call|run)\b.*\b(nc|ncat|bash|sh)\b/i, reason: 'Subprocess con ejecución de shell sospechosa', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bos\.system\b.*\b(nc|ncat|curl.*\|.*sh|wget.*\|.*sh)\b/i, reason: 'os.system con ejecución remota sospechosa', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bchild_process\b.*\bexec(Sync)?\b.*\b(nc|ncat|bash -i)\b/i, reason: 'child_process con reverse shell', severity: 'critical', languages: ['node', 'nodejs', 'javascript'] },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\).*exec.*\bsh\b/i, reason: 'child_process con shell execution', severity: 'critical', languages: ['node', 'nodejs', 'javascript'] },

  // ── File system attacks ──
  { pattern: /\bos\.remove\b.*\//i, reason: 'Eliminación de archivos del sistema', severity: 'high', languages: ['python', 'python3'] },
  { pattern: /\bshutil\.rmtree\b.*['"]\/['"]|shutil\.rmtree\s*\(\s*['"]\/['"]/i, reason: 'Eliminación recursiva del directorio raíz', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bfs\.(rm|unlink)Sync\b.*['"]\//i, reason: 'Eliminación de archivos del sistema', severity: 'high', languages: ['node', 'nodejs', 'javascript'] },

  // ── Eval / dynamic execution (code injection) ──
  { pattern: /\beval\s*\(\s*(input|raw_input)\s*\(/i, reason: 'eval() con entrada de usuario (inyección de código)', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bexec\s*\(\s*(input|raw_input)\s*\(/i, reason: 'exec() con entrada de usuario (inyección de código)', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\b__import__\s*\(\s*['"]ctypes['"]\s*\)/i, reason: 'Importación de ctypes (acceso directo a memoria)', severity: 'high', languages: ['python', 'python3'] },

  // ── Credential theft ──
  { pattern: /open\s*\(.*\/(etc\/shadow|etc\/passwd|\.ssh\/|\.aws\/credentials|\.env)['"].*\)/i, reason: 'Lectura de archivos de credenciales', severity: 'critical' },
  { pattern: /readFileSync\s*\(.*\/(etc\/shadow|\.ssh\/|\.aws\/credentials)['"].*\)/i, reason: 'Lectura de archivos de credenciales', severity: 'critical', languages: ['node', 'nodejs', 'javascript'] },

  // ── KeyLogger / screen capture ──
  { pattern: /\bpynput\b.*\bKeyboard\b|\bkeyboard\b.*\bhook\b/i, reason: 'Posible keylogger detectado', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bImageGrab\b.*\bgrab\b/i, reason: 'Posible captura de pantalla', severity: 'high', languages: ['python', 'python3'] },

  // ── Data exfiltration via HTTP ──
  { pattern: /\brequests\.(post|put)\b.*\b(environ|open|read)\b/i, reason: 'Posible exfiltración de datos via HTTP', severity: 'critical', languages: ['python', 'python3'] },
  { pattern: /\bfetch\b.*\b(process\.env|readFileSync)\b/i, reason: 'Posible exfiltración de datos via fetch', severity: 'critical', languages: ['node', 'nodejs', 'javascript'] },

  // ── Infinite resource consumption ──
  { pattern: /\bwhile\s+(True|true|1)\s*:?\s*$/m, reason: 'Bucle infinito sin condición de salida visible', severity: 'high' },
  { pattern: /\bfork\s*\(\s*\)/i, reason: 'Fork de proceso (posible fork bomb)', severity: 'critical' },
];

// ---------------------------------------------------------------------------
// Sensitive Environment Variables — stripped from child processes
// ---------------------------------------------------------------------------

const SENSITIVE_ENV_PREFIXES = [
  'OPENAI_', 'ANTHROPIC_', 'GROQ_', 'GOOGLE_AI_', 'OPENROUTER_',
  'TELEGRAM_', 'AWS_', 'AZURE_', 'GCP_', 'GITHUB_TOKEN',
  'NPM_TOKEN', 'DOCKER_', 'DATABASE_', 'DB_', 'MONGO', 'REDIS_',
  'SMTP_', 'MAIL_', 'JWT_', 'SESSION_SECRET', 'ENCRYPTION_',
  'STRIPE_', 'PAYPAL_', 'TWILIO_', 'SENDGRID_',
  'ICLOUD_', 'GMAIL_', 'OAUTH_', 'CLIENT_SECRET',
  'PRIVATE_KEY', 'SECRET_KEY', 'API_KEY', 'ACCESS_TOKEN',
  'REFRESH_TOKEN', 'AUTH_', 'COOKIE_SECRET',
];

const SENSITIVE_ENV_EXACT = [
  'PASSWORD', 'PASSWD', 'PASS', 'SECRET', 'TOKEN', 'KEY',
  'CREDENTIALS', 'CERT', 'CERTIFICATE',
];

// ---------------------------------------------------------------------------
// Restricted Paths — cannot be used as working directories
// ---------------------------------------------------------------------------

const RESTRICTED_PATHS_UNIX = [
  '/etc', '/boot', '/sbin', '/usr/sbin', '/proc', '/sys',
  '/dev', '/root', '/var/log', '/var/run',
];

const RESTRICTED_PATHS_WIN = [
  'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
  'C:\\Program Files', 'C:\\ProgramData',
];

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
  blockedUntil: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxExecutionsPerMinute: 10,
  maxExecutionsPerHour: 60,
  cooldownAfterBlockMs: 60000, // 1 minute cooldown after being blocked
};

// ---------------------------------------------------------------------------
// Audit Log (file-based)
// ---------------------------------------------------------------------------

const AUDIT_LOG_DIR = (process.env.OPTIMAIZER_AUDIT_LOG_DIR || '').trim()
  ? path.resolve(process.env.OPTIMAIZER_AUDIT_LOG_DIR as string)
  : path.join(process.cwd(), 'data', 'audit');
const MAX_AUDIT_ENTRIES_PER_FILE = 1000;

function ensureAuditDir(): void {
  try {
    if (!fs.existsSync(AUDIT_LOG_DIR)) {
      fs.mkdirSync(AUDIT_LOG_DIR, { recursive: true });
    }
  } catch {
    // Best effort — directory creation may fail in some environments
  }
}

function getAuditLogPath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(AUDIT_LOG_DIR, `exec-audit-${date}.jsonl`);
}

/**
 * Write an audit log entry.
 * Uses JSONL (one JSON object per line) for efficient append-only writing.
 */
export function writeAuditLog(entry: AuditLogEntry): void {
  try {
    ensureAuditDir();
    const logPath = getAuditLogPath();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf-8');
  } catch (err) {
    console.error('[Security] Failed to write audit log:', err);
  }
}

/**
 * Read recent audit log entries (from today's file).
 */
export function readRecentAuditLogs(limit = 50): AuditLogEntry[] {
  try {
    const logPath = getAuditLogPath();
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean) as AuditLogEntry[];
    return entries.slice(-limit);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Core Security Functions
// ---------------------------------------------------------------------------

/**
 * Validate a terminal command against security rules.
 * Returns allowed:false with a reason if the command is blocked.
 */
export function validateCommand(command: string): SecurityValidationResult {
  if (!command || typeof command !== 'string') {
    return { allowed: false, reason: 'Comando vacío o inválido', severity: 'medium' };
  }

  const trimmed = command.trim();

  // Check against blocked patterns
  for (const { pattern, reason, severity } of BLOCKED_COMMAND_PATTERNS) {
    // Reset lastIndex for regexes with global flag
    pattern.lastIndex = 0;
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: `🚫 Comando bloqueado: ${reason}`,
        severity,
        matchedPattern: pattern.source,
      };
    }
  }

  // Check for multiple chained commands that try to bypass detection
  // e.g., "echo a; rm -rf /" or "echo a && rm -rf /"
  const segments = splitCommandChain(trimmed);
  for (const segment of segments) {
    for (const { pattern, reason, severity } of BLOCKED_COMMAND_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(segment.trim())) {
        return {
          allowed: false,
          reason: `🚫 Comando bloqueado (subcomando): ${reason}`,
          severity,
          matchedPattern: pattern.source,
        };
      }
    }
  }

  // Check for base64 encoded payloads (potential obfuscation)
  if (/\bbase64\s+-d\b|\bbase64\s+--decode\b/i.test(trimmed) && /\|\s*(ba)?sh\b/i.test(trimmed)) {
    return {
      allowed: false,
      reason: '🚫 Comando bloqueado: ejecución de payload codificado en base64',
      severity: 'critical',
      matchedPattern: 'base64 decode piped to shell',
    };
  }

  // Check for environment variable expansion to bypass (e.g., $'\x72\x6d' for 'rm')
  if (/\$'\\x[0-9a-fA-F]{2}/i.test(trimmed)) {
    return {
      allowed: false,
      reason: '🚫 Comando bloqueado: uso de secuencias de escape hexadecimales sospechosas',
      severity: 'high',
      matchedPattern: 'hex escape sequence',
    };
  }

  return { allowed: true };
}

/**
 * Get risk warnings for commands that aren't blocked but are potentially dangerous.
 */
export function getCommandRiskWarnings(command: string): string[] {
  const warnings: string[] = [];
  const trimmed = command.trim();

  for (const { pattern, reason } of HIGH_RISK_COMMAND_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(trimmed)) {
      warnings.push(reason);
    }
  }

  return warnings;
}

/**
 * Validate code before execution.
 */
export function validateCode(code: string, language: string): SecurityValidationResult {
  if (!code || typeof code !== 'string') {
    return { allowed: false, reason: 'Código vacío o inválido', severity: 'medium' };
  }

  const normalizedLang = language.toLowerCase().trim();

  for (const { pattern, reason, severity, languages } of BLOCKED_CODE_PATTERNS) {
    // If languages is specified, only check for matching languages
    if (languages && !languages.includes(normalizedLang)) continue;

    pattern.lastIndex = 0;
    if (pattern.test(code)) {
      return {
        allowed: false,
        reason: `🚫 Código bloqueado: ${reason}`,
        severity,
        matchedPattern: pattern.source,
      };
    }
  }

  // Check for embedded shell commands in code
  const shellExecPatterns = [
    /os\.system\s*\(\s*['"].*\brm\s+-rf\b/i,
    /os\.system\s*\(\s*['"].*\b(curl|wget)\b.*\|\s*(ba)?sh/i,
    /subprocess\.(call|run|Popen)\s*\(\s*\[?\s*['"].*\b(rm\s+-rf|curl.*\|\s*sh)\b/i,
    /child_process.*exec.*\b(rm\s+-rf|curl.*\|\s*sh)\b/i,
  ];

  for (const pattern of shellExecPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(code)) {
      return {
        allowed: false,
        reason: '🚫 Código bloqueado: ejecución de comandos shell peligrosos desde código',
        severity: 'critical',
        matchedPattern: pattern.source,
      };
    }
  }

  // Check code size (prevent absurdly large code blocks)
  if (code.length > 100_000) {
    return {
      allowed: false,
      reason: '🚫 Código bloqueado: tamaño excesivo (máximo 100KB)',
      severity: 'medium',
    };
  }

  return { allowed: true };
}

/**
 * Validate and sanitize working directory path.
 */
export function validateWorkingDirectory(dir: string | undefined): SecurityValidationResult {
  if (!dir) return { allowed: true }; // Default to home dir is fine

  const resolved = path.resolve(dir);

  // Check for path traversal attempts
  if (dir.includes('..')) {
    // Resolve and check if it escapes to a restricted path
    const restricted = getRestrictedPaths();
    for (const rp of restricted) {
      if (resolved.startsWith(rp)) {
        return {
          allowed: false,
          reason: `🚫 Directorio bloqueado: "${resolved}" es una ruta restringida del sistema`,
          severity: 'high',
        };
      }
    }
  }

  // Check against restricted paths
  const restricted = getRestrictedPaths();
  for (const rp of restricted) {
    if (resolved === rp || resolved.startsWith(rp + path.sep)) {
      return {
        allowed: false,
        reason: `🚫 Directorio bloqueado: "${resolved}" es una ruta restringida del sistema`,
        severity: 'high',
      };
    }
  }

  // Check if path exists and is a directory
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return {
        allowed: false,
        reason: `La ruta "${resolved}" no es un directorio`,
        severity: 'low',
      };
    }
  } catch {
    return {
      allowed: false,
      reason: `El directorio "${resolved}" no existe o no es accesible`,
      severity: 'low',
    };
  }

  return { allowed: true };
}

/**
 * Create a sanitized environment object for child processes.
 * Strips sensitive environment variables that could leak secrets.
 */
export function sanitizeEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;

    const upperKey = key.toUpperCase();

    // Check exact matches
    if (SENSITIVE_ENV_EXACT.includes(upperKey)) continue;

    // Check prefix matches
    let isSensitive = false;
    for (const prefix of SENSITIVE_ENV_PREFIXES) {
      if (upperKey.startsWith(prefix.toUpperCase())) {
        isSensitive = true;
        break;
      }
    }

    if (!isSensitive) {
      env[key] = value;
    }
  }

  // Always include essential env vars
  env['LANG'] = 'en_US.UTF-8';
  env['TERM'] = process.env.TERM || 'xterm-256color';
  env['PATH'] = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
  env['HOME'] = process.env.HOME || os.homedir();
  env['USER'] = process.env.USER || os.userInfo().username;

  return env;
}

/**
 * Generate a secure temporary file path.
 * Uses crypto random bytes to prevent prediction attacks.
 */
export function secureTemporaryFilePath(extension: string): string {
  const randomName = crypto.randomBytes(16).toString('hex');
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, `optimaizer_exec_${randomName}${extension}`);
}

/**
 * Check rate limit for an agent's execution requests.
 */
export function checkRateLimit(
  agentId: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): SecurityValidationResult {
  const now = Date.now();
  let entry = rateLimitStore.get(agentId);

  if (!entry) {
    entry = { timestamps: [], blockedUntil: 0 };
    rateLimitStore.set(agentId, entry);
  }

  // Check if currently in cooldown
  if (entry.blockedUntil > now) {
    const remainingSec = Math.ceil((entry.blockedUntil - now) / 1000);
    return {
      allowed: false,
      reason: `🚫 Rate limit activo: espera ${remainingSec}s antes de ejecutar otro comando`,
      severity: 'medium',
    };
  }

  // Clean old timestamps
  const oneHourAgo = now - 3600000;
  entry.timestamps = entry.timestamps.filter(t => t > oneHourAgo);

  // Check per-minute limit
  const oneMinuteAgo = now - 60000;
  const recentCount = entry.timestamps.filter(t => t > oneMinuteAgo).length;
  if (recentCount >= config.maxExecutionsPerMinute) {
    entry.blockedUntil = now + config.cooldownAfterBlockMs;
    return {
      allowed: false,
      reason: `🚫 Rate limit: se han alcanzado las ${config.maxExecutionsPerMinute} ejecuciones por minuto. Espera 1 minuto.`,
      severity: 'medium',
    };
  }

  // Check per-hour limit
  if (entry.timestamps.length >= config.maxExecutionsPerHour) {
    entry.blockedUntil = now + config.cooldownAfterBlockMs * 5;
    return {
      allowed: false,
      reason: `🚫 Rate limit: se han alcanzado las ${config.maxExecutionsPerHour} ejecuciones por hora.`,
      severity: 'medium',
    };
  }

  // Record this execution
  entry.timestamps.push(now);
  return { allowed: true };
}

/**
 * Create a comprehensive audit log entry.
 */
export function createAuditEntry(params: {
  agentId: string;
  userId: string;
  type: 'terminal' | 'code';
  command?: string;
  code?: string;
  language?: string;
  reason: string;
  approved: boolean;
  blocked: boolean;
  blockReason?: string;
  workingDirectory?: string;
}): AuditLogEntry {
  return {
    id: `audit-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    timestamp: Date.now(),
    ...params,
  };
}

/**
 * Sanitize command arguments for safe construction.
 * Prevents command injection through crafted filenames or parameters.
 */
export function sanitizeCommandArg(arg: string): string {
  // Remove null bytes
  let sanitized = arg.replace(/\0/g, '');

  // On Unix, use single quotes and escape any embedded single quotes
  if (process.platform !== 'win32') {
    sanitized = `'${sanitized.replace(/'/g, "'\\''")}'`;
  } else {
    // On Windows, use double quotes and escape internal quotes
    sanitized = `"${sanitized.replace(/"/g, '\\"')}"`;
  }

  return sanitized;
}

// ---------------------------------------------------------------------------
// Utility Helpers
// ---------------------------------------------------------------------------

/**
 * Split a command string by shell operators (;, &&, ||, |)
 * to detect dangerous subcommands.
 */
function splitCommandChain(command: string): string[] {
  // Simplified split — doesn't handle all quoting cases but catches common bypass attempts
  return command.split(/\s*(?:;|&&|\|\||`)\s*/);
}

function getRestrictedPaths(): string[] {
  return process.platform === 'win32' ? RESTRICTED_PATHS_WIN : RESTRICTED_PATHS_UNIX;
}

/**
 * Full pre-execution security check.
 * Runs all validations and returns a single result.
 */
export function preExecutionCheck(params: {
  agentId: string;
  userId: string;
  type: 'terminal' | 'code';
  command?: string;
  code?: string;
  language?: string;
  reason: string;
  workingDirectory?: string;
}): { validation: SecurityValidationResult; riskWarnings: string[]; auditEntry: AuditLogEntry } {
  let validation: SecurityValidationResult;
  let riskWarnings: string[] = [];

  // Rate limit check
  const rateCheck = checkRateLimit(params.agentId);
  if (!rateCheck.allowed) {
    const auditEntry = createAuditEntry({
      ...params,
      approved: false,
      blocked: true,
      blockReason: rateCheck.reason,
    });
    writeAuditLog(auditEntry);
    return { validation: rateCheck, riskWarnings: [], auditEntry };
  }

  if (params.type === 'terminal') {
    validation = validateCommand(params.command || '');
    riskWarnings = getCommandRiskWarnings(params.command || '');

    if (validation.allowed && params.workingDirectory) {
      const dirCheck = validateWorkingDirectory(params.workingDirectory);
      if (!dirCheck.allowed) {
        validation = dirCheck;
      }
    }
  } else {
    validation = validateCode(params.code || '', params.language || 'python');
  }

  const auditEntry = createAuditEntry({
    ...params,
    approved: validation.allowed,
    blocked: !validation.allowed,
    blockReason: validation.reason,
  });

  // Write audit log regardless of outcome
  writeAuditLog(auditEntry);

  return { validation, riskWarnings, auditEntry };
}

/**
 * Update an audit entry after execution completes.
 */
export function updateAuditEntryResult(
  entryId: string,
  result: 'success' | 'error' | 'timeout',
  durationMs: number
): void {
  // Since we're using append-only JSONL, write an update record
  try {
    ensureAuditDir();
    const updateEntry = JSON.stringify({
      type: 'update',
      auditId: entryId,
      executionResult: result,
      durationMs,
      timestamp: Date.now(),
    }) + '\n';
    fs.appendFileSync(getAuditLogPath(), updateEntry, 'utf-8');
  } catch {
    // Best effort
  }
}
