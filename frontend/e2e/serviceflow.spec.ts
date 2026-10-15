import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

function createAccount() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    organizationName: `E2E Organization ${suffix}`,
    name: 'E2E Owner',
    email: `e2e-${suffix}@example.com`,
    password: 'StrongPass1',
  };
}

async function registerAccount(request: APIRequestContext, account: ReturnType<typeof createAccount>): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post('http://127.0.0.1:3333/api/auth/register', { data: account });
    if (response.status() === 201) return;
    const body = await response.text();
    if (response.status() !== 500 || !body.includes('Server has closed the connection')) throw new Error(`E2E account registration failed: ${response.status()} ${body}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('E2E account registration did not become available after backend startup');
}

async function login(page: Page, request: APIRequestContext): Promise<ReturnType<typeof createAccount>> {
  const account = createAccount();
  await registerAccount(request, account);
  await page.goto('/service-orders');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Senha').fill(account.password);
  await page.getByRole('button', { name: /^Entrar/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return account;
}

test('navigates a protected session through the main operational flow', async ({ page, request }) => {
  await login(page, request);
  await expect(page.getByRole('heading', { name: 'Bom trabalho, vamos começar.' })).toBeVisible();

  await page.getByRole('link', { name: 'Clientes' }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.getByRole('link', { name: 'Novo cliente' }).first().click();
  await page.getByLabel('Nome *').fill('Cliente E2E');
  await page.getByLabel('Telefone *').fill('11988887777');
  await page.getByLabel('E-mail').fill('cliente-e2e@example.com');
  await page.getByRole('button', { name: 'Salvar cliente' }).click();
  await expect(page).toHaveURL(/\/customers\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Cliente E2E' })).toBeVisible();

  await page.getByRole('link', { name: /Adicionar/ }).click();
  await expect(page).toHaveURL(/\/equipment\/new/);
  await page.getByLabel('Tipo *').fill('Notebook');
  await page.getByLabel('Marca').fill('Dell');
  await page.getByLabel('Modelo').fill('Latitude E2E');
  await page.getByRole('button', { name: 'Salvar equipamento' }).click();
  await expect(page).toHaveURL(/\/equipment\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Dell Latitude E2E' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cliente E2E', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Ordens de serviço' }).click();
  await page.getByRole('link', { name: 'Nova OS' }).click();
  await expect(page).toHaveURL(/\/service-orders\/new$/);
  const customerSelect = page.getByLabel('Cliente *');
  await expect(customerSelect).toContainText('Cliente E2E');
  const customerId = await customerSelect.locator('option', { hasText: 'Cliente E2E' }).getAttribute('value');
  expect(customerId).toBeTruthy();
  await customerSelect.selectOption(customerId!);
  const equipmentSelect = page.getByLabel('Equipamento *');
  await expect(equipmentSelect).toContainText('Dell Latitude E2E');
  await equipmentSelect.selectOption({ label: 'Dell Latitude E2E' });
  await page.getByLabel('Problema relatado *').fill('Tela não liga no equipamento E2E');
  await page.getByLabel('Valor estimado').fill('1.234,56');
  await page.getByRole('button', { name: 'Salvar ordem' }).click();
  await expect(page).toHaveURL(/\/service-orders\/[^/]+$/);
  await expect(page.getByText('Tela não liga no equipamento E2E')).toBeVisible();
  await expect(page.getByText('Cliente E2E')).toBeVisible();
  await expect(page.getByText('Dell Latitude E2E')).toBeVisible();

  await page.getByRole('link', { name: 'Editar' }).click();
  await expect(page).toHaveURL(/\/service-orders\/[^/]+\/edit$/);
  await page.getByLabel('Problema relatado *').fill('Tela não liga após atualização E2E');
  await page.getByLabel('Valor final').fill('250,75');
  await page.getByRole('button', { name: 'Salvar ordem' }).click();
  await expect(page).toHaveURL(/\/service-orders\/[^/]+$/);
  await expect(page.getByText('Tela não liga após atualização E2E')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Tela não liga após atualização E2E')).toBeVisible();
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('shows protected navigation and required-field validation without sending invalid data', async ({ page, request }) => {
  await login(page, request);
  await page.getByRole('link', { name: 'Clientes' }).click();
  await page.getByRole('link', { name: 'Novo cliente' }).click();
  await page.getByRole('button', { name: 'Salvar cliente' }).click();

  await expect(page.getByRole('alert')).toContainText('Informe um nome válido');
  await expect(page).toHaveURL(/\/customers\/new$/);
});
