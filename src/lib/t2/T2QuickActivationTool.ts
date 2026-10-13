import { Tse2026BallotReportParser } from '../parser/Tse2026BallotReportParser';
import { Tse2026QrTokenizer } from '../parser/tse2026/Tse2026QrTokenizer';
import { Tse2026SemanticParser } from '../parser/tse2026/Tse2026SemanticParser';
import { Tse2026HashValidator } from '../parser/tse2026/Tse2026HashValidator';
import { Tse2026SignatureValidator } from '../parser/tse2026/Tse2026SignatureValidator';

/**
 * =========================================================================================
 * DISTINÇÃO CRIPTOGRÁFICA RIGOROSA (INTEGRIDADE vs AUTENTICIDADE):
 * 
 * 1. INTEGRIDADE DE PAYLOAD (Hash SHA-512):
 *    - O campo `HASH` assegura unicamente que o payload do QRBU não foi truncado nem corrompido
 *      durante a leitura ótica.
 *    - A validação `hashStatus === 'VERIFIED'` NÃO atesta a autoria da urna nem a legitimidade
 *      estatal do Boletim de Urna.
 * 
 * 2. PRESENÇA DE ASSINATURA (`signaturePresent` / campo `ASSI`):
 *    - A presença do campo `ASSI` indica meramente que o QRBU contém a sequência hexadecimal
 *      gerada pela urna eletrônica.
 *    - A mera existência de `ASSI` NÃO equivale à comprovação de autenticidade criptográfica.
 * 
 * 3. VERIFICAÇÃO CRIPTOGRÁFICA EFETIVA (`signatureStatus === 'VERIFIED'`):
 *    - Exige conferência assimétrica formal (Ed25519) contra a chave pública oficial da
 *      Justiça Eleitoral (cadeia de certificação TSE / ICP-Brasil).
 *    - Na ausência de chave pública em tempo de execução, o status permanece obrigatoriamente
 *      `UNAVAILABLE` e `authenticityState` como `AUTHENTICITY_UNVERIFIED`.
 *    - A aplicação JAMAIS confunde hash SHA-512 ou presença de assinatura com verificação
 *      criptográfica efetiva. O veredito `OPERATIONALLY_READY` NUNCA é emitido automaticamente.
 * =========================================================================================
 */

export type T2AuthenticityState = 
  | 'STRUCTURALLY_VALID'
  | 'INTEGRITY_VERIFIED'
  | 'AUTHENTICITY_VERIFIED'
  | 'AUTHENTICITY_UNVERIFIED'
  | 'PARAMETERS_VERIFIED'
  | 'OPERATIONALLY_READY'
  | 'BLOCKED';

export interface ExtractedT2Parameters {
  vrqr?: string;
  turn?: string;
  plei?: string;
  dtpl?: string;
  proc?: string;
  fase?: string;
  unfe?: string;
  muni?: string;
  zona?: string;
  seca?: string;
  agre?: string;
  idue?: string;
  hash?: string;
  signaturePresent: boolean;
  signatureStatus: 'VERIFIED' | 'INVALID' | 'UNAVAILABLE';
  hashStatus: 'VERIFIED' | 'INVALID' | 'UNAVAILABLE';
  offices: Array<{ code: string; name: string }>;
  candidates: Array<{ candidateNumber: string; partyNumber?: string; office: string }>;
  totalParts: number;
  partsReceived: number;
  isMultipart: boolean;
  rawPayload: string;
  structuralIntegrity: boolean;
  authenticityState: T2AuthenticityState;
  validationErrors: string[];
}

export type T2ValidationVerdict = 
  | 'BLOCKED'
  | 'CONFLICTING_DATA'
  | 'PARTIALLY_READY'
  | 'PARAMETERS_VERIFIED'
  | 'OPERATIONALLY_READY';

export interface T2ValidationReport {
  verdict: T2ValidationVerdict;
  extracted: ExtractedT2Parameters;
  checks: {
    multipartReconstructed: boolean;
    turnValid: boolean;
    municipalityValid: boolean;
    zoneValid: boolean;
    sectionEligible: boolean;
    officesValid: boolean;
    candidatesValid: boolean;
    pleiVerified: boolean;
    hashValid: boolean;
    signatureAuthentic: boolean;
  };
  reasons: string[];
  recommendations: string[];
  operationalNotice: string;
}

export class T2QrParameterExtractor {
  private parser = new Tse2026BallotReportParser();
  private tokenizer = new Tse2026QrTokenizer();
  private semanticParser = new Tse2026SemanticParser();
  private hashValidator = new Tse2026HashValidator();
  private sigValidator = new Tse2026SignatureValidator();

  /**
   * Extrai e valida parâmetros de um QRBU (única string ou array de partes).
   * Reutiliza métodos canônicos do Tse2026BallotReportParser.
   */
  extract(input: string | string[]): ExtractedT2Parameters {
    const rawParts = Array.isArray(input) ? input : [input];
    const structuralErrors: string[] = [];
    const validationErrors: string[] = [];
    let structuralIntegrity = true;

    if (rawParts.length === 0 || (rawParts.length === 1 && !rawParts[0].trim())) {
      return this.buildErrorParameters(['Entrada vazia fornecida ao extrator.']);
    }

    // 1. Processamento e Reconstrução de Multipartes
    let fullPayload = '';
    let totalParts = 1;
    let partsReceived = rawParts.length;
    let isMultipart = false;

    // Detectar se possui cabeçalho oficial QRBU
    const firstPart = rawParts[0];
    const hasQrbuHeader = /^QRBU:(\d+):(\d+)/.test(firstPart);

    if (hasQrbuHeader) {
      isMultipart = true;
      const partInfo = this.parser.parsePart(firstPart);
      if ('code' in partInfo) {
        structuralErrors.push(`Erro no cabeçalho da primeira parte: ${partInfo.code} - ${partInfo.message}`);
        return this.buildErrorParameters(structuralErrors);
      }
      totalParts = partInfo.totalParts;

      if (rawParts.length < totalParts) {
        structuralErrors.push(`QRBU multipartes incompleto: recebidas ${rawParts.length} de ${totalParts} partes esperadas.`);
        return this.buildErrorParameters(structuralErrors, totalParts, rawParts.length, true);
      }

      const reconstructedOrError = this.parser.reconstruct(rawParts);
      if (typeof reconstructedOrError !== 'string') {
        structuralErrors.push(`Falha na reconstrução das partes: ${reconstructedOrError.code} - ${reconstructedOrError.message}`);
        return this.buildErrorParameters(structuralErrors, totalParts, rawParts.length, true);
      }
      fullPayload = reconstructedOrError;
    } else {
      // String monolítica (fixture ou scan sem cabeçalho QRBU:)
      fullPayload = rawParts.join(' ');
    }

    // 2. Extração de HASH e ASSI
    const hashMatch = fullPayload.match(/\bHASH:([A-Fa-f0-9]+)\b/);
    const hash = hashMatch ? hashMatch[1].toUpperCase() : undefined;
    const signatureMatch = fullPayload.match(/\bASSI:(\S+)/);
    const signatureHex = signatureMatch ? signatureMatch[1] : undefined;
    const signaturePresent = !!signatureHex;

    if (!hash) {
      structuralErrors.push('Campo HASH ausente no payload.');
      structuralIntegrity = false;
    }
    if (!signaturePresent) {
      structuralErrors.push('Campo ASSI ausente no payload.');
      structuralIntegrity = false;
    }

    // 3. Validação Criptográfica e Integridade via Componentes Canônicos
    const hashStatus = hash ? this.hashValidator.validate(fullPayload, hash, rawParts) : 'UNAVAILABLE';
    const signatureStatus = this.sigValidator.validate(fullPayload, signatureHex, '');

    if (hashStatus === 'INVALID') {
      validationErrors.push('O hash criptográfico SHA-512 não confere com o conteúdo do QRBU.');
    }

    // 4. Tokenização e Parsing Semântico
    const tokens = this.tokenizer.tokenize(fullPayload);
    const parsed = this.semanticParser.parse(tokens);

    if ('code' in parsed) {
      structuralErrors.push(`Erro no parsing semântico: ${parsed.code} - ${parsed.message}`);
      return this.buildErrorParameters(structuralErrors, totalParts, partsReceived, isMultipart);
    }

    const tokenMap = new Map<string, string>();
    for (const t of tokens) {
      tokenMap.set(t.key, t.value);
    }

    const offices: Array<{ code: string; name: string }> = [];
    const candidates: Array<{ candidateNumber: string; partyNumber?: string; office: string }> = [];

    let currentOfficeCode = '';
    for (const t of tokens) {
      if (t.key === 'CARG') {
        currentOfficeCode = t.value;
        const name = currentOfficeCode === '1' ? 'Presidente' : currentOfficeCode === '3' ? 'Governador' : `Cargo ${currentOfficeCode}`;
        if (!offices.some(o => o.code === currentOfficeCode)) {
          offices.push({ code: currentOfficeCode, name });
        }
      } else if (/^\d+$/.test(t.key) && currentOfficeCode) {
        candidates.push({
          candidateNumber: t.key,
          office: currentOfficeCode
        });
      }
    }

    // Determinar Estado de Autenticidade
    let authenticityState: T2AuthenticityState = 'STRUCTURALLY_VALID';
    if (!structuralIntegrity || structuralErrors.length > 0 || hashStatus === 'INVALID') {
      authenticityState = 'BLOCKED';
    } else if (hashStatus === 'VERIFIED') {
      authenticityState = signatureStatus === 'VERIFIED' ? 'AUTHENTICITY_VERIFIED' : 'AUTHENTICITY_UNVERIFIED';
    }

    const allErrors = [...structuralErrors, ...validationErrors];

    return {
      vrqr: tokenMap.get('VRQR'),
      turn: tokenMap.get('TURN'),
      plei: tokenMap.get('PLEI'),
      dtpl: tokenMap.get('DTPL'),
      proc: tokenMap.get('PROC'),
      fase: tokenMap.get('FASE'),
      unfe: tokenMap.get('UNFE'),
      muni: tokenMap.get('MUNI'),
      zona: tokenMap.get('ZONA'),
      seca: tokenMap.get('SECA'),
      agre: tokenMap.get('AGRE'),
      idue: tokenMap.get('IDUE'),
      hash,
      signaturePresent,
      signatureStatus,
      hashStatus,
      offices,
      candidates,
      totalParts,
      partsReceived,
      isMultipart,
      rawPayload: fullPayload,
      structuralIntegrity: structuralIntegrity && structuralErrors.length === 0,
      authenticityState,
      validationErrors: allErrors
    };
  }

  private buildErrorParameters(
    errors: string[],
    totalParts = 1,
    partsReceived = 0,
    isMultipart = false
  ): ExtractedT2Parameters {
    return {
      signaturePresent: false,
      signatureStatus: 'UNAVAILABLE',
      hashStatus: 'UNAVAILABLE',
      offices: [],
      candidates: [],
      totalParts,
      partsReceived,
      isMultipart,
      rawPayload: '',
      structuralIntegrity: false,
      authenticityState: 'BLOCKED',
      validationErrors: errors
    };
  }
}

export class T2ParameterValidator {
  // Regras Oficiais Restritas para Concórdia/SC
  private knownT2Candidates = new Set(['13', '22']); // Lula e Flávio Bolsonaro
  private expectedOffices = new Set(['1']); // Apenas Presidente da República em SC
  private expectedMuni = '80837'; // Concórdia/SC
  // ZONA OFICIAL DE CONCÓRDIA: estritamente 0090 / 90. Zona 0009 pertence a Mafra/SC e foi banida.
  private expectedZones = new Set(['0090', '90']);

  validate(
    extracted: ExtractedT2Parameters,
    coverageSection?: { expectedBUs: number } | null
  ): T2ValidationReport {
    const reasons: string[] = [];
    const recommendations: string[] = [];

    // Checagem de Reconstrução
    const multipartReconstructed = extracted.structuralIntegrity && (!extracted.isMultipart || extracted.partsReceived >= extracted.totalParts);
    if (!multipartReconstructed) {
      reasons.push('QRBU incompleto ou com partes corrompidas.');
    }

    // Checagem de Turno
    const turnValid = extracted.turn === '2';
    if (!turnValid) {
      reasons.push(`Turno divergente: esperado '2', recebido '${extracted.turn}'.`);
    }

    // Checagem de Município
    const municipalityValid = extracted.muni === this.expectedMuni;
    if (!municipalityValid) {
      reasons.push(`Município divergente: esperado ${this.expectedMuni} (Concórdia), recebido '${extracted.muni}'.`);
    }

    // Checagem de Zona (Remoção da falha da Zona 0009)
    const rawZone = extracted.zona ? extracted.zona.padStart(4, '0') : '';
    const zoneValid = extracted.zona ? this.expectedZones.has(extracted.zona) || this.expectedZones.has(rawZone) : false;
    if (!zoneValid) {
      if (extracted.zona === '0009' || extracted.zona === '9') {
        reasons.push(`Zona 0009 pertence a Mafra/SC e é ilegítima para Concórdia/SC (Zona Oficial: 0090).`);
      } else {
        reasons.push(`Zona eleitoral divergente: recebida '${extracted.zona}', esperado '0090'.`);
      }
    }

    // Checagem de Seção e Elegibilidade Positiva
    let sectionEligible = false;
    if (coverageSection === undefined) {
      reasons.push('Seção eleitoral não conferida contra a base de cobertura.');
    } else if (coverageSection === null) {
      reasons.push(`Seção '${extracted.seca}' é órfã (inexistente na base de cobertura do turno).`);
    } else if (coverageSection.expectedBUs <= 0) {
      reasons.push(`Seção '${extracted.seca}' é agregada (peso zero, expectedBUs <= 0) e não possui urna independente.`);
    } else {
      sectionEligible = true;
    }

    // Checagem de Cargos
    let officesValid = extracted.offices.length > 0;
    for (const off of extracted.offices) {
      if (!this.expectedOffices.has(off.code)) {
        officesValid = false;
        reasons.push(`Cargo não previsto para SC no 2º Turno: código ${off.code} (${off.name}). Em SC não há 2º Turno para Governador.`);
      }
    }

    // Checagem de Candidatos
    let candidatesValid = extracted.candidates.length > 0;
    for (const cand of extracted.candidates) {
      if (cand.office === '1' && !this.knownT2Candidates.has(cand.candidateNumber)) {
        candidatesValid = false;
        reasons.push(`Candidato não qualificado ao 2º Turno presidencial: número ${cand.candidateNumber}.`);
      }
    }

    // Checagem de PLEI (Confirmado Oficialmente pelo TSE: 3221 | Fonte: https://www.tse.jus.br/eleicoes/informacoes-tecnicas-sobre-a-divulgacao-de-resultados)
    const pleiVerified = extracted.plei === '3221';
    if (!pleiVerified) {
      reasons.push(`PLEI '${extracted.plei}' diverge da referência oficial 3221 confirmada pelo TSE.`);
      recommendations.push('Verificar configuração do pleito antes de homologar.');
    }

    // Checagem de Integridade Criptográfica (Hash SHA-512)
    // NOTA: O hash SHA-512 garante apenas que o payload não foi truncado nem corrompido na leitura ótica.
    // NÃO comprova autoria da urna nem autenticidade estatal.
    const hashValid = extracted.hashStatus === 'VERIFIED';
    if (!hashValid) {
      reasons.push(`Falha de integridade SHA-512: status '${extracted.hashStatus}'.`);
    }

    // Checagem de Autenticidade Digital (Assinatura Eletrônica Assimétrica)
    // NOTA: A mera presença sintática do campo ASSI NÃO equivale à validação criptográfica.
    // Exige verificação matemática contra a chave pública da autoridade certificadora (TSE).
    const signatureAuthentic = extracted.signatureStatus === 'VERIFIED';
    if (!signatureAuthentic) {
      reasons.push(`Autenticidade digital da urna: ${extracted.signaturePresent ? 'Assinatura presente porém NÃO autenticada criptograficamente (chaves públicas do TSE off-band)' : 'Assinatura ausente'}.`);
    }

    // Determinação Rigorosa do Veredito (Eliminação de Falso READY)
    let verdict: T2ValidationVerdict;

    if (!multipartReconstructed || !turnValid || !municipalityValid || !zoneValid || (coverageSection !== undefined && !sectionEligible)) {
      verdict = 'BLOCKED';
    } else if (!officesValid || !candidatesValid) {
      verdict = 'CONFLICTING_DATA';
    } else if (!pleiVerified || !hashValid) {
      verdict = 'PARTIALLY_READY';
    } else {
      // Parâmetros conferem formalmente com os oficiais do TSE, mas a autenticação estatal exige confirmação off-band e autorização humana
      verdict = 'PARAMETERS_VERIFIED';
      recommendations.push('Parâmetros técnicos validados com sucesso conforme especificações oficiais do TSE.');
      recommendations.push('Exige autorização humana expressa e documento físico em mãos para liberação operacional.');
    }

    const operationalNotice = 'ESTA FERRAMENTA NÃO EXECUTA ATIVAÇÃO AUTOMÁTICA EM NUVEM OU EM BANCO DE DADOS. Toda ativação permanece estritamente manual e sujeita a autorização do comitê eleitoral.';

    return {
      verdict,
      extracted,
      checks: {
        multipartReconstructed,
        turnValid,
        municipalityValid,
        zoneValid,
        sectionEligible,
        officesValid,
        candidatesValid,
        pleiVerified,
        hashValid,
        signatureAuthentic
      },
      reasons,
      recommendations,
      operationalNotice
    };
  }
}
