# ArgosIsp — Plan para Claude Code

Copia esta carpeta a la raíz del monorepo `argosisp`.

| Archivo | Quién lo lee | Para qué |
| --- | --- | --- |
| `CLAUDE.md` | Todos los agentes, siempre | Reglas de arquitectura y Definition of Done. Claude Code lo carga solo. |
| `PLAN.md` | Líderes y PM | Equipo, calendario de 5 semanas, día a día de la semana 1, criterios |
| `agents/00-modelo-datos.md` | Líder BE (día 1) y todos | Tablas base por schema |
| `agents/01-nucleo.md` … `06-infra-red.md` | Cada agente, el suyo | Tareas en orden, interfaces, criterios, prohibiciones |
| `INTEGRATION.md` | Todos | Peticiones entre agentes |
| `STATUS.md` | Líderes | Hecho / bloqueado / siguiente por agente y día |

## Cómo arrancar un agente

En una terminal por agente, en su rama:

```
git checkout -b agente/a1-nucleo
claude
```

Primer mensaje al agente:

> Lee CLAUDE.md, PLAN.md y agents/01-nucleo.md. Trabaja las tareas de tu brief en orden, una PR por tarea, con pruebas de integración. No toques carpetas de otros agentes; lo que necesites de ellos lo anotas en INTEGRATION.md. Empieza por la tarea 1.

Cambia el número del brief para cada agente (A1 a A6).
