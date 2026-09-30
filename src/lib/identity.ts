export function buildBallotReportIdentity(params: {
  stateCode: string;
  cityCode: string;
  zoneCode: string;
  sectionCode: string;
  urnCode: string;
}): string {
  return `${params.stateCode}-${params.cityCode}-${params.zoneCode}-${params.sectionCode}-${params.urnCode}`;
}
