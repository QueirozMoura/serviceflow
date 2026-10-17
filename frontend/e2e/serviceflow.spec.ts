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

  // Listas paginadas pelo servidor: 24 clientes novos + o criado acima = 25 (duas paginas de 20).
  for (let index = 1; index <= 24; index += 1) {
    const created = await page.request.post('/api/customers', { data: { name: `Lote ${String(index).padStart(2, '0')}`, phone: `1190000${String(index).padStart(4, '0')}` } });
    expect(created.status()).toBe(201);
  }
  const listRequests: string[] = [];
  const onRequest = (request: { url(): string }) => { const url = new URL(request.url()); if (url.pathname === '/api/customers') listRequests.push(url.search); };
  page.on('request', onRequest);
  await page.goto('/customers');
  await expect(page.getByText('Mostrando 1–20 de 25 clientes')).toBeVisible();
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(21);
  await expect(page.getByRole('link', { name: 'Lote 24', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cliente E2E', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Anterior/ })).toBeDisabled();

  await page.getByRole('button', { name: /Próxima/ }).click();
  await expect(page.getByText('Mostrando 21–25 de 25 clientes')).toBeVisible();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cliente E2E', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lote 01', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lote 24', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Próxima/ })).toBeDisabled();

  // A busca acontece no servidor, ignora maiusculas e volta para a primeira pagina.
  await page.getByLabel('Buscar cliente por nome, telefone ou email').fill('LOTE 1');
  await expect(page.getByText('Mostrando 1–10 de 10 clientes')).toBeVisible();
  await expect(page.getByText('Página 1 de 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lote 10', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lote 24', exact: true })).toHaveCount(0);
  await page.getByLabel('Buscar cliente por nome, telefone ou email').fill('nao existe');
  await expect(page.getByText('Nenhum cliente corresponde à busca.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByText('Mostrando 1–20 de 25 clientes')).toBeVisible();
  page.off('request', onRequest);
  // Cada tela pede apenas uma pagina por vez, com os parametros no servidor (em desenvolvimento o StrictMode dobra a montagem).
  expect(listRequests.length).toBeGreaterThanOrEqual(5);
  expect(listRequests.every((search) => /page=\d+&pageSize=20/.test(search))).toBe(true);
  expect(listRequests.some((search) => search.includes('page=2'))).toBe(true);
  expect(listRequests.some((search) => search.includes('q=LOTE+1'))).toBe(true);

  // Busca e filtro de status das ordens de servico tambem no servidor.
  await page.goto('/service-orders');
  await expect(page.getByText('1 ordem', { exact: true })).toBeVisible();
  await page.getByLabel('Filtrar por status').selectOption('DELIVERED');
  await expect(page.getByText('Nenhuma OS encontrada para essa busca.')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByText('1 ordem', { exact: true })).toBeVisible();
  await page.getByLabel('Buscar OS, cliente ou equipamento').fill('Cliente E2E');
  await expect(page.getByText('1 ordem', { exact: true })).toBeVisible();

  // Os seletores dos formularios continuam com a lista COMPLETA de clientes (nao so a primeira pagina).
  await page.goto('/service-orders/new');
  await expect(page.getByLabel('Cliente *').locator('option')).toHaveCount(26);
  await expect(page.getByLabel('Cliente *')).toContainText('Lote 01');
  await expect(page.getByLabel('Cliente *')).toContainText('Cliente E2E');

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
  // Itens definem o preco (e o total): o tecnico nao os cria; isso fica para o ADMIN, mais abaixo.
  const item = { description: 'Teclado', quantity: '1', unitPrice: '120.00', type: 'PART' };
  expect((await page.request.post(`${quoteUrl}/items`, { data: item })).status()).toBe(403);
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
  expect((await page.request.post(`${quoteUrl}/items`, { data: item })).status()).toBe(201);

  // O ADMIN decide o orcamento, aprova e cancela a OS, pela interface e pela API.
  await page.reload();
  for (const name of ['Aprovado', 'Rejeitado', 'Expirado']) await expect(page.getByRole('button', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Aprovado' }).click();
  await expect(page.getByRole('button', { name: 'Aprovado' })).toHaveCount(0);
  expect((await page.request.get(quoteUrl)).status()).toBe(200);
  // Aprovar o orcamento de uma OS que aguarda aprovacao a aprova na mesma operacao: nao ha mais o botao "Aprovada".
  await expect(page.getByRole('button', { name: 'Aprovada' })).toHaveCount(0);
  await expect((await page.request.get(`${api}/service-orders/${serviceOrder.id}`)).json()).resolves.toMatchObject({ serviceOrder: { status: 'APPROVED' } });
  // Pagamentos exigem valor devido definido e Idempotency-Key; ficam PENDING (nao impedem cancelar) e precisam existir
  // antes de cancelar, pois uma OS cancelada nao aceita novos pagamentos.
  expect((await page.request.patch(`${api}/service-orders/${serviceOrder.id}`, { data: { finalValue: '80.00' } })).status()).toBe(200);
  expect((await page.request.post(`${api}/service-orders/${serviceOrder.id}/payments`, { data: { amount: '80.00', method: 'PIX' }, headers: { 'Idempotency-Key': 'e2e-module-payment-0001' } })).status()).toBe(201);
  await page.reload();
  await page.getByRole('button', { name: 'Cancelada' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Excluir' }).click();
  await expect(page.getByText('Status alterado para Cancelada.')).toBeVisible();

  // Telas de modulo: uma requisicao agregada por tela e nenhuma chamada por OS.
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

  // Orcamentos paginados: mais 21 OS com orcamento (22 no total) => duas paginas; filtro e totais vem do servidor.
  for (let index = 1; index <= 21; index += 1) {
    const extra = await page.request.post(`${api}/service-orders`, { data: { customerId: customer.customer.id, equipmentId: equipment.equipment.id, problemDescription: `Lote ${index}` } });
    expect(extra.status()).toBe(201);
    expect((await page.request.post(`${api}/service-orders/${(await extra.json()).serviceOrder.id}/quote`, { data: {} })).status()).toBe(201);
  }
  await page.goto('/quotes');
  await expect(page.getByText('Mostrando 1–20 de 22 registros')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(21);
  await expect(page.getByText('Aguardando aprovação').first()).toBeVisible();
  await page.getByRole('button', { name: /Próxima/ }).click();
  await expect(page.getByText('Mostrando 21–22 de 22 registros')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(3);
  await page.getByLabel('Filtrar por status').selectOption('APPROVED');
  await expect(page.getByText('Mostrando 1–1 de 1 registro')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(serviceOrder.orderNumber) })).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByText('Mostrando 1–20 de 22 registros')).toBeVisible();
});

test('signs up by email, invites a technician through a link, and the invite works exactly once', async ({ page, browser }) => {
  const owner = createAccount();

  // Cadastro pela interface: cria a organizacao e o OWNER e ja entra.
  await page.goto('/login');
  await page.getByRole('link', { name: 'Criar conta' }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await page.getByLabel('Nome da empresa').fill(owner.organizationName);
  await page.getByLabel('Seu nome').fill(owner.name);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Senha', { exact: true }).fill(owner.password);
  await page.getByLabel('Confirmar senha').fill(owner.password);
  await page.getByRole('button', { name: /^Criar conta/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // O OWNER gera o convite; o link aparece uma unica vez (nenhum email e enviado).
  await page.getByRole('link', { name: 'Equipe' }).click();
  await expect(page).toHaveURL(/\/team$/);
  const invitee = `tecnico-${Date.now()}@example.com`;
  await page.getByLabel('Email do convidado').fill(invitee);
  await page.getByRole('button', { name: /Criar convite/ }).click();
  const link = await page.getByLabel('Link do convite').inputValue();
  expect(link).toMatch(/\/invite#t=[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole('row', { name: new RegExp(invitee) })).toBeVisible();

  // O convidado abre o link em outra sessao, aceita e entra como TECNICO (sem gestao de equipe).
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(link);
  await expect(guestPage.getByText(owner.organizationName)).toBeVisible();
  await expect(guestPage.getByLabel('Email')).toHaveValue(invitee);
  await expect(guestPage).not.toHaveURL(/#t=/);
  await guestPage.getByLabel('Seu nome').fill('Tecnico Convidado');
  await guestPage.getByLabel('Crie uma senha').fill('StrongPass1');
  await guestPage.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(guestPage).toHaveURL(/\/dashboard$/);
  await expect(guestPage.getByRole('link', { name: 'Clientes' })).toBeVisible();
  await expect(guestPage.getByRole('link', { name: 'Equipe' })).toHaveCount(0);
  await guestPage.goto('/team');
  await expect(guestPage.getByText('Você não tem permissão para acessar esta página.')).toBeVisible();
  await guest.close();

  // O link nao funciona uma segunda vez e o OWNER ve o novo membro, sem convites pendentes.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(link);
  await expect(strangerPage.getByText(/não é válido ou expirou/)).toBeVisible();
  await stranger.close();
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(`Tecnico Convidado ${invitee}`) })).toBeVisible();
  await expect(page.getByText('Nenhum convite pendente.')).toBeVisible();
});

test('recovers a forgotten password by e-mail link: old password and sessions stop working, the link works once', async ({ page, browser, request }) => {
  const account = createAccount();
  await registerAccount(request, account);

  // Sessao aberta em outro navegador: precisa cair apos a troca de senha.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto('/login');
  await otherPage.getByLabel('Email').fill(account.email);
  await otherPage.getByLabel('Senha').fill(account.password);
  await otherPage.getByRole('button', { name: /^Entrar/ }).click();
  await expect(otherPage).toHaveURL(/\/dashboard$/);

  await page.goto('/login');
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel('Email').fill(account.email);
  await page.getByRole('button', { name: /Enviar instruções/ }).click();
  await expect(page.getByText(/Se existir uma conta com este email/)).toBeVisible();

  // O "e-mail" chega na caixa de saida de desenvolvimento (o envio real so existe com um provedor configurado).
  let link = '';
  await expect.poll(async () => {
    const outbox = (await (await request.get('http://127.0.0.1:3333/api/dev/mail-outbox')).json()) as { messages: Array<{ to: string; text: string }> };
    link = /(https?:\/\/\S+\/reset-password#t=[A-Za-z0-9_-]+)/.exec(outbox.messages.find((message) => message.to === account.email)?.text ?? '')?.[1] ?? '';
    return link;
  }).not.toBe('');

  const newPassword = 'BrandNewPass9';
  await page.goto(link);
  await page.getByLabel('Nova senha', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirmar nova senha').fill(newPassword);
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  await expect(page.getByText(/Senha alterada com sucesso/)).toBeVisible();
  await expect(page).not.toHaveURL(/dashboard/);

  // A sessao antiga caiu; a senha antiga nao entra; a nova entra.
  await otherPage.reload();
  await expect(otherPage).toHaveURL(/\/login/);
  await other.close();
  await page.goto('/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Senha').fill(account.password);
  await page.getByRole('button', { name: /^Entrar/ }).click();
  await expect(page.getByText('Email ou senha inválidos.')).toBeVisible();
  await page.getByLabel('Senha').fill(newPassword);
  await page.getByRole('button', { name: /^Entrar/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // O mesmo link nao funciona uma segunda vez.
  const again = await browser.newContext();
  const againPage = await again.newPage();
  await againPage.goto(link);
  await expect(againPage.getByText(/não é válido ou expirou/)).toBeVisible();
  await again.close();
});
