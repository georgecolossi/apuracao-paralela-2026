import { test, expect } from '@playwright/test';
import { randomUUID } from 'crypto';

test('Fluxo de login, logout e sessão inativa', async ({ page, context }) => {
  const sessionId = randomUUID();
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash('admin123', 10);
  
  const email = `admin-${sessionId}@apuracao.local`;

  // 1. Cria usuário
  await prisma.user.upsert({
    where: { email },
    update: { isActive: true },
    create: {
      name: 'Admin Logout Test',
      email,
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });

  // 2. Login
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('/admin/scanner');

  // 3. Verifica acesso ao painel
  await page.goto('/admin');
  await expect(page.locator('text=Admin Panel')).toBeVisible();

  // 4. Logout
  await page.click('button[title="Sair"]');
  await page.waitForURL('/login');

  // 5. Tenta acessar rota restrita
  await page.goto('/admin');
  await page.waitForURL(url => url.pathname.includes('/login'));

  // 6. Login novamente para testar usuário inativo
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForURL('/admin/scanner');

  // 7. Inativa usuário no banco
  await prisma.user.update({
    where: { email },
    data: { isActive: false }
  });

  // 8. Tenta navegar - deve redirecionar por ter ficado inativo
  await page.goto('/admin');
  await page.waitForURL(url => url.pathname.includes('/login'));

  await prisma.$disconnect();
});
