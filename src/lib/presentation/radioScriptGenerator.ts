import { UrnaDetailDTO } from './pressDto';

/**
 * Gera texto estruturado para locução em rádio e leitura rápida em estúdio,
 * totalmente agnóstico a cargos, pleitos e quantidades de candidatos.
 */
export function generateRadioScript(urna: UrnaDetailDTO): string {
  const lines: string[] = [];

  // Cabeçalho da Notícia / Plantão de Apuração
  lines.push('BOLETIM DE URNA APURADO — APURAÇÃO PARALELA');
  lines.push(`Eleição: ${urna.context.election.name} — ${urna.context.round.roundNumber}º Turno`);
  
  if (urna.territory.cityName) {
    lines.push(`Município: ${urna.territory.cityName} (${urna.territory.stateCode})`);
  } else {
    lines.push(`Estado: ${urna.territory.stateCode}`);
  }

  const locPart = urna.territory.locationName ? ` | Local: ${urna.territory.locationName}` : '';
  lines.push(`Zona Eleitoral: ${urna.territory.zoneCode} | Seção: ${urna.territory.sectionCode}${locPart}`);

  if (urna.territory.urnCode) {
    lines.push(`Urna Eletrônica nº: ${urna.territory.urnCode}`);
  }

  // Horário e Autenticidade
  const timeLabel = urna.timing.timestampType === 'CONFIRMED'
    ? 'Horário de Confirmação'
    : 'Horário de Registro (Estimado)';
  
  const formattedTime = new Date(urna.timing.displayTimestamp).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium'
  });
  lines.push(`${timeLabel}: ${formattedTime}`);

  if (urna.integrity.hashStatus === 'VERIFIED') {
    lines.push('Integridade: Hash SHA-512 Verificado com Sucesso.');
  } else {
    lines.push('Integridade: Hash Não Verificado.');
  }

  lines.push('');
  lines.push('--- RESULTADO POR CARGO ---');

  for (const office of urna.offices) {
    lines.push('');
    lines.push(`CARGO: ${office.officeName.toUpperCase()}`);
    lines.push(`Total apurado: ${office.summary.totalVotes} votos (${office.summary.validVotes} votos válidos)`);

    if (office.candidates.length > 0) {
      lines.push('Candidatos mais votados nesta urna:');
      office.candidates.forEach((cand, idx) => {
        const partyPart = cand.partyAbbreviation ? ` (${cand.partyAbbreviation})` : '';
        lines.push(`${idx + 1}º: ${cand.ballotName}${partyPart} — Nº ${cand.candidateNumber} com ${cand.votes} votos (${cand.percent})`);
      });
    }

    if (office.parties && office.parties.length > 0) {
      lines.push('Votos de Legenda:');
      office.parties.forEach(p => {
        lines.push(`Partido ${p.partyAbbreviation || p.partyNumber}: ${p.votes} votos (${p.percent})`);
      });
    }

    lines.push(`Votos em Branco: ${office.summary.blankVotes}`);
    lines.push(`Votos Nulos: ${office.summary.nullVotes}`);
  }

  // Bloco de comparecimento apenas se disponível
  if (urna.attendance && urna.attendance.available && urna.attendance.apto !== null && urna.attendance.apto > 0) {
    lines.push('');
    lines.push('--- COMPARECIMENTO DA SEÇÃO ---');
    lines.push(`Eleitores Aptos: ${urna.attendance.apto}`);
    if (urna.attendance.comp !== null) {
      lines.push(`Comparecimento: ${urna.attendance.comp} eleitores (${urna.attendance.turnoutPercent || '0,00%'})`);
    }
    if (urna.attendance.falt !== null) {
      lines.push(`Abstenção: ${urna.attendance.falt} eleitores (${urna.attendance.abstentionPercent || '0,00%'})`);
    }
  }

  return lines.join('\n');
}
