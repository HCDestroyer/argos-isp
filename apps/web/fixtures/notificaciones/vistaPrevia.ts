import type { Schema } from '@argosisp/contracts'
import { bd } from '../bd'

type Evento = Schema<'EventoNotificacion'>
type Valor = string | number | boolean

/** Valores de ejemplo del evento con su tipo (`GET /notificaciones/eventos`). */
function ejemplos(evento: Evento): Map<string, Valor> {
    const valores = new Map<string, Valor>()
    for (const grupo of evento.variables) {
        for (const variable of grupo.variables) {
            const valor = variable.tipo === 'booleano' ? variable.ejemplo === 'true' : variable.tipo === 'numero' ? Number(variable.ejemplo) : variable.ejemplo
            valores.set(variable.nombre, valor)
        }
    }
    return valores
}

function verdadero(valor: Valor | undefined): boolean {
    return valor !== undefined && valor !== false && valor !== '' && valor !== 0
}

/**
 * Mustache mínimo como `renderizar` de A6 (sin escape): variables, secciones `{{#x}}…{{/x}}` e
 * invertidas `{{^x}}…{{/x}}`. Dentro de una sección, un nombre también se busca bajo ella. Lo que
 * el evento no trae se pinta vacío y se anota en `desconocidas`.
 */
function renderizar(texto: string, valores: Map<string, Valor>, desconocidas: Set<string>, secciones: string[] = []): string {
    const buscar = (nombre: string): Valor | undefined => {
        for (const seccion of [...secciones].reverse()) {
            const valor = valores.get(`${seccion}.${nombre}`)
            if (valor !== undefined) {
                return valor
            }
        }
        const valor = valores.get(nombre)
        if (valor === undefined && nombre !== '.') {
            desconocidas.add(nombre)
        }
        return valor
    }
    const conSecciones = texto.replace(/\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/g, (_todo, tipo: string, nombre: string, dentro: string) => {
        const activo = verdadero(buscar(nombre))
        return (tipo === '#') === activo ? renderizar(dentro, valores, desconocidas, [...secciones, nombre]) : ''
    })
    return conSecciones.replace(/\{\{\{?\s*([\w.]+)\s*\}?\}\}/g, (_todo, nombre: string) => {
        const valor = buscar(nombre)
        return valor === undefined ? '' : String(valor)
    })
}

/** `POST /notificaciones/plantillas/vista-previa`, con los ejemplos del catálogo de eventos. */
export function vistaPrevia(entrada: { evento: string, canal: Schema<'VistaPreviaPlantilla'>['canal'], asunto: string | null, cuerpo: string }): Schema<'VistaPreviaPlantilla'> | null {
    const evento = bd.eventosNotificacion.find(e => e.evento === entrada.evento)
    if (!evento) {
        return null
    }
    const valores = ejemplos(evento)
    const desconocidas = new Set<string>()
    const asunto = entrada.asunto ? renderizar(entrada.asunto, valores, desconocidas).trim() : null
    const cuerpo = renderizar(entrada.cuerpo, valores, desconocidas).trim()
    const mensaje = entrada.canal === 'telegram' ? (asunto ? `${asunto}\n\n${cuerpo}` : cuerpo).slice(0, 4096) : cuerpo
    return { evento: entrada.evento, canal: entrada.canal, asunto, cuerpo, mensaje, variables_desconocidas: [...desconocidas].sort() }
}
