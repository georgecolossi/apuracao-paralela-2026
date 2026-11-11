/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR VRQR 4.0 (TSE 2020)
 * 
 * Adaptador para layout de Boletins de Urna das Eleições Municipais de 2020.
 * Status: EXPERIMENTAL / PENDENTE DE HOMOLOGAÇÃO COM FIXTURES OFICIAIS EM DISCO.
 */

import { BaseVrqrAdapter } from './BaseVrqrAdapter';

export class Vrqr4Adapter extends BaseVrqrAdapter {
  readonly version = 'VRQR:4.0';
  readonly supportedFormats = ['4.0', '04.00'];
  readonly description = 'Adaptador experimental para Boletins de Urna TSE Eleições Municipais 2020 (VRQR 4.0)';

  protected override validateOfficeAllowed(officeCode: string): boolean {
    // 2020 foi uma eleição estritamente municipal:
    // Prefeito (11), Vice-Prefeito (12), Vereador (13) e Consulta Popular (53)
    const municipalOffices = ['11', '12', '13', '53'];
    return municipalOffices.includes(officeCode);
  }
}
