import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { setUserRole } from './database';

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

async function login(page: Page, request: APIRequestContext, role?: 'ADMIN' | 'TECHNICIAN'): Promise<ReturnType<typeof createAccount>> {
  const account = createAccount();
  await registerAccount(request, account);
  if (role) setUserRole(account.email, role);
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
  // A lista vazia mostra um segundo link "Novo cliente"; .first() evita ambiguidade conforme o momento do carregamento.
  await page.getByRole('link', { name: 'Novo cliente' }).first().click();
  await page.getByRole('button', { name: 'Salvar cliente' }).click();

  await expect(page.getByRole('alert')).toContainText('Informe um nome válido');
  await expect(page).toHaveURL(/\/customers\/new$/);
});

test('registers and edits a diagnosis and respects the server rule when deleting an order', async ({ page, request }) => {
  await login(page, request);
  // Mesmo proxy do frontend, para reutilizar o cookie de sessão do navegador.
  const api = '/api';
  const customer = await (await page.request.post(`${api}/customers`, { data: { name: 'Cliente Diagnóstico E2E', phone: '11977776666' } })).json();
  const equipment = await (await page.request.post(`${api}/equipment`, { data: { customerId: customer.customer.id, type: 'Notebook', brand: 'Lenovo', model: 'ThinkPad E2E' } })).json();
  const created = await page.request.post(`${api}/service-orders`, { data: { customerId: customer.customer.id, equipmentId: equipment.equipment.id, problemDescription: 'Não carrega a bateria' } });
  expect(created.status()).toBe(201);
  const { serviceOrder } = await created.json();

  await page.goto(`/service-orders/${serviceOrder.id}`);
  await expect(page.getByText('Nenhum diagnóstico cadastrado.')).toBeVisible();
  await page.getByRole('button', { name: 'Adicionar diagnóstico' }).click();
  await page.getByRole('button', { name: 'Salvar diagnóstico' }).click();
  await expect(page.getByRole('alert')).toContainText('pelo menos 2 caracteres');
  await page.getByLabel('Descrição do diagnóstico *').fill('Circuito de carga danificado');
  await page.getByLabel('Custo estimado').fill('1.234,56');
  await page.getByRole('button', { name: 'Salvar diagnóstico' }).click();
  await expect(page.getByText('Circuito de carga danificado')).toBeVisible();
  await expect(page.getByText(/Custo estimado: R\$\s1\.234,56/)).toBeVisible();

  await page.getByRole('button', { name: 'Editar diagnóstico' }).click();
  await page.getByLabel('Descrição do diagnóstico *').fill('Circuito de carga e conector danificados');
  await page.getByRole('button', { name: 'Salvar diagnóstico' }).click();
  await expect(page.getByText('Circuito de carga e conector danificados')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Circuito de carga e conector danificados')).toBeVisible();
  await expect(page.getByText(/Custo estimado: R\$\s1\.234,56/)).toBeVisible();

  await page.getByRole('button', { name: 'Excluir OS' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Toda OS recebe histórico de status com FK RESTRICT; o backend responde 409 e a OS deve permanecer.
  await page.getByRole('button', { name: 'Excluir OS' }).click();
  const deletion = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().endsWith(`/api/service-orders/${serviceOrder.id}`));
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
  expect((await deletion).status()).toBe(409);
  await expect(page.getByText(/possui histórico ou registros vinculados/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/service-orders/${serviceOrder.id}$`));
  expect((await page.request.get(`${api}/service-orders/${serviceOrder.id}`)).status()).toBe(200);
});

test('shows the profile, renames the user everywhere and persists after reload', async ({ page, request }) => {
  const account = await login(page, request);
  await page.getByRole('link', { name: 'Meu perfil' }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByLabel(/^Nome/)).toHaveValue('E2E Owner');
  await expect(page.getByLabel('E-mail')).toHaveValue(account.email);
  await expect(page.getByLabel('E-mail')).toBeDisabled();
  await expect(page.getByLabel('Papel')).toHaveValue('Proprietário');

  await page.getByLabel(/^Nome/).fill('A');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('alert')).toContainText('pelo menos 2 caracteres');

  await page.getByLabel(/^Nome/).fill('Maria E2E');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Perfil atualizado.')).toBeVisible();
  await expect(page.locator('.sidebar-footer').getByText('Maria E2E')).toBeVisible();
  await expect(page.locator('.header-user').getByText('Maria E2E')).toBeVisible();

  // O backend recusa campos protegidos mesmo que o cliente os envie.
  const protectedAttempt = await page.request.patch('/api/auth/me', { data: { name: 'Hacker', role: 'ADMIN', email: 'x@example.com' } });
  expect(protectedAttempt.status()).toBe(400);

  await page.reload();
  await expect(page.getByLabel(/^Nome/)).toHaveValue('Maria E2E');
  await expect(page.getByLabel('E-mail')).toHaveValue(account.email);
  await expect(page.getByLabel('Papel')).toHaveValue('Proprietário');
});

test('applies role permissions: a technician is restricted and an admin promoted in the database gains access', async ({ page, request }) => {
  const account = await login(page, request, 'TECHNICIAN');
  const api = '/api';
  const customer = await (await page.request.post(`${api}/customers`, { data: { name: 'Cliente Papel E2E', phone: '11966665555' } })).json();
  const equipment = await (await page.request.post(`${api}/equipment`, { data: { customerId: customer.customer.id, type: 'Notebook', brand: 'Acer', model: 'Aspire E2E' } })).json();
  const created = await page.request.post(`${api}/service-orders`, { data: { customerId: customer.customer.id, equipmentId: equipment.equipment.id, problemDescription: 'Teclado sem resposta' } });
  expect(created.status()).toBe(201);
  const { serviceOrder } = await created.json();

  // Menu e rota: sem pagamentos.
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Clientes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pagamentos' })).toHaveCount(0);
  await expect(page.getByText('Total recebido')).toHaveCount(0);
  await page.goto('/payments');
  await expect(page.getByText('Você não tem permissão para acessar esta página.')).toBeVisible();

  // Listas sem exclusao.
  await page.goto('/customers');
  await expect(page.getByText('Cliente Papel E2E')).toBeVisible();
  await expect(page.getByRole('button', { name: /Excluir/ })).toHaveCount(0);

  // Detalhes da OS: sem excluir e sem pagamentos, mas o diagnostico funciona.
  await page.goto(`/service-orders/${serviceOrder.id}`);
  await expect(page.getByText('Teclado sem resposta')).toBeVisible();
  await expect(page.getByRole('button', { name: /Excluir/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Pagamentos' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adicionar diagnóstico' }).click();
  await page.getByLabel('Descrição do diagnóstico *').fill('Flat do teclado solto');
  await page.getByRole('button', { name: 'Salvar diagnóstico' }).click();
  await expect(page.getByText('Flat do teclado solto')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir diagnóstico' })).toHaveCount(0);

  // Historico de comunicacao: o tecnico registra um rascunho; o sistema nao envia nada.
  await expect(page.getByText('Nenhuma mensagem registrada para esta OS.')).toBeVisible();
  await expect(page.getByText(/Envio automático ainda não disponível/)).toBeVisible();
  await page.getByRole('button', { name: 'Gerar mensagem' }).click();
  await expect(page.getByText(/Recebemos seu Notebook Acer Aspire E2E/)).toBeVisible();
  await page.getByRole('button', { name: 'Registrar no histórico' }).click();
  const history = page.getByRole('list', { name: 'Histórico de comunicação' });
  await expect(history.getByText('Rascunho · não enviada pelo sistema')).toBeVisible();
  await expect(history.getByText('WhatsApp · OS recebida')).toBeVisible();
  await expect(history.getByText(/Destinatário: Cliente Papel E2E/)).toBeVisible();
  await page.reload();
  await expect(history.getByText('Rascunho · não enviada pelo sistema')).toBeVisible();
  await expect(history.getByText(/enviada\b/i).filter({ hasNotText: 'não enviada' })).toHaveCount(0);
  const historyUrl = `${api}/service-orders/${serviceOrder.id}/messages/history`;
  expect((await page.request.post(historyUrl, { data: { type: 'SERVICE_RECEIVED', channel: 'WHATSAPP', content: 'texto forjado', status: 'SENT', organizationId: 'x' } })).status()).toBe(400);
  expect((await page.request.post(historyUrl, { data: { type: 'SERVICE_RECEIVED', channel: 'EMAIL' } })).status()).toBe(409);
  expect((await page.request.get(`${api}/service-orders/00000000-0000-4000-8000-000000000000/messages/history`)).status()).toBe(404);
  const keyed = { data: { type: 'SERVICE_READY', channel: 'WHATSAPP' }, headers: { 'Idempotency-Key': 'e2e-idempotency-0001' } };
  const first = await page.request.post(historyUrl, keyed);
  const repeated = await page.request.post(historyUrl, keyed);
  expect([first.status(), repeated.status()]).toEqual([201, 200]);
  expect((await repeated.json()).message.id).toBe((await first.json()).message.id);
  const listed = await (await page.request.get(historyUrl)).json();
  expect(listed.messages).toHaveLength(2);
  expect(listed.sendingAvailable).toBe(false);
  expect(listed.messages.every((message: { status: string }) => message.status === 'DRAFT')).toBe(true);

  // O backend recusa mesmo contornando a interface (e nao vaza se o recurso existe).
  const missing = '00000000-0000-4000-8000-000000000000';
  for (const [method, url] of [['delete', `${api}/service-orders/${serviceOrder.id}`], ['delete', `${api}/service-orders/${missing}`], ['delete', `${api}/customers/${customer.customer.id}`], ['delete', `${api}/service-orders/${serviceOrder.id}/diagnosis`], ['get', `${api}/service-orders/${serviceOrder.id}/payments`], ['post', `${api}/service-orders/${serviceOrder.id}/payments`]] as const) {
    const response = await page.request[method](url, method === 'post' ? { data: { amount: '10.00', method: 'PIX' } } : {});
    expect(response.status(), `${method.toUpperCase()} ${url}`).toBe(403);
  }
  const forged = await page.request.delete(`${api}/customers/${customer.customer.id}`, { headers: { 'x-user-role': 'OWNER' }, data: { role: 'OWNER' } });
  expect(forged.status()).toBe(403);
  expect((await page.request.patch(`${api}/auth/me`, { data: { name: 'Tecnico', role: 'OWNER' } })).status()).toBe(400);
  expect((await page.request.get(`${api}/service-orders/${serviceOrder.id}`)).status()).toBe(200);

  // Regras de status: o tecnico avanca a OS e consulta/edita o orcamento, mas nao aprova nem cancela a OS e nao decide o orcamento.
  const quoteUrl = `${api}/service-orders/${serviceOrder.id}/quote`;
  expect((await page.request.post(quoteUrl, { data: {} })).status()).toBe(201);
  expect((await page.request.post(`${quoteUrl}/items`, { data: { description: 'Teclado', quantity: '1', unitPrice: '120.00', type: 'PART' } })).status()).toBe(201);
  expect((await page.request.get(quoteUrl)).status()).toBe(200);
  expect((await page.request.patch(`${api}/service-orders/${serviceOrder.id}/status`, { data: { status: 'DELIVERED' } })).status()).toBe(409);
  expect((await page.request.patch(`${api}/service-orders/${serviceOrder.id}/status`, { data: { status: 'WAITING_DIAGNOSIS' } })).status()).toBe(200);
  await page.goto(`/service-orders/${serviceOrder.id}`);
  await expect(page.getByRole('button', { name: 'Aguardando aprovação' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelada' })).toHaveCount(0);
  for (const name of ['Aprovado', 'Rejeitado', 'Expirado']) await expect(page.getByRole('button', { name })).toHaveCount(0);
  const orderStatusUrl = `${api}/service-orders/${serviceOrder.id}/status`;
  for (const [url, status] of [[orderStatusUrl, 'CANCELLED'], [orderStatusUrl, 'APPROVED'], [`${quoteUrl}/status`, 'APPROVED'], [`${quoteUrl}/status`, 'REJECTED'], [`${quoteUrl}/status`, 'EXPIRED'], [`${api}/service-orders/${serviceOrder.id}/warranty/status`, 'EXPIRED']] as const) {
    const response = await page.request.patch(url, { data: { status } });
    expect(response.status(), `${url} -> ${status}`).toBe(403);
  }
  // Na etapa de aprovacao o tecnico nao tem acao: a interface avisa que depende de um administrador.
  expect((await page.request.patch(orderStatusUrl, { data: { status: 'WAITING_APPROVAL' } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByText('A próxima etapa requer um administrador')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aprovada' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancelada' })).toHaveCount(0);

  // Listagens agregadas: o tecnico le orcamentos e garantias, mas nunca pagamentos (nem pela rota agregada).
  expect((await page.request.get(`${api}/quotes`)).status()).toBe(200);
  expect((await page.request.get(`${api}/warranties`)).status()).toBe(200);
  const aggregatedPayments = await page.request.get(`${api}/payments?organizationId=forjado`);
  expect(aggregatedPayments.status()).toBe(403);
  expect(await aggregatedPayments.text()).not.toContain('Teclado');

  // Promovido a ADMIN no banco: a mesma sessao passa a ter pagamentos e exclusao apos recarregar.
  setUserRole(account.email, 'ADMIN');
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Pagamentos' })).toBeVisible();
  await page.getByRole('link', { name: 'Pagamentos' }).click();
  await expect(page.getByRole('heading', { name: 'Pagamentos' })).toBeVisible();
  await page.goto(`/service-orders/${serviceOrder.id}`);
  await expect(page.getByRole('heading', { name: 'Pagamentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excluir diagnóstico' })).toBeVisible();
  // O historico registrado pelo tecnico continua visivel (mesma organizacao) para o ADMIN, com o autor correto.
  await expect(page.getByRole('list', { name: 'Histórico de comunicação' }).getByText(/Registrada por E2E Owner/).first()).toBeVisible();
  expect((await page.request.get(`${api}/service-orders/${serviceOrder.id}/payments`)).status()).toBe(200);
  expect((await page.request.delete(`${api}/service-orders/${serviceOrder.id}/diagnosis`)).status()).toBe(204);

  // O ADMIN decide o orcamento, aprova e cancela a OS, pela interface e pela API.
  await page.reload();
  for (const name of ['Aprovado', 'Rejeitado', 'Expirado']) await expect(page.getByRole('button', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovado' }).click();
  await expect(page.getByRole('button', { name: 'Aprovado' })).toHaveCount(0);
  expect((await page.request.get(quoteUrl)).status()).toBe(200);
  await page.getByRole('button', { name: 'Aprovada' }).click();
  await expect(page.getByText('Status alterado para Aprovada.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelada' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText('Status alterado para Cancelada.')).toBeVisible();

  // Telas de modulo: uma requisicao agregada por tela e nenhuma chamada por OS.
  expect((await page.request.post(`${api}/service-orders/${serviceOrder.id}/payments`, { data: { amount: '80.00', method: 'PIX' } })).status()).toBe(201);
  for (const [path, heading, aggregated] of [['/quotes', 'Orçamentos', '/api/quotes'], ['/payments', 'Pagamentos', '/api/payments'], ['/warranties', 'Garantias', '/api/warranties']] as const) {
    const requested: string[] = [];
    const onRequest = (request: { url(): string }) => { if (request.url().includes('/api/')) requested.push(new URL(request.url()).pathname); };
    page.on('request', onRequest);
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    if (path === '/warranties') await expect(page.getByText('Nenhuma garantia cadastrada.')).toBeVisible();
    else await expect(page.getByRole('row', { name: new RegExp(serviceOrder.orderNumber) })).toBeVisible();
    page.off('request', onRequest);

    const perOrder = requested.filter((pathname) => /^\/api\/service-orders(\/|$)/.test(pathname) && pathname !== '/api/service-orders/');
    expect(perOrder, `${path}: chamadas por OS`).toEqual([]);
    const calls = requested.filter((pathname) => pathname === aggregated).length;
    // Em desenvolvimento o React StrictMode executa o efeito de montagem duas vezes; em producao e uma.
    expect(calls, `${path}: requisicoes agregadas`).toBeGreaterThanOrEqual(1);
    expect(calls, `${path}: requisicoes agregadas`).toBeLessThanOrEqual(2);
  }
});
