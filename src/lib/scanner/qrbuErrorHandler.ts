/**
 * Mapeador e formatador amigável de erros do Scanner Mobile (PR 5)
 * 
 * Traduz códigos de erro HTTP, códigos da gramática VRQR e invariantes eleitorais
 * em mensagens claras, objetivas e acionáveis para os operadores em campo.
 */

export interface ErrorDetails {
  title: string;
  message: string;
  isRetryable: boolean;
  technicalCode?: string;
}

export function formatScanError(status: number, data?: { error?: string; message?: string; reason?: string }): ErrorDetails {
  const code = (data?.error || data?.message || '').toUpperCase();
  const rawMsg = data?.message || data?.error || '';
  const technicalCode = data?.error || (code ? code : undefined);

  // 1. Erros de Autenticação e RBAC
  if (status === 401) {
    return {
      title: 'Sessão Expirada',
      message: 'Sua sessão expirou ou não está autenticada. Faça login novamente para continuar.',
      isRetryable: false,
      technicalCode
    };
  }

  if (status === 403) {
    if (code.includes('VIEWER') || code.includes('FORBIDDEN_ROLE')) {
      return {
        title: 'Acesso Não Autorizado',
        message: 'Usuários com perfil de visualizador (VIEWER) não têm permissão para operar o scanner de BUs.',
        isRetryable: false,
        technicalCode
      };
    }
    return {
      title: 'Falha de Segurança (CSRF)',
      message: 'A validação de segurança da requisição falhou. Recarregue a página antes de nova tentativa.',
      isRetryable: true,
      technicalCode
    };
  }

  // 2. Erros de Integridade Criptográfica
  if (code.includes('CRYPTOGRAPHIC_INTEGRITY_FAILED') || code.includes('HASH_MISMATCH')) {
    return {
      title: 'Integridade Criptográfica Violada',
      message: 'O hash criptográfico SHA-512 do Boletim de Urna não confere com o conteúdo dos votos. BU rejeitado.',
      isRetryable: true,
      technicalCode
    };
  }

  // 3. Erros de Duplicação
  if (code.includes('DUPLICATED_BALLOT') || code.includes('DUPLICADO') || code.includes('P2002')) {
    return {
      title: 'Boletim Já Processado',
      message: 'Este Boletim de Urna (mesma urna, zona e seção) já foi recebido e apurado anteriormente.',
      isRetryable: false,
      technicalCode
    };
  }

  // 4. Erros de Cobertura e Isolamento Eleitoral
  if (code.includes('OUT_OF_COVERAGE')) {
    return {
      title: 'Seção Fora de Cobertura',
      message: 'Esta seção eleitoral não pertence à malha de cobertura cadastrada para a eleição ativa.',
      isRetryable: false,
      technicalCode
    };
  }

  if (code.includes('OFFICE_NOT_CONFIGURED')) {
    return {
      title: 'Cargo Não Configurado',
      message: 'O BU contém votos para cargos que não estão configurados na eleição ativa.',
      isRetryable: false,
      technicalCode
    };
  }

  if (code.includes('ELECTION_MISMATCH')) {
    return {
      title: 'Eleição Incompatível',
      message: 'Os identificadores do BU (pleito, ano ou fase) não correspondem à eleição em andamento.',
      isRetryable: false,
      technicalCode
    };
  }

  if (code.includes('SIMULATION') || code.includes('SIMULATED')) {
    return {
      title: 'Modo Incompatível',
      message: 'Tentativa de enviar BU sintético/simulado para a apuração oficial.',
      isRetryable: false,
      technicalCode
    };
  }

  // 5. Erros Gramaticais e Estruturais do QRBU
  if (code.includes('UNSUPPORTED_VRQR_VERSION')) {
    return {
      title: 'Versão Não Suportada',
      message: 'O layout deste QRBU não é suportado pelo sistema (requer VRQR 6.0 oficial).',
      isRetryable: false,
      technicalCode
    };
  }

  if (code.includes('UNHOMOLOGATED_VRQR_VERSION')) {
    return {
      title: 'Layout Não Homologado',
      message: 'Versão de layout experimental desabilitada para execução em produção.',
      isRetryable: false,
      technicalCode
    };
  }

  if (code.includes('DISPLACED_VOTE_TOKEN')) {
    return {
      title: 'Formato de Envelope Inválido',
      message: 'Tokens de votos encontrados em posição inadequada no envelope do QRBU.',
      isRetryable: true,
      technicalCode
    };
  }

  if (code.includes('INCOMPLETE_OFFICE_BLOCK') || code.includes('INCOMPLETE_SUMMARY_BLOCK')) {
    return {
      title: 'Envelope Incompleto',
      message: 'O QRBU lido possui blocos de cargos ou totalizadores incompletos.',
      isRetryable: true,
      technicalCode
    };
  }

  if (code.includes('SUMMARY_TOTAL_MISMATCH') || code.includes('VOTE_TOTAL_MISMATCH')) {
    return {
      title: 'Divergência Aritmética',
      message: 'A soma dos votos não coincide com os totalizadores oficiais registrados no BU.',
      isRetryable: true,
      technicalCode
    };
  }

  if (code.includes('MISSING_PARTS') || code.includes('TOTAL_MISMATCH') || code.includes('ORDER')) {
    return {
      title: 'Inconsistência de Partes',
      message: 'Divergência na sequência ou partes do BU multipartes. Reinicie a leitura.',
      isRetryable: true,
      technicalCode
    };
  }

  if (code.includes('INVALID_HEADER')) {
    return {
      title: 'Cabeçalho Inválido',
      message: 'O código escaneado não possui o cabeçalho padrão oficial (QRBU:...).',
      isRetryable: true,
      technicalCode
    };
  }

  // Mensagem genérica com fallback informativo
  return {
    title: 'Falha no Processamento',
    message: rawMsg || `Ocorreu um erro ao processar o Boletim de Urna (Código HTTP ${status}).`,
    isRetryable: true,
    technicalCode
  };
}
