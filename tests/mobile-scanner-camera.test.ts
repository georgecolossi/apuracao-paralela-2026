import { describe, it, expect } from 'vitest';
import {
  prioritizeCameras,
  inspectFocusCapabilities,
  calculateNormalizedTouchPoint,
  createTouchFocusConstraints,
  mapCameraError,
  CameraDeviceLike,
  FocusCapabilities
} from '../src/lib/scanner/cameraManager';

describe('PR 5 — Mobile Scanner: Gerenciamento de Câmera e Foco', () => {
  describe('1. Priorização Determinística da Câmera Traseira Principal', () => {
    it('1.1 Prioriza câmera traseira/back em relação à câmera frontal', () => {
      const devices: CameraDeviceLike[] = [
        { id: 'cam-front', label: 'Front Facing Camera (Selfie)' },
        { id: 'cam-back', label: 'Back Camera 0 (Wide)' }
      ];

      const prioritized = prioritizeCameras(devices);
      expect(prioritized[0].id).toBe('cam-back');
      expect(prioritized[1].id).toBe('cam-front');
    });

    it('1.2 Desprioriza lentes ultra-wide (0.5x) e macro em favor da lente principal padrão', () => {
      const devices: CameraDeviceLike[] = [
        { id: 'cam-ultra', label: 'Back Ultra-Wide Camera 0.5x' },
        { id: 'cam-macro', label: 'Back Macro Lens' },
        { id: 'cam-main', label: 'Back Camera 0 Main Principal' }
      ];

      const prioritized = prioritizeCameras(devices);
      expect(prioritized[0].id).toBe('cam-main');
    });

    it('1.3 Retorna lista vazia se nenhum dispositivo for fornecido', () => {
      expect(prioritizeCameras([])).toEqual([]);
    });

    it('1.4 Lida graciosamente com dispositivos sem label definido', () => {
      const devices: CameraDeviceLike[] = [
        { id: '1' },
        { id: '2', label: 'Traseira Principal' }
      ];

      const prioritized = prioritizeCameras(devices);
      expect(prioritized[0].id).toBe('2');
    });
  });

  describe('2. Inspeção Honesta de Capacidades de Hardware (FocusCapabilities)', () => {
    it('2.1 Android/Chrome com foco contínuo e modo manual', () => {
      const rawCaps = {
        focusMode: ['continuous', 'manual', 'single-shot'],
        exposureMode: ['continuous'],
        pointsOfInterest: true
      };

      const inspected = inspectFocusCapabilities(rawCaps);
      expect(inspected.supportsContinuousFocus).toBe(true);
      expect(inspected.supportsTouchFocus).toBe(true);
      expect(inspected.hasPointsOfInterest).toBe(true);
    });

    it('2.2 Android/Chrome com foco contínuo mas SEM modo manual ou pointsOfInterest', () => {
      const rawCaps = {
        focusMode: ['continuous', 'none']
      };

      const inspected = inspectFocusCapabilities(rawCaps);
      expect(inspected.supportsContinuousFocus).toBe(true);
      expect(inspected.supportsTouchFocus).toBe(false);
    });

    it('2.3 iOS/Safari (WebRTC padrão sem controles de foco expostos)', () => {
      const rawCaps = {
        aspectRatio: { min: 0.5, max: 2.0 },
        facingMode: ['environment']
        // focusMode ausente na API WebRTC do WebKit móvel
      };

      const inspected = inspectFocusCapabilities(rawCaps);
      expect(inspected.supportsContinuousFocus).toBe(false);
      expect(inspected.supportsTouchFocus).toBe(false);
    });

    it('2.4 Fail-closed para capabilities nulas, indefinidas ou inválidas', () => {
      expect(inspectFocusCapabilities(null)).toEqual({
        supportsContinuousFocus: false,
        supportsTouchFocus: false
      });
      expect(inspectFocusCapabilities(undefined)).toEqual({
        supportsContinuousFocus: false,
        supportsTouchFocus: false
      });
      expect(inspectFocusCapabilities('invalid')).toEqual({
        supportsContinuousFocus: false,
        supportsTouchFocus: false
      });
    });
  });

  describe('3. Mapeamento de Coordenadas de Toque Normalizadas', () => {
    const containerRect = {
      left: 100,
      top: 50,
      width: 400,
      height: 300
    };

    it('3.1 Converte toque no centro exato para (0.5, 0.5)', () => {
      const coords = calculateNormalizedTouchPoint(300, 200, containerRect);
      expect(coords).not.toBeNull();
      expect(coords?.x).toBe(0.5);
      expect(coords?.y).toBe(0.5);
    });

    it('3.2 Converte toque no canto superior esquerdo para (0.0, 0.0)', () => {
      const coords = calculateNormalizedTouchPoint(100, 50, containerRect);
      expect(coords).not.toBeNull();
      expect(coords?.x).toBe(0);
      expect(coords?.y).toBe(0);
    });

    it('3.3 Converte toque no canto inferior direito para (1.0, 1.0)', () => {
      const coords = calculateNormalizedTouchPoint(500, 350, containerRect);
      expect(coords).not.toBeNull();
      expect(coords?.x).toBe(1);
      expect(coords?.y).toBe(1);
    });

    it('3.4 Rejeita toque fora dos limites do container', () => {
      expect(calculateNormalizedTouchPoint(50, 200, containerRect)).toBeNull(); // Esquerda
      expect(calculateNormalizedTouchPoint(550, 200, containerRect)).toBeNull(); // Direita
      expect(calculateNormalizedTouchPoint(300, 20, containerRect)).toBeNull(); // Acima
      expect(calculateNormalizedTouchPoint(300, 400, containerRect)).toBeNull(); // Abaixo
    });

    it('3.5 Retorna null para dimensões nulas ou inválidas do container', () => {
      expect(calculateNormalizedTouchPoint(100, 100, { left: 0, top: 0, width: 0, height: 100 })).toBeNull();
      expect(calculateNormalizedTouchPoint(100, 100, { left: 0, top: 0, width: 100, height: -1 })).toBeNull();
    });
  });

  describe('4. Honestidade Técnica de Touch-Focus: Não Simular Foco Não Executado', () => {
    it('4.1 Retorna null e NENHUMA constraint se o hardware não suportar touch focus', () => {
      const capsWithoutTouch: FocusCapabilities = {
        supportsContinuousFocus: true,
        supportsTouchFocus: false
      };

      const coords = { x: 0.5, y: 0.5 };
      const constraints = createTouchFocusConstraints(coords, capsWithoutTouch);
      expect(constraints).toBeNull();
    });

    it('4.2 Gera constraints com pointsOfInterest se o hardware suportar', () => {
      const capsWithPoi: FocusCapabilities = {
        supportsContinuousFocus: true,
        supportsTouchFocus: true,
        hasPointsOfInterest: true
      };

      const coords = { x: 0.35, y: 0.65 };
      const constraints = createTouchFocusConstraints(coords, capsWithPoi);
      expect(constraints).not.toBeNull();
      expect(constraints).toEqual({
        advanced: [{ pointsOfInterest: [{ x: 0.35, y: 0.65 }] }]
      });
    });

    it('4.3 Gera constraints com modo manual e distância padrão em hardware com focusMode manual', () => {
      const capsWithManual: FocusCapabilities = {
        supportsContinuousFocus: true,
        supportsTouchFocus: true,
        hasPointsOfInterest: false,
        rawFocusModes: ['continuous', 'manual']
      };

      const coords = { x: 0.5, y: 0.5 };
      const constraints = createTouchFocusConstraints(coords, capsWithManual);
      expect(constraints).not.toBeNull();
      expect(constraints).toEqual({
        advanced: [{ focusMode: 'manual', focusDistance: 0.2 }]
      });
    });
  });

  describe('5. Mapeamento Amigável de Erros de Câmera e Permissões', () => {
    it('5.1 Mapeia NotAllowedError para instrução clara de permissões', () => {
      const err = { name: 'NotAllowedError', message: 'Permission denied' };
      const mapped = mapCameraError(err);
      expect(mapped).toContain('Permissão de câmera negada');
      expect(mapped).toContain('configurações do seu navegador');
    });

    it('5.2 Mapeia NotFoundError para ausência de hardware', () => {
      const err = { name: 'NotFoundError', message: 'Requested device not found' };
      const mapped = mapCameraError(err);
      expect(mapped).toContain('Nenhuma câmera compatível');
    });

    it('5.3 Mapeia NotReadableError para câmera ocupada ou travada', () => {
      const err = { name: 'NotReadableError', message: 'Could not start video source' };
      const mapped = mapCameraError(err);
      expect(mapped).toContain('em uso por outro aplicativo');
    });

    it('5.4 Mapeia OverconstrainedError para restrições incompatíveis', () => {
      const err = { name: 'OverconstrainedError' };
      const mapped = mapCameraError(err);
      expect(mapped).toContain('não são suportadas por esta câmera');
    });

    it('5.5 Fallback para erro nulo ou genérico', () => {
      expect(mapCameraError(null)).toContain('Erro desconhecido');
      expect(mapCameraError({})).toContain('Falha ao inicializar a câmera');
    });
  });
});
