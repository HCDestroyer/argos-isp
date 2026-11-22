<script setup lang="ts">
definePageMeta({ permiso: 'reportes.ver' })

useHead({ title: 'Reportes · ArgosIsp' })

/**
 * Índice de reportes agrupado por tema (sistema visual Argos: nada de listas largas sin agrupar).
 * Lealtad (A3) tiene su propia página, con el pasivo de los puntos contra el libro.
 */
interface TarjetaReporte {
    clave: string
    titulo: string
    descripcion: string
    icono: string
    to: string
}

const tarjeta = (clave: ClaveReporte): TarjetaReporte => ({ clave, ...REPORTES[clave], to: `/reportes/${clave}` })

const grupos: { id: string, etiqueta: string, descripcion: string, reportes: TarjetaReporte[] }[] = [
    {
        id: 'cobranza',
        etiqueta: 'Cobranza',
        descripcion: 'Lo que se debe y lo que entra cada día',
        reportes: (['cartera-vencida', 'cobranza-diaria', 'promesas', 'cierres-caja'] as const).map(tarjeta),
    },
    {
        id: 'facturacion',
        etiqueta: 'Facturación e impuestos',
        descripcion: 'Lo facturado, lo cobrado y su IVA',
        reportes: (['facturado-vs-cobrado', 'ingresos', 'iva', 'bonificaciones'] as const).map(tarjeta),
    },
    {
        id: 'clientes',
        etiqueta: 'Clientes',
        descripcion: 'Crecimiento y programa de puntos',
        reportes: [
            tarjeta('altas-bajas'),
            { clave: 'lealtad', titulo: 'Lealtad', descripcion: 'Puntos emitidos, canjeados y vencidos, y el pasivo de los puntos contra 2.1.10.', icono: 'i-lucide-gem', to: '/reportes/lealtad' },
        ],
    },
    {
        id: 'gastos',
        etiqueta: 'Gastos y proveedores',
        descripcion: 'Lo que sale y lo que se debe',
        reportes: (['egresos', 'cuentas-por-pagar'] as const).map(tarjeta),
    },
]

// Si se agrega un reporte a `CLAVES_REPORTE` y no a un grupo, sale en «Otros» (nunca se pierde).
const agrupados = new Set(grupos.flatMap(grupo => grupo.reportes.map(reporte => reporte.clave)))
const sueltos = CLAVES_REPORTE.filter(clave => !agrupados.has(clave)).map(tarjeta)
if (sueltos.length) {
    grupos.push({ id: 'otros', etiqueta: 'Otros', descripcion: 'Más reportes', reportes: sueltos })
}
</script>

<template>
    <PanelPagina
        id="reportes"
        titulo="Reportes"
        icono="i-lucide-file-chart-column"
    >
        <div class="flex flex-col gap-6">
            <p class="text-sm text-muted">
                Cada reporte se filtra, muestra sus totales y se descarga en CSV o Excel con los mismos filtros.
            </p>
            <section
                v-for="grupo in grupos"
                :key="grupo.id"
                class="flex flex-col gap-3"
                :aria-labelledby="`reportes-${grupo.id}`"
            >
                <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h2
                        :id="`reportes-${grupo.id}`"
                        class="text-xs font-bold tracking-[0.06em] text-highlighted uppercase"
                    >
                        {{ grupo.etiqueta }}
                    </h2>
                    <p class="text-xs text-muted">
                        {{ grupo.descripcion }}
                    </p>
                </div>
                <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    <TarjetaAcceso
                        v-for="reporte in grupo.reportes"
                        :key="reporte.clave"
                        :titulo="reporte.titulo"
                        :descripcion="reporte.descripcion"
                        :icono="reporte.icono"
                        :to="reporte.to"
                        :data-prueba="`reporte-${reporte.clave}`"
                    />
                </div>
            </section>
        </div>
    </PanelPagina>
</template>
