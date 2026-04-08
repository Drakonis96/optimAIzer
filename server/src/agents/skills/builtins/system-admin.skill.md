---
id: system-admin
name: "Administración del Sistema"
description: "Administración del sistema operativo: gestión de archivos, procesos, servicios, red y monitorización del sistema"
version: "1.0.0"
author: "optimAIzer"
enabled: true
priority: 65
tags: ["sistema", "terminal", "admin", "sysadmin", "archivos", "procesos"]
category: "developer"
triggers:
  events:
    - "keyword:terminal"
    - "keyword:comando"
    - "keyword:archivo"
    - "keyword:carpeta"
    - "keyword:disco"
    - "keyword:proceso"
    - "keyword:servicio"
    - "keyword:instalar"
    - "keyword:sistema"
    - "keyword:red"
  conditions: "Cuando el usuario pida gestión del sistema operativo"
requires_tools:
  - run_terminal_command
  - execute_code
---

# Administración del Sistema — Protocolo

## ⚠️ Requisito previo
Esta skill solo funciona si el agente tiene permisos de:
- `terminalAccess: true` (para comandos de terminal)
- `codeExecution: true` (para scripts)

Cada comando/ejecución REQUIERE aprobación del usuario via Telegram.

## Capacidades por área

### 📂 Gestión de archivos
- Listar, buscar, copiar, mover, renombrar archivos
- Comprobar espacio en disco
- Encontrar archivos grandes
- Comprimir/descomprimir
```
Comandos ejemplo:
- ls -la [ruta]
- find / -name "*.log" -size +100M
- du -sh [directorio]
- df -h
- tar -czf backup.tar.gz [directorio]
```

### 🔄 Gestión de procesos
- Listar procesos activos
- Uso de CPU y memoria
- Matar procesos problemáticos
```
- ps aux | grep [nombre]
- top -l 1 -n 10
- kill [PID]
- htop (si disponible)
```

### 🌐 Red
- Comprobar conectividad
- Ver puertos abiertos
- Resolver DNS
- Diagnóstico de red
```
- ping -c 3 [host]
- netstat -an | grep LISTEN
- curl -I [url]
- dig [dominio]
- traceroute [host]
```

### ⚙️ Servicios
- Estado de servicios (systemd/launchd)
- Reiniciar servicios
- Ver logs
```
- systemctl status [servicio]
- journalctl -u [servicio] --since "1 hour ago"
- launchctl list | grep [nombre]  (macOS)
```

### 📊 Monitorización
- Uso de CPU/RAM/Disco
- Uptime del sistema
- Temperatura (si disponible)
```
- uptime
- free -h  (Linux)
- vm_stat  (macOS)
- sensors  (Linux, si disponible)
```

## Protocolo de seguridad

### SIEMPRE antes de ejecutar:
1. Explicar claramente QUÉ va a hacer el comando.
2. Explicar POR QUÉ es necesario.
3. Indicar si tiene riesgos o efectos secundarios.
4. Esperar aprobación del usuario.

### NUNCA ejecutar sin preguntar:
- `rm -rf` en directorios críticos
- Cambios de permisos en archivos del sistema
- Modificación de configs de servicios críticos
- Instalación de software no solicitado
- Comandos que expongan credenciales

### Para tareas complejas:
1. Dividir en pasos pequeños.
2. Pedir aprobación para cada paso.
3. Verificar resultado antes de continuar.
4. Si algo falla, NO reintentar automáticamente — informar y preguntar.

## Flujo de trabajo

### Comando simple
1. Entender qué necesita el usuario.
2. Proponer el comando exacto con explicación.
3. Ejecutar con `run_terminal_command` tras aprobación.
4. Mostrar resultado formateado.

### Script/Automatización
1. Escribir el script completo.
2. Explicar cada sección.
3. Ejecutar con `execute_code` tras aprobación.
4. Mostrar resultado y errores si los hay.

## Reglas
- Adaptar comandos al SO detectado (macOS/Linux/Windows).
- Preferir comandos seguros y reversibles.
- Para operaciones destructivas, crear backup primero (si es posible).
- No guardar outputs con información sensible en notas.
- Si el usuario no tiene permisos suficientes, explicar cómo obtenerlos (sudo, etc.).
