# Integración entre agentes

Reemplaza al antiguo `.claude/INTEGRATION.md`. Un archivo por quien pide, para que dos PRs nunca editen el mismo archivo.

| Archivo | Lo escribe | Qué contiene |
| --- | --- | --- |
| `lideres.md` | Líder BE, Líder FE, PM | Pedidos y decisiones de los líderes |
| `a1.md` … `a6.md` | Ese agente | Lo que ese agente necesita de otros, o avisa a otros |
| `contratos/*.md` | Quien expone la interfaz | Contratos estables entre módulos (formatos, nombres, payloads) |

## Reglas

1. **Escribe solo en tu archivo.** Si necesitas algo de A1, agrega una fila en el tuyo con `A quién = A1`. Nunca edites el archivo de otro agente.
2. **Antes de empezar, lee las filas dirigidas a ti** en todos los archivos: `grep -n "| A1" .claude/integration/*.md` (cambia A1 por tu agente).
3. **Para responder o cerrar**, escribe en tu propio archivo (por ejemplo, "Hecho en tarea 9, ver `app/...`"). Quien pidió borra su fila cuando lo ve resuelto.
4. **Los contratos** cambian solo con acuerdo y en la misma PR que el código que los cumple.
5. Fila: `| Fecha | A quién | Qué | Estado |`. Estado: `Abierto`, `En curso (tarea N)`, `Hecho, falta verificar`.
