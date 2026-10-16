import type { ComponentProps } from 'react'
import { LogoArgos } from '../LogoArgos'
import { OJO_NODOS } from '../geometria'

/** Variante descartada: pupila hexagonal unida a tres nodos externos. */
export function LogoOjoNodos(props: Omit<ComponentProps<typeof LogoArgos>, 'definicion'>) {
    return <LogoArgos {...props} definicion={OJO_NODOS} />
}
