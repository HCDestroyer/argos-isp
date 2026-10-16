import type { ComponentProps } from 'react'
import { LogoArgos } from '../LogoArgos'
import { OJO_SENAL } from '../geometria'

/** Variante elegida: ojo almendrado, pupila-nodo y tres arcos de señal (es `LOGO_ELEGIDO`). */
export function LogoOjoSenal(props: Omit<ComponentProps<typeof LogoArgos>, 'definicion'>) {
    return <LogoArgos {...props} definicion={OJO_SENAL} />
}
