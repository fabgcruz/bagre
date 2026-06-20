import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Server,
  Save,
  Activity,
  CheckCircle2,
  AlertCircle,
  Power,
} from 'lucide-react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

export default function LdapSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cfg, isLoading } = useQuery({
    queryKey: ['ldap-config'],
    queryFn: api.ldapConfig,
  });
  const [form, setForm] = useState(null);
  const [adminGroupsText, setAdminGroupsText] = useState('');
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (cfg && !form) {
      setForm({
        enabled: cfg.enabled,
        url: cfg.url || '',
        startTls: cfg.startTls ?? false,
        tlsRejectUnauthorized: cfg.tlsRejectUnauthorized ?? true,
        caCert: cfg.caCert || '',
        bindDn: cfg.bindDn || '',
        bindPassword: '',
        baseDn: cfg.baseDn || '',
        userFilter: cfg.userFilter || '(sAMAccountName={username})',
        emailAttr: cfg.emailAttr || 'mail',
        nameAttr: cfg.nameAttr || 'displayName',
        groupAttr: cfg.groupAttr || 'memberOf',
        autoProvision: cfg.autoProvision ?? true,
        defaultRole: cfg.defaultRole || 'READER',
      });
      setAdminGroupsText((cfg.adminGroups || []).join('\n'));
    }
  }, [cfg, form]);

  const save = useMutation({
    mutationFn: api.updateLdapConfig,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ldap-config'] });
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      toast.success('Configurações salvas.');
    },
    onError: (e) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: api.testLdapConfig,
    onSuccess: (r) => {
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ['ldap-config'] });
      r.ok ? toast.success(r.message) : toast.error(r.message);
    },
    onError: (e) => {
      setTestResult({ ok: false, message: e.message });
      toast.error(e.message);
    },
  });

  const enable = useMutation({
    mutationFn: () => api.updateLdapConfig({ enabled: !form.enabled }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ldap-config'] });
      qc.invalidateQueries({ queryKey: ['integrations-status'] });
      setForm((f) => ({ ...f, enabled: r.enabled }));
      toast.success(r.enabled ? 'LDAP habilitado' : 'LDAP desabilitado');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading || !form) return <p className="text-slate-500">Carregando…</p>;

  const submit = (e) => {
    e.preventDefault();
    const data = {
      url: form.url.trim(),
      startTls: form.startTls,
      tlsRejectUnauthorized: form.tlsRejectUnauthorized,
      caCert: form.caCert.trim() || null,
      bindDn: form.bindDn.trim(),
      baseDn: form.baseDn.trim(),
      userFilter: form.userFilter.trim(),
      emailAttr: form.emailAttr.trim(),
      nameAttr: form.nameAttr.trim(),
      groupAttr: form.groupAttr.trim(),
      autoProvision: form.autoProvision,
      defaultRole: form.defaultRole,
      adminGroups: adminGroupsText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (form.bindPassword) data.bindPassword = form.bindPassword;
    save.mutate(data);
  };

  const fullyConfigured =
    cfg?.url && cfg?.bindDn && cfg?.baseDn && cfg?.hasBindPassword;

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="LDAP / Active Directory"
        description="Permita que usuários entrem com as credenciais do Active Directory ou de outro servidor LDAP. O login local e o SSO continuam funcionando em paralelo (anti-lockout, caso o servidor LDAP fique fora do ar), e o papel de cada usuário vem dos grupos do AD."
        actions={
          <button
            onClick={() => enable.mutate()}
            disabled={!fullyConfigured || enable.isPending}
            className={form.enabled ? 'btn-danger' : 'btn-primary'}
            title={!fullyConfigured ? 'Configure a conexão antes de habilitar' : ''}
          >
            <Power size={14} />
            {form.enabled ? 'Desabilitar LDAP' : 'Habilitar LDAP'}
          </button>
        }
      />

      <StatusBanner cfg={cfg} fullyConfigured={fullyConfigured} />

      {testResult && (
        <div
          className={`card p-4 flex items-start gap-3 ${
            testResult.ok
              ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800'
              : 'border-rose-200 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800'
          }`}
        >
          {testResult.ok ? (
            <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" />
          ) : (
            <AlertCircle size={18} className="text-rose-600 mt-0.5" />
          )}
          <div className="text-sm">
            <strong>{testResult.ok ? 'Conexão OK.' : 'Falha na conexão.'}</strong>{' '}
            {testResult.message}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-5">
        <Section title="Conexão">
          <Field
            label="URL do servidor"
            hint="Use ldaps:// para TLS direto (porta 636) ou ldap:// com StartTLS abaixo."
          >
            <input
              required
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="ldap://dc.corp.local:389 ou ldaps://dc.corp.local:636"
              className="input font-mono text-xs"
            />
          </Field>
          <Field>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.startTls}
                onChange={(e) => setForm({ ...form, startTls: e.target.checked })}
                className="accent-brand-600"
              />
              StartTLS (criptografa em cima do ldap://)
            </label>
          </Field>

          {form.url.startsWith('ldap://') && !form.startTls && (
            <p className="text-xs rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
              ⚠️ Sem TLS: a senha do usuário trafega em texto claro, e ADs modernos
              recusam bind sem criptografia. Em produção use <code>ldaps://</code> (porta
              636) ou marque StartTLS.
            </p>
          )}

          {(form.url.startsWith('ldaps://') || form.startTls) && (
            <>
              <Field>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.tlsRejectUnauthorized}
                    onChange={(e) =>
                      setForm({ ...form, tlsRejectUnauthorized: e.target.checked })
                    }
                    className="accent-brand-600"
                  />
                  Validar o certificado do servidor (recomendado)
                </label>
                {!form.tlsRejectUnauthorized && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    ⚠️ Validação desligada — exposto a man-in-the-middle. Use só em
                    laboratório; em produção, forneça a CA abaixo.
                  </p>
                )}
              </Field>
              <Field
                label="Certificado da CA (PEM)"
                hint="Cole a CA que assina o cert do LDAPS do seu AD (ex.: a CA raiz do AD CS). Necessário quando o cert não vem de uma CA pública — assim o LDAPS valida sem desligar a checagem. Alternativa: a env NODE_EXTRA_CA_CERTS no container da API."
              >
                <textarea
                  rows={4}
                  value={form.caCert}
                  onChange={(e) => setForm({ ...form, caCert: e.target.value })}
                  placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
                  className="input font-mono text-xs"
                />
              </Field>
            </>
          )}
          <Field
            label="Conta de serviço (bind DN)"
            hint="Conta de leitura usada para buscar usuários antes de validar a senha."
          >
            <input
              required
              value={form.bindDn}
              onChange={(e) => setForm({ ...form, bindDn: e.target.value })}
              placeholder="CN=svc-bagre,OU=Service,DC=corp,DC=local"
              className="input font-mono text-xs"
            />
          </Field>
          <Field
            label="Senha da conta de serviço"
            hint={
              cfg?.hasBindPassword
                ? 'Já existe uma senha salva — deixe em branco para manter a atual, ou digite uma nova para substituir.'
                : 'Senha da conta de serviço (bind DN).'
            }
          >
            <input
              type="password"
              value={form.bindPassword}
              onChange={(e) => setForm({ ...form, bindPassword: e.target.value })}
              placeholder={cfg?.hasBindPassword ? '••••••••' : ''}
              className="input"
            />
          </Field>
          <Field label="Base de busca" hint="Onde procurar os usuários na árvore.">
            <input
              required
              value={form.baseDn}
              onChange={(e) => setForm({ ...form, baseDn: e.target.value })}
              placeholder="DC=corp,DC=local"
              className="input font-mono text-xs"
            />
          </Field>
        </Section>

        <Section title="Busca de usuário">
          <Field
            label="Filtro de usuário"
            hint="{username} é substituído no login. AD usa sAMAccountName; OpenLDAP costuma usar uid ou cn."
          >
            <input
              required
              value={form.userFilter}
              onChange={(e) => setForm({ ...form, userFilter: e.target.value })}
              placeholder="(sAMAccountName={username})"
              className="input font-mono text-xs"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Atributo de e-mail">
              <input
                value={form.emailAttr}
                onChange={(e) => setForm({ ...form, emailAttr: e.target.value })}
                placeholder="mail"
                className="input font-mono text-xs"
              />
            </Field>
            <Field label="Atributo de nome">
              <input
                value={form.nameAttr}
                onChange={(e) => setForm({ ...form, nameAttr: e.target.value })}
                placeholder="displayName"
                className="input font-mono text-xs"
              />
            </Field>
          </div>
        </Section>

        <Section title="Grupos e papéis">
          <Field
            label="Atributo de grupos"
            hint="Atributo que lista os grupos do usuário. No AD costuma ser memberOf."
          >
            <input
              value={form.groupAttr}
              onChange={(e) => setForm({ ...form, groupAttr: e.target.value })}
              placeholder="memberOf"
              className="input font-mono text-xs"
            />
          </Field>
          <Field
            label="Grupos que concedem ADMIN"
            hint="DNs de grupos que concedem ADMIN, um por linha. Ex: CN=ipam-admins,OU=Groups,DC=corp,DC=local"
          >
            <textarea
              rows={3}
              value={adminGroupsText}
              onChange={(e) => setAdminGroupsText(e.target.value)}
              placeholder="CN=ipam-admins,OU=Groups,DC=corp,DC=local"
              className="input font-mono text-xs"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Papel padrão"
              hint="Papel padrão para quem não está num grupo admin."
            >
              <select
                value={form.defaultRole}
                onChange={(e) => setForm({ ...form, defaultRole: e.target.value })}
                className="input"
              >
                <option value="READER">READER (somente leitura)</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </Field>
            <Field label="Provisionamento automático">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input
                  type="checkbox"
                  checked={form.autoProvision}
                  onChange={(e) =>
                    setForm({ ...form, autoProvision: e.target.checked })
                  }
                  className="accent-brand-600"
                />
                Criar o usuário automaticamente no 1º login
              </label>
            </Field>
          </div>
        </Section>

        <div className="flex items-center gap-2 sticky bottom-0 bg-white/90 dark:bg-slate-900/80 backdrop-blur p-3 rounded-xl border border-slate-100 dark:border-slate-800">
          <button type="submit" className="btn-primary" disabled={save.isPending}>
            <Save size={14} />
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
          <button
            type="button"
            onClick={() => test.mutate()}
            className="btn-ghost"
            disabled={test.isPending}
          >
            <Activity size={14} />
            {test.isPending ? 'Testando…' : 'Testar conexão'}
          </button>
          {cfg?.lastTestedAt && (
            <span className="text-xs text-slate-500 ml-auto">
              último teste:{' '}
              <span
                className={
                  cfg.lastTestStatus === 'ok' ? 'text-emerald-600' : 'text-rose-600'
                }
              >
                {cfg.lastTestStatus === 'ok' ? '✓' : '✗'}{' '}
                {new Date(cfg.lastTestedAt).toLocaleString('pt-BR')}
              </span>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function StatusBanner({ cfg, fullyConfigured }) {
  if (!cfg) return null;
  if (cfg.enabled && fullyConfigured) {
    return (
      <div className="card p-4 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 flex items-start gap-3">
        <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" />
        <div className="text-sm">
          <strong>LDAP ativo.</strong> A tela de login aceita credenciais do
          Active Directory. Login local e SSO continuam disponíveis em paralelo.
        </div>
      </div>
    );
  }
  if (!fullyConfigured) {
    return (
      <div className="card p-4 border-slate-200 flex items-start gap-3">
        <Server size={18} className="text-slate-400 mt-0.5" />
        <div className="text-sm">
          <strong>Não configurado.</strong> Preencha a conexão (URL, bind DN,
          senha e base de busca) e clique em <em>Testar conexão</em>. O botão{' '}
          <em>Habilitar LDAP</em> destrava quando os campos obrigatórios
          estiverem preenchidos.
        </div>
      </div>
    );
  }
  return (
    <div className="card p-4 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 flex items-start gap-3">
      <AlertCircle size={18} className="text-amber-600 mt-0.5" />
      <div className="text-sm">
        <strong>Configurado, mas desabilitado.</strong> A tela de login ainda não
        aceita credenciais do AD. Use <em>Habilitar LDAP</em> no topo desta página
        quando estiver pronto.
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="card p-5 space-y-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      {label && <label className="block text-sm font-medium mb-1">{label}</label>}
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
