/**
 * Gerenciador e utilitários de Câmera para o Scanner Mobile (PR 5)
 * 
 * Responsabilidades:
 * 1. Priorização determinística da câmera traseira principal (evitando lentes macro ou ultrawide).
 * 2. Detecção e aplicação de foco contínuo somente quando suportado pelo hardware.
 * 3. Detecção e aplicação de foco por toque (touch-to-focus) apenas com suporte real da API/dispositivo.
 * 4. Conversão precisa de coordenadas de toque para espaço normalizado de vídeo (0.0 a 1.0).
 * 5. Mapeamento de erros de acesso e permissões de hardware.
 */

export interface CameraDeviceLike {
  id: string;
  label?: string;
}

export interface FocusCapabilities {
  supportsContinuousFocus: boolean;
  supportsTouchFocus: boolean;
  rawFocusModes?: string[];
  hasPointsOfInterest?: boolean;
}

export interface NormalizedCoordinates {
  x: number;
  y: number;
}

/**
 * Prioriza a câmera traseira principal.
 * Filtra termos comuns de câmeras traseiras e desprioriza lentes ultra-wide ou macro.
 */
export function prioritizeCameras<T extends CameraDeviceLike>(devices: T[]): T[] {
  if (!devices || devices.length === 0) return [];

  const scoreDevice = (device: T): number => {
    const label = (device.label || '').toLowerCase();
    let score = 0;

    // Pontuação positiva para câmera traseira / ambiente
    if (label.includes('back') || label.includes('traseira') || label.includes('rear') || label.includes('environment')) {
      score += 100;
    }

    // Prioriza câmera 0 ou 1 / principal
    if (label.includes('camera 0') || label.includes('câmera 0') || label.includes('main') || label.includes('principal')) {
      score += 50;
    }

    // Desprioriza ultra-wide, ultra wide, 0.5x, macro ou telephoto para leitura de QR Code
    if (label.includes('ultra') || label.includes('0.5') || label.includes('macro') || label.includes('tele')) {
      score -= 40;
    }

    // Desprioriza frontal
    if (label.includes('front') || label.includes('frontal') || label.includes('selfie') || label.includes('user')) {
      score -= 100;
    }

    return score;
  };

  return [...devices].sort((a, b) => scoreDevice(b) - scoreDevice(a));
}

/**
 * Inspeciona os recursos reais do MediaStreamTrack (capabilities)
 * para determinar com precisão o que o hardware realmente suporta.
 */
export function inspectFocusCapabilities(capabilities?: unknown): FocusCapabilities {
  if (!capabilities || typeof capabilities !== 'object') {
    return {
      supportsContinuousFocus: false,
      supportsTouchFocus: false
    };
  }

  const caps = capabilities as Record<string, unknown>;
  const focusModes = Array.isArray(caps.focusMode) ? (caps.focusMode as string[]) : [];
  const hasContinuous = focusModes.includes('continuous');
  
  // Suporte a foco manual ou pontos de interesse segundo a especificação W3C ImageCapture
  const hasManual = focusModes.includes('manual');
  const hasPointsOfInterest = Boolean(caps.pointsOfInterest);

  const supportsTouch = hasPointsOfInterest || hasManual;

  return {
    supportsContinuousFocus: hasContinuous,
    supportsTouchFocus: supportsTouch,
    rawFocusModes: focusModes,
    hasPointsOfInterest
  };
}

/**
 * Converte coordenadas de toque do elemento visual do viewfinder
 * para coordenadas normalizadas (0.0 a 1.0) relativas ao fluxo de vídeo.
 */
export function calculateNormalizedTouchPoint(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number; width: number; height: number }
): NormalizedCoordinates | null {
  if (!containerRect || containerRect.width <= 0 || containerRect.height <= 0) {
    return null;
  }

  const relX = clientX - containerRect.left;
  const relY = clientY - containerRect.top;

  // Garante que o toque ocorreu dentro do retângulo do container
  if (relX < 0 || relX > containerRect.width || relY < 0 || relY > containerRect.height) {
    return null;
  }

  const normX = Math.max(0, Math.min(1, relX / containerRect.width));
  const normY = Math.max(0, Math.min(1, relY / containerRect.height));

  return {
    x: Number(normX.toFixed(4)),
    y: Number(normY.toFixed(4))
  };
}

/**
 * Gera as restrições de vídeo para touch-to-focus real.
 * Retorna null se as capacidades não oferecerem suporte real ao foco por toque.
 */
export function createTouchFocusConstraints(
  coords: NormalizedCoordinates,
  capabilities: FocusCapabilities
): Record<string, unknown> | null {
  if (!capabilities.supportsTouchFocus) {
    return null;
  }

  const advancedConstraints: Record<string, unknown> = {};

  if (capabilities.hasPointsOfInterest) {
    advancedConstraints.pointsOfInterest = [{ x: coords.x, y: coords.y }];
  } else if (capabilities.rawFocusModes?.includes('manual')) {
    advancedConstraints.focusMode = 'manual';
    // Em dispositivos com modo manual sem pointsOfInterest explícito
    advancedConstraints.focusDistance = 0.2; // Distância típica para captura de QR Code (20cm)
  }

  return {
    advanced: [advancedConstraints]
  };
}

/**
 * Mapeia erros nativos do navegador/hardware para mensagens legíveis.
 */
export function mapCameraError(error: unknown): string {
  if (!error) return 'Erro desconhecido ao acessar a câmera.';

  const errObj = error as { name?: string; message?: string };
  const name = errObj.name || '';
  const msg = (errObj.message || '').toLowerCase();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('permission denied')) {
    return 'Permissão de câmera negada. Habilite o acesso à câmera nas configurações do seu navegador.';
  }

  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('no camera') || msg.includes('not found')) {
    return 'Nenhuma câmera compatível foi encontrada no dispositivo.';
  }

  if (name === 'NotReadableError' || name === 'TrackStartError' || msg.includes('in use') || msg.includes('could not start')) {
    return 'A câmera está em uso por outro aplicativo ou bloqueada pelo sistema operacional.';
  }

  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'As configurações de resolução ou foco solicitadas não são suportadas por esta câmera.';
  }

  return 'Falha ao inicializar a câmera do dispositivo. Tente recarregar a página.';
}
