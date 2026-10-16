import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, MessageSquare, Save, Send } from 'lucide-react';
import { ApiError } from '../../services/api';
import { serviceOrdersService } from '../../services/service-orders';
import type { MessageChannel, MessageHistoryItem, MessageResponse } from '../../types/service-order';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ErrorState, Loading } from '../../components/ui/Feedback';
import { Toast } from '../../components/ui/Toast';

const messageTypes: Array<{ value: MessageResponse['type']; label: string }> = [
  { value: 'SERVICE_RECEIVED', label: 'OS recebida' }, { value: 'DIAGNOSIS_READY', label: 'Diagnóstico pronto' }, { value: 'QUOTE_READY', label: 'Orçamento pronto' },
  { value: 'QUOTE_APPROVED', label: 'Orçamento aprovado' }, { value: 'SERVICE_IN_PROGRESS', label: 'Serviço em andamento' }, { value: 'SERVICE_READY', label: 'Serviço pronto' },
  { value: 'SERVICE_DELIVERED', label: 'Serviço entregue' }, { value: 'WARRANTY_CREATED', label: 'Garantia criada' },
];
const channels: Array<{ value: MessageChannel; label: string }> = [{ value: 'WHATSAPP', label: 'WhatsApp' }, { value: 'EMAIL', label: 'E-mail' }];
const typeLabel = (type: string) => messageTypes.find((entry) => entry.value === type)?.label ?? type;
const channelLabel = (channel: string) => channels.find((entry) => entry.value === channel)?.label ?? channel;
const dateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

function generateError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403) return 'Você não tem permissão para esta ação.';
  if (cause instanceof ApiError && cause.status === 409) return 'Faltam dados para gerar este modelo de mensagem.';
  return 'Não foi possível concluir a operação.';
}

function recordError(cause: unknown): string {
  if (cause instanceof ApiError && cause.status === 403) return 'Você não tem permissão para registrar mensagens.';
  if (cause instanceof ApiError && cause.status === 409) return cause.message.toLowerCase().includes('e-mail') ? 'O cliente não tem e-mail cadastrado para este canal.' : 'Faltam dados para registrar este modelo de mensagem.';
  if (cause instanceof ApiError && cause.status === 404) return 'Ordem de serviço não encontrada.';
  return 'Não foi possível registrar a mensagem. Nada foi salvo; tente novamente.';
}

interface CommunicationCardProps { serviceOrderId: string; canGenerate: boolean; canRead: boolean; canWrite: boolean; }

export function CommunicationCard({ serviceOrderId, canGenerate, canRead, canWrite }: CommunicationCardProps) {
  const [messageType, setMessageType] = useState<MessageResponse['type']>('SERVICE_RECEIVED');
  const [message, setMessage] = useState<MessageResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [channel, setChannel] = useState<MessageChannel>('WHATSAPP');
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const [recordError_, setRecordError] = useState('');
  const [history, setHistory] = useState<MessageHistoryItem[]>([]);
  const [historyState, setHistoryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sendingAvailable, setSendingAvailable] = useState(false);
  const [toast, setToast] = useState('');
  // Uma chave por (texto gerado, canal): repetir o mesmo clique devolve o registro existente em vez de duplicar.
  const keyRef = useRef<{ message: MessageResponse; channel: MessageChannel; key: string } | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryState('loading');
    try {
      const response = await serviceOrdersService.getMessageHistory(serviceOrderId);
      setHistory(response.messages); setSendingAvailable(response.sendingAvailable); setHistoryState('ready');
    } catch { setHistoryState('error'); }
  }, [serviceOrderId]);
  useEffect(() => { if (canRead) void loadHistory(); }, [canRead, loadHistory]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true); setRecordError('');
    try { setMessage(await serviceOrdersService.generateMessage(serviceOrderId, messageType)); setToast('Mensagem gerada.'); }
    catch (cause) { setToast(generateError(cause)); }
    finally { setGenerating(false); }
  };
  const copy = async () => { if (message) { await navigator.clipboard.writeText(message.message); setToast('Mensagem copiada.'); } };

  const record = async () => {
    if (!message || recordingRef.current) return;
    recordingRef.current = true; setRecording(true); setRecordError('');
    if (!keyRef.current || keyRef.current.message !== message || keyRef.current.channel !== channel) keyRef.current = { message, channel, key: crypto.randomUUID() };
    try {
      const response = await serviceOrdersService.recordMessage(serviceOrderId, { type: message.type, channel }, keyRef.current.key);
      const alreadyListed = history.some((item) => item.id === response.message.id);
      setHistory((current) => (current.some((item) => item.id === response.message.id) ? current : [response.message, ...current]));
      setSendingAvailable(response.sendingAvailable);
      setToast(alreadyListed ? 'Esse rascunho já estava registrado.' : 'Rascunho registrado no histórico.');
    } catch (cause) { setRecordError(recordError(cause)); }
    finally { recordingRef.current = false; setRecording(false); }
  };

  return <Card className="full-detail-card">
    <div className="section-heading"><h3>Comunicação</h3><MessageSquare size={18} /></div>
    {canGenerate ? <div className="message-controls">
      <select value={messageType} onChange={(event) => setMessageType(event.target.value as MessageResponse['type'])} aria-label="Modelo de mensagem">{messageTypes.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
      <Button className="button-primary" onClick={() => void generate()} disabled={generating}><Send size={16} />{generating ? 'Gerando...' : 'Gerar mensagem'}</Button>
    </div> : null}
    {message ? <div className="generated-message">
      <p>{message.message}</p>
      <div className="message-actions">
        <Button className="button-secondary button-small" onClick={() => void copy()}><Copy size={15} /> Copiar</Button>
        {canWrite ? <>
          <select value={channel} onChange={(event) => { setChannel(event.target.value as MessageChannel); setRecordError(''); }} aria-label="Canal da mensagem">{channels.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}</select>
          <Button className="button-secondary button-small" onClick={() => void record()} disabled={recording}><Save size={15} />{recording ? 'Registrando...' : 'Registrar no histórico'}</Button>
        </> : null}
      </div>
      {canWrite ? <p className="muted message-notice">Registrar guarda um rascunho no histórico; o ServiceFlow não envia a mensagem. Copie o texto e envie pelo canal escolhido.</p> : null}
      {recordError_ ? <p className="form-error" role="alert">{recordError_}</p> : null}
    </div> : null}
    {canRead ? <div className="message-history">
      <h4>Histórico de comunicação</h4>
      {!sendingAvailable && historyState === 'ready' ? <p className="muted message-notice">Envio automático ainda não disponível: as mensagens abaixo são rascunhos registrados no sistema e não foram enviadas por ele.</p> : null}
      {historyState === 'loading' ? <Loading message="Carregando histórico..." /> : historyState === 'error' ? <ErrorState message="Não foi possível carregar o histórico de comunicação." actionLabel="Tentar novamente" onAction={() => void loadHistory()} /> : history.length === 0 ? <p className="muted">Nenhuma mensagem registrada para esta OS.</p> : <ul className="message-history-list" aria-label="Histórico de comunicação">{history.map((item) => <li className="message-history-item" key={item.id}>
        <div className="message-history-meta"><span className="badge badge-draft">Rascunho · não enviada pelo sistema</span><strong>{channelLabel(item.channel)} · {typeLabel(item.type)}</strong><time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></div>
        <p>{item.content}</p>
        <small className="muted">Registrada por {item.createdBy.name} · Destinatário: {item.recipient.name}</small>
      </li>)}</ul>}
    </div> : null}
    {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
  </Card>;
}
