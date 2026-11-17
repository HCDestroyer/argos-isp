import type { EmpresaPublica } from './useEmpresa'

/** Lo que deja `server/middleware/responsable-politicas.ts` en `event.context.politicasEmpresa`. */
type EmpresaDelServidor = { ok: true, data: EmpresaPublica } | { ok: false, status: number }

/**
 * Empresa responsable de las páginas de políticas (`/privacidad`, `/terminos`, `/eliminar-datos`).
 *
 * A diferencia de `useEmpresa` (solo en el navegador), aquí la empresa llega ya en el HTML del
 * servidor: el revisor de Meta y su rastreador leen la página sin JavaScript. En el servidor se usa
 * lo que leyó el middleware con la IP de origen (nunca una llamada sin ella); al navegar dentro del
 * portal, la misma `GET /portal/empresa` del navegador.
 *
 * Qué empresa: con `?empresa=<id>`, esa; sin él, la que decide la API (la del servicio de la IP de
 * origen, si no la principal del cliente de la sesión, si no la principal de la instalación).
 */
export function usePoliticasEmpresa() {
    const route = useRoute()
    const api = useApi()
    const config = useRuntimeConfig().public
    // Se toma ahora: dentro del `await` de `useAsyncData` ya no hay contexto de Nuxt.
    const evento = import.meta.server ? useRequestEvent() : undefined

    const empresaId = computed(() => {
        const valor = Number(route.query.empresa)
        return Number.isSafeInteger(valor) && valor > 0 ? valor : null
    })

    const consulta = useAsyncData<Resultado<EmpresaPublica>>(
        () => `politicas:empresa:${empresaId.value ?? 'portal'}`,
        async () => {
            const delServidor = evento?.context.politicasEmpresa as EmpresaDelServidor | undefined
            if (delServidor) {
                return delServidor.ok
                    ? { ok: true, data: delServidor.data }
                    : { ok: false, problema: aProblema(null, delServidor.status) }
            }
            if (import.meta.server && config.useFixtures !== true) {
                return { ok: false, problema: aProblema(null, 502) }
            }
            return resolver(api.GET('/api/v1/portal/empresa', {
                params: { query: empresaId.value === null ? {} : { empresa_id: empresaId.value } },
            }))
        },
    )

    const empresa = computed(() => consulta.data.value?.ok ? consulta.data.value.data : null)
    const problema = computed(() => consulta.data.value && !consulta.data.value.ok ? consulta.data.value.problema : null)
    const cargando = computed(() => consulta.status.value === 'idle' || consulta.status.value === 'pending')

    return { empresa, problema, cargando, recargar: consulta.refresh }
}
