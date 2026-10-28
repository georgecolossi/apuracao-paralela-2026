/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR VRQR 5.0 (TSE 2022)
 */

import { BaseVrqrAdapter } from './BaseVrqrAdapter';

export class Vrqr5Adapter extends BaseVrqrAdapter {
  readonly version = 'VRQR:5.0';
  readonly supportedFormats = ['5.0', '05.00'];
  readonly description = 'Adaptador para Boletins de Urna TSE Eleições Gerais 2022 (VRQR 5.0)';
}
