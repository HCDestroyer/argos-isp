<script setup lang="ts">
import type { StepperItem } from '@nuxt/ui'

/**
 * Configuración › Importar datos › Mikrowisp (tablero OperConfigImportar; decisión 24 del PM):
 * pantalla con pasos (origen, qué traer, revisar e importar), vista previa con el cuadre de saldos
 * antes de guardar nada y la bitácora de corridas. Solo el admin.
 *
 * La importación hoy corre por la línea de comandos (`contratos/importacion.md`); su API para el
 * panel (subir el respaldo, vista previa, cuadre, ejecutar y corridas) todavía no existe. La
 * pantalla deja los pasos listos y dice qué falta, sin cifras inventadas; el pedido está en
 * `.claude/integration/a4.md`. El permiso propio también falta: mientras tanto, rol `admin`.
 */
definePageMeta({
    middleware: [
        () => {
            const usuario = useUsuarioActual()
            if (!usuario.value?.roles?.includes('admin')) {
                return navigateTo({ path: '/sin-permiso', query: { permiso: 'rol admin', ruta: '/configuracion/importar' } }, { replace: true })
            }
        },
    ],
})

useHead({ title: 'Importar desde Mikrowisp · ArgosIsp' })

const paso = ref(0)

const pasos: StepperItem[] = [
    { title: 'Origen', description: 'El respaldo de Mikrowisp', icon: 'i-lucide-database' },
    { title: 'Qué traer', description: 'Clientes, servicios, planes, facturas…', icon: 'i-lucide-list-checks' },
    { title: 'Revisar', description: 'Vista previa y cuadre de saldos', icon: 'i-lucide-scan-search' },
    { title: 'Importar', description: 'Se guarda y queda en la bitácora', icon: 'i-lucide-upload' },
]

const QUE_TRAE = [
    { etiqueta: 'Clientes', detalle: 'Con su teléfono y su documento; los incompletos se marcan para revisar.', icono: 'i-lucide-users' },
    { etiqueta: 'Servicios', detalle: 'Con el plan equivalente en Argos y sus credenciales PPPoE.', icono: 'i-lucide-wifi' },
    { etiqueta: 'Planes', detalle: 'Los que ya existen en Argos no se duplican.', icono: 'i-lucide-gauge' },
    { etiqueta: 'Facturas pendientes', detalle: 'Con su saldo, para que el siguiente corte decida con todo cargado.', icono: 'i-lucide-receipt' },
    { etiqueta: 'Pagos históricos', detalle: 'Los que no tienen factura quedan como saldo a favor.', icono: 'i-lucide-banknote' },
    { etiqueta: 'Promesas activas', detalle: 'Con su fecha de vencimiento.', icono: 'i-lucide-calendar-clock' },
]
</script>

<template>
    <ConfiguracionMarco
        id="configuracion-importar"
        titulo="Importar desde Mikrowisp"
        descripcion="Trae clientes, servicios, planes, facturas y pagos de tu sistema anterior, con revisión antes de guardar"
        sin-tarjeta
    >
        <template #acciones>
            <UButton
                label="Corridas anteriores"
                icon="i-lucide-history"
                color="neutral"
                variant="outline"
                disabled
                title="La bitácora de corridas estará disponible en una próxima versión."
                data-prueba="corridas-importacion"
            />
        </template>

        <section class="surface-card rounded-2xl px-4 py-3">
            <UStepper
                v-model="paso"
                :items="pasos"
                size="sm"
                orientation="horizontal"
                class="w-full"
                data-prueba="pasos-importacion"
            />
        </section>

        <div class="grid min-w-0 gap-3.5 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0">
                <div class="flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                    <template v-if="paso === 0">
                        <h2 class="text-base font-semibold text-highlighted">
                            De dónde vienen los datos
                        </h2>
                        <p class="text-sm text-muted">
                            Sube el respaldo de la base de Mikrowisp (archivo .sql). Argos lo lee sin guardar nada hasta que confirmes en el último paso.
                        </p>
                        <UFileUpload
                            accept=".sql,.gz,.zip"
                            label="Arrastra el respaldo aquí"
                            description="Archivo .sql de Mikrowisp (o comprimido)"
                            icon="i-lucide-database"
                            disabled
                            class="w-full"
                            data-prueba="importar-archivo"
                        />
                    </template>
                    <template v-else-if="paso === 1">
                        <h2 class="text-base font-semibold text-highlighted">
                            Qué se trae
                        </h2>
                        <ul class="flex flex-col">
                            <li
                                v-for="item in QUE_TRAE"
                                :key="item.etiqueta"
                                class="flex items-start gap-3 border-b border-(--ax-borde) py-3 last:border-b-0"
                            >
                                <span class="pastilla-icono tono-marca pastilla-tono">
                                    <UIcon
                                        :name="item.icono"
                                        class="size-4"
                                    />
                                </span>
                                <span class="flex flex-col">
                                    <span class="text-sm font-semibold text-highlighted">{{ item.etiqueta }}</span>
                                    <span class="text-xs text-muted">{{ item.detalle }}</span>
                                </span>
                            </li>
                        </ul>
                    </template>
                    <template v-else-if="paso === 2">
                        <h2 class="text-base font-semibold text-highlighted">
                            Revisa antes de importar
                        </h2>
                        <p class="text-sm text-muted">
                            Aquí se verá cuánto hay en Mikrowisp y cuánto se importa de cada cosa, con su nota y su estado, y el cuadre: el saldo por cobrar en Mikrowisp contra el que quedará en Argos.
                        </p>
                    </template>
                    <template v-else>
                        <h2 class="text-base font-semibold text-highlighted">
                            Importar
                        </h2>
                        <p class="text-sm text-muted">
                            Puedes correrla otra vez: lo que ya entró no se duplica. No avisa a clientes ni corta a nadie; el siguiente corte decide con todo cargado.
                        </p>
                    </template>
                    <SeccionSinApi
                        titulo="La importación desde el panel todavía no está disponible"
                        descripcion="Por ahora la importación la corre el equipo técnico en el servidor. Cuando esté disponible aquí, podrás subir el respaldo, ver la vista previa con el cuadre, importar y revisar las corridas."
                        icono="i-lucide-construction"
                    />
                </div>
            </section>

            <aside class="surface-card flex min-w-0 flex-col rounded-2xl lg:min-h-0">
                <div class="flex items-center gap-2 border-b border-(--ax-borde) px-4 py-3">
                    <UIcon
                        name="i-lucide-triangle-alert"
                        class="size-5 text-muted"
                    />
                    <h2 class="text-base font-semibold text-highlighted">
                        Para atender
                    </h2>
                </div>
                <div class="flex flex-1 flex-col gap-3 p-4">
                    <p class="text-sm text-muted">
                        Lo que la vista previa encuentre (clientes sin teléfono o documento, saldos que no cuadran) aparece aquí con su acción.
                    </p>
                    <UAlert
                        color="primary"
                        variant="subtle"
                        icon="i-lucide-info"
                        description="Puedes correrla otra vez: lo que ya entró no se duplica. No avisa a clientes ni corta a nadie."
                    />
                </div>
                <div class="sticky bottom-0 flex items-center justify-between gap-2 rounded-b-2xl border-t border-(--ax-borde) bg-(--ax-tarjeta) px-4 py-3">
                    <UButton
                        label="Atrás"
                        :icon="ICONOS.volver"
                        color="neutral"
                        variant="ghost"
                        :disabled="paso === 0"
                        @click="paso -= 1"
                    />
                    <UButton
                        :label="paso === 3 ? 'Importar' : 'Siguiente'"
                        :trailing-icon="paso === 3 ? undefined : 'i-lucide-chevron-right'"
                        :icon="paso === 3 ? 'i-lucide-upload' : undefined"
                        class="glow-brand"
                        :disabled="paso === 3"
                        :title="paso === 3 ? 'La importación estará disponible en una próxima versión.' : undefined"
                        data-prueba="importar-siguiente"
                        @click="paso += 1"
                    />
                </div>
            </aside>
        </div>
    </ConfiguracionMarco>
</template>
