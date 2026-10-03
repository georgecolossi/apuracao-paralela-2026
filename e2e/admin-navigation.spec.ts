import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

test.describe('Desktop Navigation to Cobertura', () => {
  const sessionId = randomUUID();

  test.beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.upsert({
      where: { email: `admin-${sessionId}@apuracao.local` },
      update: {},
      create: {
        name: 'Admin Desktop Test',
        email: `admin-${sessionId}@apuracao.local`,
        passwordHash,
        role: 'ADMIN',
        isActive: true
      }
    });
  });

  test('Deve conseguir navegar para cobertura no desktop', async ({ page }) => {
    // Definir viewport desktop explicitamente
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // Login
    await page.goto('/login');
    await page.fill('input[name="username"]', `admin-${sessionId}@apuracao.local`);
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    
    // Aguardar o login concluir e redirecionar, depois forçar ida ao dashboard
    await page.waitForURL('/admin/scanner');
    await page.goto('/admin');
    
    // Tentar clicar em Cobertura
    // Encontrar o link exato por href para evitar clicar em texto dentro do th/td
    await page.click('a[href="/admin/cobertura"]');
    
    // Verificar a URL
    await expect(page).toHaveURL('/admin/cobertura');
  });
});
