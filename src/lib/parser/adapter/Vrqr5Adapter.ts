/**
 * APURAÇÃO PARALELA 2.0 — ADAPTADOR VRQR 5.0 (TSE 2022)
 * 
 * Adaptador para layout de Boletins de Urna das Eleições Gerais de 2022.
 * Status: EXPERIMENTAL / PENDENTE DE HOMOLOGAÇÃO COM FIXTURES OFICIAIS EM DISCO.
 */

import { BaseVrqrAdapter } from './BaseVrqrAdapter';

export class Vrqr5Adapter extends BaseVrqrAdapter {
  readonly version = 'VRQR:5.0';
  readonly supportedFormats = ['5.0', '05.00'];
  readonly description = 'Adaptador experimental para Boletins de Urna TSE Eleições Gerais 2022 (VRQR 5.0)';

  protected override validateOfficeAllowed(officeCode: string): boolean {
    // 2022 foi eleição geral (Presidencial / Estadual):
    // Presidente (1), Vice-Presidente (2), Governador (3), Vice-Governador (4),
    // Senador (5 - 1 vaga em 2022), Deputado Federal (6), Deputado Estadual (7), Deputado Distrital (8), Consulta Popular (53)
    const generalOffices = ['1', '2', '3', '4', '5', '6', '7', '8', '53'];
    return generalOffices.includes(officeCode);
  }
}
