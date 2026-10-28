/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR VRQR 4.0 (TSE 2020)
 */

import { BaseVrqrAdapter } from './BaseVrqrAdapter';

export class Vrqr4Adapter extends BaseVrqrAdapter {
  readonly version = 'VRQR:4.0';
  readonly supportedFormats = ['4.0', '04.00'];
  readonly description = 'Adaptador para Boletins de Urna TSE Eleições Municipais 2020 (VRQR 4.0)';
}
