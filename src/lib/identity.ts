export function buildBallotReportIdentity(params: {
  plei: string;
  turn: string;
  stateCode: string;
  cityCode: string;
  zoneCode: string;
  sectionCode: string;
  urnCode: string;
}): string {
  return `${params.plei}-${params.turn}-${params.stateCode}-${params.cityCode}-${params.zoneCode}-${params.sectionCode}-${params.urnCode}`;
}
