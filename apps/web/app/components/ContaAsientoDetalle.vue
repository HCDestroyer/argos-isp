<script setup lang="ts">
/**
 * Detalle de un asiento en el panel lateral del libro (tablero ContaLibro): su número en el diario,
 * el documento de origen, los movimientos con «Cuadra», quién y cómo, el periodo y la partida, y
 * abajo «Revertir» (un asiento nunca se edita: se corrige con su espejo y un motivo). Si la API no
 * acepta revertirlo directo, dice por qué y lleva al documento.
 */
const props = defineProps<{
    asiento: Asiento
}>()

const emit = defineEmits<{
    cerrar: []
    revertido: [reverso: Asiento]
}>()

const { puede } = usePermisos()
const toast = useToast()
const revertirAbierto = ref(false)

const origen = computed(() => origenAsiento(props.asiento.origen_tipo))
const ruta = computed(() => rutaOrigen(props.asiento))
const totales = computed(() => totalesPartida(props.asiento.movimientos))
const numero = computed(() => numeroAsientoConta(props.asiento))
const puedeRevertir = computed(() => puede('libro.revertir_asiento'))

function revertir(motivo: string, clave: string) {
    return useLibro().revertir(props.asiento.id, motivo, clave)
}

function alRevertir(reverso: Asiento) {
    toast.add({ title: `Asiento ${numero.value} revertido`, description: `Asiento de reverso #${reverso.id}`, icon: 'i-lucide-undo-2', color: 'success' })
    emit('revertido', reverso)
}
</script>

<template>
    <div
        class="flex h-full min-h-0 flex-col"
        :data-asiento-detalle="asiento.id"
    >
        <div class="flex items-start gap-3 border-b border-(--ax-borde) p-4">
            <span class="pastilla-icono pastilla-tono tono-marca size-10 shrink-0 rounded-xl">
                <UIcon
                    :name="origen.icono"
                    class="size-5"
                />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-mono text-sm font-semibold text-highlighted">{{ numero }}</span>
                <span class="truncate text-xs text-muted">{{ asiento.diario ? `Diario ${asiento.diario}` : 'Sin diario' }} · {{ formatearFecha(asiento.fecha) }}</span>
            </div>
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
            <section class="flex flex-col gap-2">
                <h3 class="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                    Documento de origen
                </h3>
                <div class="flex items-center gap-3 rounded-xl border border-(--ax-borde) p-3">
                    <span class="pastilla-icono pastilla-tono tono-exito size-8 shrink-0 rounded-lg">
                        <UIcon
                            :name="origen.icono"
                            class="size-4"
                        />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                        <span class="text-sm font-semibold text-highlighted">{{ origen.etiqueta }}<template v-if="asiento.origen_id"> #{{ asiento.origen_id }}</template></span>
                        <span class="text-xs break-words text-muted">{{ asiento.descripcion }}</span>
                    </div>
                    <UButton
                        v-if="ruta"
                        label="Abrir"
                        trailing-icon="i-lucide-chevron-right"
                        :to="ruta"
                        color="primary"
                        variant="link"
                        size="sm"
                        class="shrink-0 px-0"
                    />
                </div>
                <UBadge
                    v-if="asiento.reversa_de"
                    :label="`Es el reverso del asiento #${asiento.reversa_de}`"
                    icon="i-lucide-undo-2"
                    color="warning"
                    variant="subtle"
                    class="self-start"
                />
                <UBadge
                    v-if="asiento.revertido_por"
                    :label="`Revertido por el asiento #${asiento.revertido_por}`"
                    icon="i-lucide-undo-2"
                    color="neutral"
                    variant="subtle"
                    class="self-start"
                />
            </section>

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
                        v-for="(mov, indice) in asiento.movimientos"
                        :key="indice"
                        class="grid grid-cols-[minmax(0,1fr)_6rem_6rem] items-center gap-2 border-t border-(--ax-borde) px-3 py-2 text-sm"
                    >
                        <span class="flex min-w-0 flex-col">
                            <span class="font-mono text-xs text-muted">{{ mov.cuenta_codigo }}</span>
                            <span class="break-words">{{ mov.cuenta_nombre }}<template v-if="mov.cliente_id"> · cliente {{ mov.cliente_id }}</template></span>
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
                    Quién y cómo
                </h3>
                <dl class="divide-y divide-(--ax-borde) text-sm">
                    <div class="flex justify-between gap-3 py-2">
                        <dt class="text-muted">
                            Registró
                        </dt>
                        <dd class="text-right font-medium text-highlighted">
                            {{ asiento.created_by ? `Usuario #${asiento.created_by}` : 'El sistema' }}
                        </dd>
                    </div>
                    <div class="flex justify-between gap-3 py-2">
                        <dt class="text-muted">
                            Registrado
                        </dt>
                        <dd class="text-right">
                            {{ formatearFechaHora(asiento.created_at) }}
                        </dd>
                    </div>
                    <div
                        v-if="asiento.fecha_documento"
                        class="flex justify-between gap-3 py-2"
                    >
                        <dt class="text-muted">
                            Fecha del documento
                        </dt>
                        <dd class="text-right">
                            {{ formatearFecha(asiento.fecha_documento) }} (su mes estaba cerrado)
                        </dd>
                    </div>
                    <div class="flex justify-between gap-3 py-2">
                        <dt class="text-muted">
                            Partida del Libro Diario
                        </dt>
                        <dd class="text-right text-muted">
                            {{ asiento.partida ?? 'se asigna al cerrar el mes' }}
                        </dd>
                    </div>
                </dl>
            </section>
        </div>

        <div class="flex items-center gap-3 border-t border-(--ax-borde) p-4">
            <p class="min-w-0 flex-1 text-xs text-muted">
                <template v-if="asiento.revertible || !asiento.motivo_no_revertible">
                    Un asiento nunca se edita. Para corregirlo se hace su espejo, con motivo.
                </template>
                <template v-else>
                    No se revierte aquí: {{ asiento.motivo_no_revertible }}
                </template>
            </p>
            <UButton
                v-if="puedeRevertir && asiento.revertible"
                label="Revertir"
                icon="i-lucide-undo-2"
                color="error"
                variant="outline"
                class="shrink-0 rounded-full"
                :data-prueba="`revertir-asiento-${asiento.id}`"
                @click="revertirAbierto = true"
            />
            <UButton
                v-else-if="ruta && !asiento.revertible"
                label="Ir al documento"
                :to="ruta"
                color="neutral"
                variant="outline"
                class="shrink-0 rounded-full"
            />
        </div>

        <AccionMotivoModal
            v-if="puedeRevertir && asiento.revertible"
            v-model:open="revertirAbierto"
            titulo="Revertir asiento"
            :descripcion="`${numero} · ${asiento.descripcion}`"
            efecto="Se registra un asiento espejo (debe ↔ haber) con fecha de hoy. El original no se modifica y no se puede revertir dos veces."
            confirmar="Revertir asiento"
            icono="i-lucide-undo-2"
            color="warning"
            :ejecutar="revertir"
            @hecho="alRevertir"
        />
    </div>
</template>
