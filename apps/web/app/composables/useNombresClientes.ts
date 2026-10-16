/**
 * Nombres de clientes para listas cuyas filas solo traen `cliente_id` (facturas, pagos,
 * promesas). Pide `GET /clientes/:id` una vez por id y lo guarda para toda la sesión.
 * Pedido a A3: `cliente_nombre` en `Factura`, `Pago` y `Promesa` para no hacer estas llamadas.
 * Si un cliente no se pudo leer se muestra "Cliente #id", nunca un nombre inventado.
 */
export function useNombresClientes() {
    const nombres = useState<Record<number, string>>('nombres-clientes', () => ({}))
    const pendientes = new Set<number>()

    async function cargar(ids: readonly number[]): Promise<void> {
        const faltan = [...new Set(ids)].filter(id => !(id in nombres.value) && !pendientes.has(id))
        if (!faltan.length) {
            return
        }
        faltan.forEach(id => pendientes.add(id))
        const clientes = useClientes()
        // De 5 en 5 para no saturar la API con una página de 25 filas.
        for (let i = 0; i < faltan.length; i += 5) {
            const lote = faltan.slice(i, i + 5)
            const resultados = await Promise.all(lote.map(id => clientes.ver(id)))
            const nuevos: Record<number, string> = {}
            resultados.forEach((resultado, indice) => {
                const id = lote[indice]
                if (resultado.ok && id !== undefined) {
                    nuevos[id] = resultado.data.nombre
                }
            })
            nombres.value = { ...nombres.value, ...nuevos }
        }
        faltan.forEach(id => pendientes.delete(id))
    }

    function nombre(id: number): string {
        return nombres.value[id] ?? `Cliente #${id}`
    }

    /** Guarda un nombre ya conocido (el cliente elegido en un filtro). */
    function recordar(id: number, valor: string): void {
        if (nombres.value[id] !== valor) {
            nombres.value = { ...nombres.value, [id]: valor }
        }
    }

    return { cargar, nombre, recordar }
}
