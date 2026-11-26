<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Detalle de un asiento por aprobar en el panel lateral (tablero ContaLibro): sus movimientos con
 * «Cuadra», quién lo creó y, abajo, «Aprobar y registrar» (`libro.aprobar_asiento`; quien lo creó
 * no puede, 403 `autoaprobacion`) y «Rechazar» con motivo (`libro.rechazar_asiento`). Al aprobar,
 * la API lo registra con su fecha; si el mes ya se cerró o una cuenta cambió, el error se muestra
 * aquí y el borrador sigue pendiente.
 */
const props = defineProps<{
    borrador: BorradorAsiento
    cuentas: Cuenta[]
}>()

const emit = defineEmits<{
    cerrar: []
    decidido: [borrador: BorradorAsiento]
}>()

const { puede } = usePermisos()
const usuario = useUsuarioActual()
const toast = useToast()
const nombres = useNombresClientes()
const rechazarAbierto = ref(false)
const aprobando = ref(false)
const problema = ref<Problem | null>(null)
let clave = nuevaClaveIdempotencia()

watch(() => props.borrador.id, () => {
    problema.value = null
    clave = nuevaClaveIdempotencia()
})

const pendiente = computed(() => props.borrador.estado === 'pendiente')
const esMio = computed(() => usuario.value?.id !== undefined && props.borrador.creado_por === usuario.value.id)
const puedeAprobar = computed(() => pendiente.value && puede('libro.aprobar_asiento') && !esMio.value)
const puedeRechazar = computed(() => pendiente.value && puede('libro.rechazar_asiento'))
const totales = computed(() => totalesPartida(props.borrador.movimientos.map(m => ({ debe: m.debe, haber: m.haber }))))

watchEffect(() => {
    void nombres.cargar(props.borrador.movimientos.flatMap(m => (m.cliente_id ? [m.cliente_id] : [])))
})

function cuentaDe(codigo: string): Cuenta | undefined {
    return props.cuentas.find(c => c.codigo === codigo)
}

async function aprobar() {
    aprobando.value = true
    problema.value = null
    const resultado = await useLibro().aprobarBorrador(props.borrador.id, clave)
    aprobando.value = false
    if (resultado.ok) {
        toast.add({ title: 'Asiento aprobado y registrado', description: resultado.data.asiento_id ? `Asiento #${resultado.data.asiento_id} en el libro` : undefined, icon: 'i-lucide-check', color: 'success' })
        emit('decidido', resultado.data)
        return
    }
    if (resultado.problema.status >= 400 && resultado.problema.status < 500) {
        clave = nuevaClaveIdempotencia()
    }
    problema.value = resultado.problema
}

function rechazar(motivo: string, claveMotivo: string) {
    return useLibro().rechazarBorrador(props.borrador.id, motivo, claveMotivo)
}

function alRechazar(borrador: BorradorAsiento) {
    toast.add({ title: esMio.value ? 'Borrador retirado' : 'Borrador rechazado', description: 'No tocó el libro. Quien lo creó verá el motivo.', icon: 'i-lucide-x', color: 'neutral' })
    emit('decidido', borrador)
}
</script>

<template>
    <div
        class="flex h-full min-h-0 flex-col"
        :data-borrador-detalle="borrador.id"
    >
        <div class="flex items-start gap-3 border-b border-(--ax-borde) p-4">
            <span class="pastilla-icono pastilla-tono tono-aviso size-10 shrink-0 rounded-xl">
                <UIcon
                    name="i-lucide-user-check"
                    class="size-5"
                />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-semibold text-highlighted">Borrador del {{ formatearFecha(borrador.created_at) }}</span>
                <span class="text-xs text-muted">{{ borrador.creado_por_nombre ?? 'El sistema' }}, {{ formatearFechaHora(borrador.created_at) }}</span>
            </div>
            <UBadge
                :label="borrador.estado === 'pendiente' ? 'Pendiente' : borrador.estado === 'aprobado' ? 'Aprobado' : 'Rechazado'"
                :color="borrador.estado === 'pendiente' ? 'warning' : borrador.estado === 'aprobado' ? 'success' : 'error'"
                variant="soft"
            />
            <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="sm"
                aria-label="Cerrar el detalle"
                @click="emit('cerrar')"
            />
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
            <p class="text-sm text-highlighted">
                {{ borrador.descripcion }}
            </p>

            <section class="flex flex-col gap-2">
                <h3 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    Movimientos
                </h3>
                <div class="overflow-hidden rounded-xl border border-(--ax-borde)">
                    <div class="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-2 bg-(--ax-panel) px-3 py-2 text-[0.6875rem] font-bold tracking-[0.05em] text-muted uppercase">
                        <span>Cuenta</span>
                        <span class="text-right">Debe</span>
                        <span class="text-right">Haber</span>
                    </div>
                    <div
                        v-for="(mov, indice) in borrador.movimientos"
                        :key="indice"
                        class="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-center gap-2 border-t border-(--ax-borde) px-3 py-2 text-sm"
                    >
                        <span class="flex min-w-0 flex-col">
                            <span class="font-mono text-xs text-muted">{{ mov.cuenta }}</span>
                            <span class="break-words">{{ cuentaDe(mov.cuenta)?.nombre ?? 'Cuenta' }}<template v-if="mov.cliente_id"> · {{ nombres.nombre(mov.cliente_id) }}</template><template v-if="mov.proveedor_id"> · proveedor {{ mov.proveedor_id }}</template></span>
                        </span>
                        <span class="text-right tabular-nums">{{ montoLado(mov.debe) }}</span>
                        <span class="text-right tabular-nums">{{ montoLado(mov.haber) }}</span>
                    </div>
                    <div class="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-center gap-2 border-t border-(--ax-borde) bg-(--ax-panel) px-3 py-2 text-sm font-semibold">
                        <span class="flex items-center gap-1">
                            {{ cuadra(totales) ? 'Cuadra' : 'No cuadra' }}
                            <UIcon
                                :name="cuadra(totales) ? 'i-lucide-check' : 'i-lucide-octagon-alert'"
                                :class="cuadra(totales) ? 'text-success' : 'text-error'"
                                class="size-4"
                            />
                        </span>
                        <span class="text-right tabular-nums">{{ formatearQuetzales(totales.debe).replace('Q ', '') }}</span>
                        <span class="text-right tabular-nums">{{ formatearQuetzales(totales.haber).replace('Q ', '') }}</span>
                    </div>
                </div>
            </section>

            <section class="flex flex-col gap-1">
                <h3 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    Fecha del asiento
                </h3>
                <p class="text-sm">
                    {{ borrador.fecha ? formatearFecha(borrador.fecha) : 'La de hoy, al aprobarlo' }}
                </p>
                <p
                    v-if="pendiente"
                    class="text-xs text-muted"
                >
                    Al aprobarlo se registra con su fecha. Si el mes ya se cerró o una cuenta cambió, verás el error y el borrador seguirá pendiente.
                </p>
            </section>

            <section
                v-if="borrador.estado === 'aprobado'"
                class="flex flex-col gap-1 text-sm"
            >
                <h3 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    Decisión
                </h3>
                <p>
                    Aprobado por {{ borrador.decidido_por_nombre ?? 'el sistema' }}<template v-if="borrador.decidido_en">
                        , {{ formatearFechaHora(borrador.decidido_en) }}
                    </template>.
                </p>
                <p v-if="borrador.asiento_id">
                    Quedó registrado como el asiento #{{ borrador.asiento_id }} del diario.
                </p>
            </section>
            <section
                v-else-if="borrador.estado === 'rechazado'"
                class="flex flex-col gap-1 text-sm"
            >
                <h3 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    Decisión
                </h3>
                <p>
                    Rechazado por {{ borrador.decidido_por_nombre ?? 'el sistema' }}<template v-if="borrador.decidido_en">
                        , {{ formatearFechaHora(borrador.decidido_en) }}
                    </template>: «{{ borrador.motivo_rechazo }}»
                </p>
            </section>

            <ProblemaAlerta
                v-if="problema"
                :problema="problema"
                data-prueba="borrador-error"
            />
        </div>

        <div
            v-if="pendiente"
            class="flex flex-wrap items-center gap-3 border-t border-(--ax-borde) p-4"
        >
            <p class="min-w-0 flex-1 text-xs text-muted">
                <template v-if="esMio">
                    Lo creaste tú: otra persona debe aprobarlo. Puedes retirarlo.
                </template>
                <template v-else>
                    Aprobarlo lo registra en el libro; rechazarlo no lo toca.
                </template>
            </p>
            <UButton
                v-if="puedeRechazar"
                :label="esMio ? 'Retirar' : 'Rechazar'"
                icon="i-lucide-x"
                color="error"
                variant="outline"
                class="shrink-0 rounded-full"
                :disabled="aprobando"
                data-prueba="borrador-rechazar"
                @click="rechazarAbierto = true"
            />
            <UButton
                v-if="puedeAprobar"
                label="Aprobar y registrar"
                icon="i-lucide-check"
                class="shrink-0 rounded-full"
                :loading="aprobando"
                data-prueba="borrador-aprobar"
                @click="aprobar"
            />
        </div>

        <AccionMotivoModal
            v-if="puedeRechazar"
            v-model:open="rechazarAbierto"
            :titulo="esMio ? 'Retirar el borrador' : 'Rechazar el borrador'"
            :descripcion="borrador.descripcion"
            efecto="No toca el libro. Quien lo creó verá el motivo y puede crear otro corregido."
            :confirmar="esMio ? 'Retirar' : 'Rechazar'"
            icono="i-lucide-x"
            placeholder="Ej.: falta la boleta del depósito"
            :ejecutar="rechazar"
            @hecho="alRechazar"
        />
    </div>
</template>
