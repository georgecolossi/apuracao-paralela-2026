/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR VRQR 6.0 (TSE 2024 / 2026)
 */

import { BaseVrqrAdapter } from './BaseVrqrAdapter';

export class Vrqr6Adapter extends BaseVrqrAdapter {
  readonly version = 'VRQR:6.0';
  readonly supportedFormats = ['6.0', '06.00', '01.01', '1.0', '01.00'];
  readonly description = 'Adaptador para Boletins de Urna TSE Eleições 2024 e 2026 (VRQR 6.0)';
}
