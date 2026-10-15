# ArgosIsp — Plan para Claude Code

Todo el material de coordinación vive en `.claude/` del monorepo `argosisp`.

| Archivo | Quién lo lee | Para qué |
| --- | --- | --- |
| `.claude/CLAUDE.md` | Todos los agentes, siempre | Reglas de arquitectura y Definition of Done. Claude Code lo carga solo. |
| `.claude/PLAN.md` | Líderes y PM | Equipo, calendario de 5 semanas, día a día de la semana 1, criterios |
| `.claude/modelo-datos.md` | Líder BE (día 1) y todos | Tablas base por schema |
| `.claude/agents/a1-nucleo.md` … `a6-infra.md` | Cada agente, el suyo | Definición del agente de Claude Code: tareas en orden, interfaces, criterios, prohibiciones |
| `.claude/INTEGRATION.md` | Todos | Peticiones entre agentes |
| `.claude/STATUS.md` | Líderes | Hecho / bloqueado / siguiente por agente y día |

## Agentes

| Agente | Rama | Líder |
| --- | --- | --- |
| `a1-nucleo` | `agente/a1-nucleo` | Backend |
| `a2-radius` | `agente/a2-radius` | Backend |
| `a3-facturacion` | `agente/a3-facturacion` | Backend |
| `a4-panel` | `agente/a4-panel` | Frontend |
| `a5-portal` | `agente/a5-portal` | Frontend |
| `a6-infra` | `agente/a6-infra` | PM |

## Cómo arrancar un agente

En una terminal por agente, en su rama, se lanza Claude Code con ese agente como sesión principal:

```
git checkout -b agente/a1-nucleo
claude --agent a1-nucleo
```

Primer mensaje al agente:

> Empieza por la tarea 1 de tu brief.

El agente ya trae en su definición la instrucción de leer `.claude/CLAUDE.md`, `.claude/PLAN.md` y `.claude/modelo-datos.md`, trabajar en orden con una PR por tarea y anotar dependencias en `.claude/INTEGRATION.md`. Cambia el nombre del agente y la rama para A2 a A6.

Desde cualquier otra sesión también se pueden invocar como subagentes (`/agents` los lista).
