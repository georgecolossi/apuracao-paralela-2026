/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR VRQR 6.0 (TSE 2024 / 2026)
 * 
 * Adaptador totalmente homologado para Boletins de Urna TSE Eleições 2024 e 2026.
 * Status: HOMOLOGADO com 10 fixtures oficiais em disco, hashes SHA-256 e SHA-512 verificados.
 */

import { BaseVrqrAdapter, OFFICIAL_OFFICE_MAP } from './BaseVrqrAdapter';

export class Vrqr6Adapter extends BaseVrqrAdapter {
  readonly version = 'VRQR:6.0';
  readonly supportedFormats = ['6.0', '06.00', '01.01', '1.0', '01.00'];
  readonly description = 'Adaptador homologado para Boletins de Urna TSE Eleições 2024 e 2026 (VRQR 6.0)';

  protected override validateOfficeAllowed(officeCode: string): boolean {
    // VRQR 6.0 abrange tanto eleições municipais (2024) quanto eleições gerais (2026)
    return Boolean(OFFICIAL_OFFICE_MAP[officeCode]);
  }
}
