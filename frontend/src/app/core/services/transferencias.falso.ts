import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CuentaDeposito } from '../models/transferencias.models';

/**
 * Un TransferenciasService de mentiras para las pruebas (solo lo importan los
 * .spec): sin cuentas dadas de alta, "¿A qué cuenta llegó?" no se dibuja ni se
 * exige, y las pantallas se portan como antes de las Transferencias.
 * Con `cuentas`, se comporta como el de verdad para elegirlas.
 */
export function transferenciasFalso(cuentas: CuentaDeposito[] = []) {
  const lista = signal<CuentaDeposito[] | null>(cuentas);
  return {
    cuentas: lista,
    cargarCuentas: (_forzar?: boolean) => {},
    faltaCuenta: (esTransferencia: boolean, cuentaId: number | null | undefined) =>
      esTransferencia && (lista()?.length ?? 0) > 0 && !(cuentaId || (lista()?.length === 1 ? lista()![0].id : null)),
    elegida: (cuentaId: number | null | undefined) =>
      cuentaId || (lista()?.length === 1 ? lista()![0].id : null),
    nombreCuenta: (c: { banco: string | null; ultimos?: string | null; cuenta_ultimos?: string | null } | null | undefined) => {
      if (!c?.banco) return 'Sin cuenta';
      const u = c.ultimos ?? c.cuenta_ultimos;
      return u ? `${c.banco} …${u}` : c.banco;
    },
    listar: () => of({ items: [], total: 0, cifras: null, por_cuenta: [], limit: 100, offset: 0, hay_mas: false }),
    actualizar: () => of(null),
    marcar: () => of({ marcadas: 0 }),
  };
}
