import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Shield, AlertTriangle, AlertCircle } from 'lucide-react';
import { api, demoTryWrite } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { useToast } from '../components/Toast.jsx';

const RULE_TYPE_INFO = {
  'no-overlap': {
    label: 'Sem sobreposição',
    description: 'Impede cadastrar uma subnet que se sobrepõe a outra já existente.',
    example: 'Bloqueia criar 10.0.1.0/24 se já existe 10.0.0.0/16. Evita conflito de CIDR — a dor de cabeça nº1.',
    configHint: '{ "scope": "site" | "global" }',
    defaultConfig: { scope: 'site' },
  },
  'within-master': {
    label: 'Dentro de um range mestre',
    description: 'Exige que a subnet esteja contida em um Master Range aprovado (cadastrado em Catálogos).',
    example: 'Só permite subnets dentro de 10.0.0.0/8 — barra um 192.168.x criado por engano.',
    configHint: '{ "allowedCategories": ["..."] } (opcional)',
    defaultConfig: {},
  },
  'size-range': {
    label: 'Tamanho permitido',
    description: 'Limita o tamanho (prefixo) da subnet a uma faixa mínima e máxima.',
    example: 'minPrefix 16 / maxPrefix 30 → barra um /8 gigante ou um /31 minúsculo demais.',
    configHint: '{ "minPrefix": 16, "maxPrefix": 30 }',
    defaultConfig: { minPrefix: 16, maxPrefix: 30 },
  },
  'name-pattern': {
    label: 'Padrão de nome',
    description: 'Exige que o nome da subnet siga um padrão (regex) — força convenção de nomenclatura.',
    example: 'Padrão ^(prod|dev|hml)- → aceita "prod-web", rejeita "minha rede".',
    configHint: '{ "pattern": "^(prod|dev|hml)-" }',
    defaultConfig: { pattern: '^[a-z]+-[a-z0-9-]+$' },
  },
};

export default function ValidationRules() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: rules = [], isLoading } = useQuery({ queryKey: ['validation-rules'], queryFn: api.validationRules });
  const [modal, setModal] = useState({ open: false, rule: null });
  const [confirm, setConfirm] = useState({ open: false, id: null, label: '' });

  const inv = () => qc.invalidateQueries({ queryKey: ['validation-rules'] });
  const createMut = useMutation({ mutationFn: api.createValidationRule, onSuccess: () => { inv(); toast.success('Regra criada.'); setModal({ open: false, rule: null }); }, onError: (e) => toast.error(e.message) });
  const updateMut = useMutation({ mutationFn: ({ id, data }) => api.updateValidationRule(id, data), onSuccess: () => { inv(); toast.success('Regra atualizada.'); setModal({ open: false, rule: null }); }, onError: (e) => toast.error(e.message) });
  const deleteMut = useMutation({ mutationFn: api.deleteValidationRule, onSuccess: () => { inv(); toast.success('Regra removida.'); setConfirm({ open: false, id: null, label: '' }); } });
  const toggleMut = useMutation({ mutationFn: ({ id, enabled }) => api.updateValidationRule(id, { enabled }), onSuccess: () => inv() });

  return (
    <div>
      <PageHeader
        title="Regras de validação"
        description="Regras rodam antes de criar ou alterar uma subnet. Erros bloqueiam; warnings só avisam."
        actions={
          <button onClick={() => { if (demoTryWrite()) return; setModal({ open: true, rule: null }); }} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={14} /> Nova regra
          </button>
        }
      />

      <div className="card p-4 mb-4 bg-slate-50/60 dark:bg-slate-800/30 border-slate-200">
        <div className="flex items-start gap-3">
          <Shield size={18} className="text-brand-500 mt-0.5 shrink-0" />
          <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1">
            <p>
              <strong>Como funciona:</strong> toda vez que alguém cria ou edita uma subnet, o Bagre
              roda as regras ativas antes de salvar.
            </p>
            <p>
              <span className="font-medium text-rose-600">Erro</span> = bloqueia a operação ·{' '}
              <span className="font-medium text-amber-600">Warning</span> = só avisa e deixa seguir.
              Cada regra pode valer <strong>globalmente</strong> ou só em <strong>sites específicos</strong> (escopo).
            </p>
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Carregando…</div>}

      {!isLoading && rules.length === 0 && (
        <div className="card p-8 text-center">
          <Shield size={36} className="mx-auto text-slate-300 mb-3" />
          <h3 className="font-semibold mb-1">Nenhuma regra cadastrada</h3>
          <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
            Sem regras, qualquer ADMIN pode criar qualquer subnet sem checks. Adicione pelo menos uma <strong>no-overlap</strong> pra evitar conflitos acidentais.
          </p>
          <button onClick={() => { if (demoTryWrite()) return; setModal({ open: true, rule: null }); }} className="btn-primary inline-flex items-center gap-1.5">
            <Plus size={14} /> Adicionar primeira regra
          </button>

          <div className="mt-8 text-left max-w-2xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Tipos de regra disponíveis</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Object.entries(RULE_TYPE_INFO).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                  <div className="font-medium text-sm">{v.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{v.description}</div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 italic">Ex: {v.example}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm table-zebra">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left w-12">Status</th>
                <th className="px-3 py-2 text-left">Nome</th>
                <th className="px-3 py-2 text-left">Tipo</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-left">Escopo</th>
                <th className="px-3 py-2 text-left">Config</th>
                <th className="px-3 py-2 w-24 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rules.map((r) => {
                const info = RULE_TYPE_INFO[r.ruleType] || { label: r.ruleType };
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={r.enabled} onChange={(e) => toggleMut.mutate({ id: r.id, enabled: e.target.checked })} className="accent-brand-600 cursor-pointer" />
                    </td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{info.label}</span>
                    </td>
                    <td className="px-3 py-2">
                      {r.severity === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-700"><AlertCircle size={11} /> error</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-700"><AlertTriangle size={11} /> warning</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{r.scope || 'global'}</td>
                    <td className="px-3 py-2 text-[11px] font-mono text-slate-600">{JSON.stringify(r.config)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => { if (demoTryWrite()) return; setModal({ open: true, rule: r }); }} className="text-slate-400 hover:text-brand-600 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title="Editar"><Pencil size={14} /></button>
                      <button onClick={() => { if (demoTryWrite()) return; setConfirm({ open: true, id: r.id, label: r.name }); }} className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30 ml-1" title="Excluir"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <RuleFormModal
        open={modal.open}
        rule={modal.rule}
        loading={createMut.isPending || updateMut.isPending}
        onClose={() => setModal({ open: false, rule: null })}
        onSubmit={(data) => {
          if (modal.rule) updateMut.mutate({ id: modal.rule.id, data });
          else createMut.mutate(data);
        }}
      />

      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm({ open: false, id: null, label: '' })}
        title="Excluir regra"
        message={<>Tem certeza que quer excluir a regra <strong>{confirm.label}</strong>?</>}
        confirmLabel="Excluir"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate(confirm.id)}
      />
    </div>
  );
}

function RuleFormModal({ open, rule, onClose, onSubmit, loading }) {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState('no-overlap');
  const [scope, setScope] = useState('');
  const [severity, setSeverity] = useState('error');
  const [configText, setConfigText] = useState('{}');
  const [err, setErr] = useState(null);

  // Reset on open / when editing
  useState(() => {
    if (open) {
      if (rule) {
        setName(rule.name);
        setRuleType(rule.ruleType);
        setScope(rule.scope || '');
        setSeverity(rule.severity || 'error');
        setConfigText(JSON.stringify(rule.config || {}, null, 2));
      } else {
        setName('');
        setRuleType('no-overlap');
        setScope('');
        setSeverity('error');
        setConfigText(JSON.stringify(RULE_TYPE_INFO['no-overlap'].defaultConfig, null, 2));
      }
      setErr(null);
    }
  }, [open, rule]);

  function onTypeChange(t) {
    setRuleType(t);
    setConfigText(JSON.stringify(RULE_TYPE_INFO[t]?.defaultConfig || {}, null, 2));
  }

  function submit(e) {
    e.preventDefault();
    let cfg;
    try { cfg = JSON.parse(configText); }
    catch (e2) { setErr(`Config inválida: ${e2.message}`); return; }
    onSubmit({
      name: name.trim(),
      ruleType,
      scope: scope.trim() || null,
      severity,
      config: cfg,
    });
  }

  const info = RULE_TYPE_INFO[ruleType];

  return (
    <Modal open={open} onClose={onClose} title={rule ? `Editar regra "${rule.name}"` : 'Nova regra de validação'} size="lg">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Nome</label>
          <input className="input w-full text-sm" placeholder="ex: global-no-overlap" value={name} onChange={(e) => setName(e.target.value)} required disabled={!!rule} />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Tipo de regra</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(RULE_TYPE_INFO).map(([k, v]) => (
              <button type="button" key={k} onClick={() => onTypeChange(k)} disabled={!!rule}
                className={`text-left px-3 py-2 rounded border text-sm transition ${
                  ruleType === k ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-slate-200 hover:border-slate-300'
                } ${rule ? 'opacity-60 cursor-not-allowed' : ''}`}>
                <div className="font-medium">{v.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{v.description}</div>
              </button>
            ))}
          </div>
          {info?.example && (
            <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-2 bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-900/40 rounded px-2.5 py-1.5">
              💡 <span className="italic">{info.example}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Escopo</label>
            <input className="input w-full text-sm" placeholder="vazio = global · ou site:42 · ou provider:aws" value={scope} onChange={(e) => setScope(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Severity</label>
            <select className="input w-full text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="error">error (bloqueia)</option>
              <option value="warning">warning (só avisa)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1">Config (JSON)</label>
          <textarea className="input w-full font-mono text-[11px]" rows={5} value={configText} onChange={(e) => setConfigText(e.target.value)} />
          {info && <p className="text-[11px] text-slate-500 mt-1">Shape esperado: <code>{info.configHint}</code></p>}
        </div>

        {err && <div className="text-xs text-rose-600">{err}</div>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} className="text-sm px-4 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-800">Cancelar</button>
          <button type="submit" disabled={loading} className="btn-primary disabled:opacity-50">
            {loading ? 'Salvando…' : (rule ? 'Salvar mudanças' : 'Criar regra')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
