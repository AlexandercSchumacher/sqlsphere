import { useState, useEffect } from 'react';
import { Plus, Database, Edit, Trash2, CheckCircle, XCircle, HelpCircle, AlertTriangle, Star, Copy, ChevronDown, ChevronUp, Download, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import Layout from '@/components/Layout';
import { mockConnections, DatabaseConnection, DatabaseType, ConnectionMethod, AuthMethod, SSLMode } from '@/lib/mockData';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { AuthDialog } from '@/components/AuthDialog';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from 'react-i18next';
import { useSubscription } from '@/hooks/useSubscription';

// Auth method options per database type
const AUTH_METHODS: Record<DatabaseType, { value: AuthMethod; label: string }[]> = {
  MySQL: [
    { value: 'sql_auth', label: 'Standard (User/Password)' },
    { value: 'aws_iam', label: 'AWS RDS IAM Authentication' },
    { value: 'ssl_cert', label: 'SSL Certificate Auth' },
    { value: 'connection_string', label: 'Custom Connection String' },
  ],
  PostgreSQL: [
    { value: 'sql_auth', label: 'Standard (User/Password)' },
    { value: 'aws_iam', label: 'AWS RDS IAM Authentication' },
    { value: 'azure_ad_password', label: 'Azure AD — Password' },
    { value: 'azure_ad_sp', label: 'Azure AD — Service Principal' },
    { value: 'kerberos', label: 'Kerberos / GSSAPI' },
    { value: 'ssl_cert', label: 'SSL Certificate Auth' },
    { value: 'connection_string', label: 'Custom Connection String (URI)' },
  ],
  'SQL Server': [
    { value: 'sql_auth', label: 'SQL Server Authentication' },
    { value: 'windows_auth', label: 'Windows Authentication (Trusted Connection)' },
    { value: 'azure_ad_password', label: 'Azure AD — Password' },
    { value: 'azure_ad_integrated', label: 'Azure AD — Integrated' },
    { value: 'azure_ad_mfa', label: 'Azure AD — MFA / Interactive' },
    { value: 'azure_ad_sp', label: 'Azure AD — Service Principal' },
    { value: 'azure_ad_mi', label: 'Azure AD — Managed Identity' },
    { value: 'kerberos', label: 'Kerberos' },
    { value: 'connection_string', label: 'Custom Connection String' },
  ],
  Oracle: [
    { value: 'sql_auth', label: 'Standard (User/Password)' },
    { value: 'connection_string', label: 'Custom Connection String' },
  ],
};

const CONNECTION_METHODS: Record<DatabaseType, { value: ConnectionMethod; label: string }[]> = {
  MySQL: [
    { value: 'standard', label: 'Standard TCP/IP' },
    { value: 'ssh', label: 'SSH Tunnel' },
    { value: 'socket', label: 'Unix Socket' },
    { value: 'pipe', label: 'Named Pipe (Windows)' },
  ],
  PostgreSQL: [
    { value: 'standard', label: 'Standard TCP/IP' },
    { value: 'ssh', label: 'SSH Tunnel' },
    { value: 'socket', label: 'Unix Socket' },
  ],
  'SQL Server': [
    { value: 'standard', label: 'Standard TCP/IP' },
    { value: 'ssh', label: 'SSH Tunnel' },
    { value: 'pipe', label: 'Named Pipe (Windows)' },
  ],
  Oracle: [
    { value: 'standard', label: 'Standard TCP/IP' },
    { value: 'ssh', label: 'SSH Tunnel' },
  ],
};

const SSL_MODES_POSTGRES: { value: SSLMode; label: string }[] = [
  { value: 'disable', label: 'disable — No SSL' },
  { value: 'allow', label: 'allow — Prefer non-SSL' },
  { value: 'prefer', label: 'prefer — Try SSL first' },
  { value: 'require', label: 'require — Require SSL' },
  { value: 'verify-ca', label: 'verify-ca — Verify CA cert' },
  { value: 'verify-full', label: 'verify-full — Verify CA + hostname' },
];

const SSL_MODES_MYSQL: { value: SSLMode; label: string }[] = [
  { value: 'disabled', label: 'disabled — No SSL' },
  { value: 'preferred', label: 'preferred — Use if available' },
  { value: 'required', label: 'required — Require SSL' },
  { value: 'verify_ca', label: 'verify_ca — Verify CA cert' },
  { value: 'verify_identity', label: 'verify_identity — Verify CA + hostname' },
];

type CertTab = 'path' | 'paste';

const Connections = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { canCreateConnection, refreshUsage } = useSubscription();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<DatabaseConnection | null>(null);
  const [sslExpanded, setSslExpanded] = useState(false);
  const [certTabCa, setCertTabCa] = useState<CertTab>('path');
  const [certTabCert, setCertTabCert] = useState<CertTab>('path');
  const [certTabKey, setCertTabKey] = useState<CertTab>('path');

  const handleAdd = () => {
    if (!user) {
      setAuthDialogOpen(true);
      return;
    }
    if (!canCreateConnection()) {
      toast({
        title: t('subscription.limitReached'),
        description: t('subscription.connectionLimitReached'),
        variant: 'destructive',
      });
      return;
    }
    setEditingConnection(null);
    setFormData(defaultFormData);
    setSslExpanded(false);
    setDialogOpen(true);
  };

  // Load connections from Supabase and migrate from localStorage if needed
  useEffect(() => {
    const loadConnections = async () => {
      if (!user) {
        setConnections([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('connections')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const loadedConnections: DatabaseConnection[] = (data || []).map((conn: any) => ({
          id: conn.id,
          name: conn.name,
          type: conn.type as DatabaseType,
          connectionMethod: conn.connection_method as ConnectionMethod,
          host: conn.host || '',
          port: conn.port || 5432,
          database: conn.database || '',
          username: conn.username || '',
          password: '',
          useSSL: conn.use_ssl || false,
          sshHost: conn.ssh_host || '',
          sshPort: conn.ssh_port || 22,
          sshUsername: conn.ssh_username || '',
          sshPassword: '',
          sshKeyFile: '',
          socketPath: conn.socket_path || '',
          namedPipe: conn.named_pipe || '',
          namedInstance: conn.named_instance || '',
          defaultSchema: conn.default_schema || '',
          isDefault: conn.is_default || false,
          status: conn.status as DatabaseConnection['status'],
          connectionCode: conn.connection_code || undefined,
          authMethod: (conn.auth_method || 'sql_auth') as AuthMethod,
          sslMode: conn.ssl_mode || undefined,
          sslCaPath: conn.ssl_ca_path || '',
          sslCertPath: conn.ssl_cert_path || '',
          sslKeyPath: conn.ssl_key_path || '',
          azureTenantId: conn.azure_tenant_id || '',
          azureClientId: conn.azure_client_id || '',
          awsRegion: conn.aws_region || '',
          awsUseInstanceProfile: conn.aws_use_instance_profile || false,
          encrypt: conn.encrypt || undefined,
          trustServerCertificate: conn.trust_server_certificate || false,
        }));

        setConnections(loadedConnections);

        if (loadedConnections.length === 0) {
          const storedConnections = localStorage.getItem(`connections_${user.id}`);
          if (storedConnections) {
            const localConns: DatabaseConnection[] = JSON.parse(storedConnections);
            for (const conn of localConns) {
              await supabase.from('connections').insert({
                user_id: user.id,
                name: conn.name,
                type: conn.type,
                connection_method: conn.connectionMethod || 'standard',
                host: conn.host,
                port: conn.port,
                database: conn.database,
                username: conn.username,
                password: conn.password,
                use_ssl: conn.useSSL,
                ssh_host: conn.sshHost,
                ssh_port: conn.sshPort,
                ssh_username: conn.sshUsername,
                ssh_password: conn.sshPassword,
                ssh_key_file: conn.sshKeyFile,
                default_schema: conn.defaultSchema,
                status: conn.status,
              });
            }
            const { data: migratedData } = await supabase
              .from('connections')
              .select('*')
              .order('created_at', { ascending: false });

            if (migratedData) {
              const migratedConnections: DatabaseConnection[] = migratedData.map((conn: any) => ({
                id: conn.id,
                name: conn.name,
                type: conn.type as DatabaseType,
                connectionMethod: conn.connection_method as ConnectionMethod,
                host: conn.host || '',
                port: conn.port || 5432,
                database: conn.database || '',
                username: conn.username || '',
                password: conn.password || '',
                useSSL: conn.use_ssl || false,
                sshHost: conn.ssh_host || '',
                sshPort: conn.ssh_port || 22,
                sshUsername: conn.ssh_username || '',
                sshPassword: conn.ssh_password || '',
                sshKeyFile: conn.ssh_key_file || '',
                defaultSchema: conn.default_schema || '',
                isDefault: conn.is_default || false,
                status: conn.status as DatabaseConnection['status'],
              }));
              setConnections(migratedConnections);
            }
            localStorage.removeItem(`connections_${user.id}`);
          }
        }
      } catch (error) {
        console.error('Error loading connections:', error);
        toast({
          title: t('connections.errorLoading'),
          description: t('connections.failedToLoad'),
          variant: 'destructive',
        });
      }
    };

    loadConnections();
  }, [user, toast]);

  const getDefaultPort = (dbType: DatabaseType): number => {
    switch (dbType) {
      case 'PostgreSQL': return 5432;
      case 'MySQL': return 3306;
      case 'SQL Server': return 1433;
      case 'Oracle': return 1521;
      default: return 5432;
    }
  };

  const defaultFormData = {
    name: '',
    type: 'PostgreSQL' as DatabaseType,
    connectionMethod: 'standard' as ConnectionMethod,
    host: '',
    port: 5432,
    database: '',
    username: '',
    password: '',
    useSSL: false,
    sshHost: '',
    sshPort: 22,
    sshUsername: '',
    sshPassword: '',
    sshKeyFile: '',
    socketPath: '',
    namedPipe: '',
    namedInstance: '',
    defaultSchema: '',
    connectionCode: '',
    websocketUrl: '',
    authMethod: 'sql_auth' as AuthMethod,
    sslMode: '' as string,
    sslCa: '',
    sslCaPath: '',
    sslCert: '',
    sslCertPath: '',
    sslKey: '',
    sslKeyPath: '',
    azureTenantId: '',
    azureClientId: '',
    azureClientSecret: '',
    awsRegion: '',
    awsAccessKeyId: '',
    awsSecretAccessKey: '',
    awsUseInstanceProfile: false,
    encrypt: '' as string,
    trustServerCertificate: false,
    connectionStringValue: '',
  };

  const [formData, setFormData] = useState(defaultFormData);

  const handleEdit = (connection: DatabaseConnection) => {
    setEditingConnection(connection);
    setFormData({
      name: connection.name,
      type: connection.type,
      connectionMethod: connection.connectionMethod || 'standard',
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: connection.password,
      useSSL: connection.useSSL,
      sshHost: connection.sshHost || '',
      sshPort: connection.sshPort || 22,
      sshUsername: connection.sshUsername || '',
      sshPassword: connection.sshPassword || '',
      sshKeyFile: connection.sshKeyFile || '',
      socketPath: connection.socketPath || '',
      namedPipe: connection.namedPipe || '',
      namedInstance: connection.namedInstance || '',
      defaultSchema: connection.defaultSchema || '',
      connectionCode: connection.connectionCode || '',
      websocketUrl: '',
      authMethod: connection.authMethod || 'sql_auth',
      sslMode: connection.sslMode || '',
      sslCa: connection.sslCa || '',
      sslCaPath: connection.sslCaPath || '',
      sslCert: connection.sslCert || '',
      sslCertPath: connection.sslCertPath || '',
      sslKey: connection.sslKey || '',
      sslKeyPath: connection.sslKeyPath || '',
      azureTenantId: connection.azureTenantId || '',
      azureClientId: connection.azureClientId || '',
      azureClientSecret: connection.azureClientSecret || '',
      awsRegion: connection.awsRegion || '',
      awsAccessKeyId: connection.awsAccessKeyId || '',
      awsSecretAccessKey: connection.awsSecretAccessKey || '',
      awsUseInstanceProfile: connection.awsUseInstanceProfile || false,
      encrypt: connection.encrypt || '',
      trustServerCertificate: connection.trustServerCertificate || false,
      connectionStringValue: connection.connectionStringValue || '',
    });
    setSslExpanded(!!(connection.sslMode || connection.sslCa || connection.sslCaPath || connection.sslCert || connection.sslKey));
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('connections')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setConnections(connections.filter(c => c.id !== id));

      toast({
        title: t('connections.connectionDeleted'),
        description: t('connections.connectionDeletedDesc'),
      });
    } catch (error) {
      console.error('Error deleting connection:', error);
      toast({
        title: t('connections.errorDeleting'),
        description: t('connections.failedToDelete'),
        variant: 'destructive',
      });
    }
  };

  const handleSetDefault = async (id: string) => {
    if (!user) return;

    try {
      const { data, error } = await supabase.functions.invoke('manage-connection', {
        body: {
          action: 'set-default',
          connectionId: id,
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to set default connection');

      setConnections(connections.map(c => ({
        ...c,
        isDefault: c.id === id,
      })));

      toast({
        title: t('connections.connectionUpdated'),
        description: t('connections.connectionUpdatedDesc'),
      });
    } catch (error) {
      console.error('Error setting default connection:', error);
      toast({
        title: t('connections.errorSaving'),
        description: t('connections.failedToSave'),
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = async () => {
    if (!user) return;

    try {
      const action = editingConnection ? 'update' : 'create';

      const { data, error } = await supabase.functions.invoke('manage-connection', {
        body: {
          action,
          connectionId: editingConnection?.id,
          connectionData: {
            name: formData.name,
            type: formData.type,
            connectionMethod: formData.connectionMethod,
            host: formData.host,
            port: formData.port,
            database: formData.database,
            username: formData.username,
            password: formData.password,
            useSSL: formData.useSSL,
            sshHost: formData.sshHost,
            sshPort: formData.sshPort,
            sshUsername: formData.sshUsername,
            sshPassword: formData.sshPassword,
            sshKeyFile: formData.sshKeyFile,
            socketPath: formData.socketPath,
            namedPipe: formData.namedPipe,
            namedInstance: formData.namedInstance,
            defaultSchema: formData.defaultSchema,
            connectionCode: formData.connectionCode || undefined,
            authMethod: formData.authMethod,
            sslMode: formData.sslMode || undefined,
            sslCa: formData.sslCa || undefined,
            sslCaPath: formData.sslCaPath || undefined,
            sslCert: formData.sslCert || undefined,
            sslCertPath: formData.sslCertPath || undefined,
            sslKey: formData.sslKey || undefined,
            sslKeyPath: formData.sslKeyPath || undefined,
            azureTenantId: formData.azureTenantId || undefined,
            azureClientId: formData.azureClientId || undefined,
            azureClientSecret: formData.azureClientSecret || undefined,
            awsRegion: formData.awsRegion || undefined,
            awsAccessKeyId: formData.awsAccessKeyId || undefined,
            awsSecretAccessKey: formData.awsSecretAccessKey || undefined,
            awsUseInstanceProfile: formData.awsUseInstanceProfile,
            encrypt: formData.encrypt || undefined,
            trustServerCertificate: formData.trustServerCertificate,
            connectionStringValue: formData.connectionStringValue || undefined,
          }
        }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to save connection');

      if (editingConnection) {
        setConnections(connections.map(c =>
          c.id === editingConnection.id
            ? ({
                id: c.id,
                ...formData,
                sslMode: (formData.sslMode || '') as SSLMode,
                encrypt: (formData.encrypt || undefined) as DatabaseConnection['encrypt'],
                password: '',
                sshPassword: '',
                sshKeyFile: '',
                azureClientSecret: '',
                awsSecretAccessKey: '',
                sslKey: '',
                connectionStringValue: '',
                status: 'unknown' as const,
                isDefault: c.isDefault,
              } as DatabaseConnection)
            : c
        ));
        toast({
          title: t('connections.connectionUpdated'),
          description: t('connections.connectionUpdatedDesc'),
        });
      } else {
        const newConnection: DatabaseConnection = {
          id: data.connection.id,
          ...formData,
          sslMode: (formData.sslMode || '') as SSLMode,
          encrypt: (formData.encrypt || undefined) as DatabaseConnection['encrypt'],
          password: '',
          sshPassword: '',
          sshKeyFile: '',
          azureClientSecret: '',
          awsSecretAccessKey: '',
          sslKey: '',
          connectionStringValue: '',
          isDefault: data.connection.is_default || false,
          status: 'unknown',
        };
        setConnections([newConnection, ...connections]);
        toast({
          title: t('connections.connectionAdded'),
          description: t('connections.connectionAddedDesc'),
        });
      }
      setDialogOpen(false);
      setFormData(defaultFormData);
    } catch (error) {
      console.error('Error saving connection:', error);
      toast({
        title: t('connections.errorSaving'),
        description: t('connections.failedToSave'),
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async (id: string) => {
    const connection = connections.find(c => c.id === id);
    if (!connection) return;

    setConnections(connections.map(c =>
      c.id === id ? { ...c, status: 'loading' as const } : c
    ));

    try {
      const { data, error } = await supabase.functions.invoke('manage-connection', {
        body: {
          action: 'test',
          connectionId: id,
        }
      });

      if (error) throw error;

      const newStatus = data?.status || 'error';

      setConnections(connections.map(c =>
        c.id === id ? { ...c, status: newStatus } : c
      ));

      if (data?.success) {
        toast({
          title: t('connections.connectionSuccessful'),
          description: t('connections.successfullyConnected'),
        });
      } else {
        toast({
          title: t('connections.connectionFailed'),
          description: data.message || t('connections.checkCredentials'),
          variant: 'destructive',
        });
      }

    } catch (error) {
      console.error('Error testing connection:', error);
      setConnections(connections.map(c =>
        c.id === connection.id ? { ...c, status: 'error' } : c
      ));
      toast({
        title: t('connections.connectionTestFailed'),
        description: t('connections.errorOccurred'),
        variant: 'destructive',
      });
    }
  };

  const getStatusIcon = (status: DatabaseConnection['status']) => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const authMethod = formData.authMethod;
  const needsCredentials = !['windows_auth', 'azure_ad_integrated', 'azure_ad_mi', 'kerberos'].includes(authMethod);
  const needsPassword = needsCredentials && !['azure_ad_sp', 'connection_string'].includes(authMethod);
  const sslModes = formData.type === 'MySQL' ? SSL_MODES_MYSQL : SSL_MODES_POSTGRES;
  const supportsSslConfig = formData.type === 'MySQL' || formData.type === 'PostgreSQL';
  const allowsLocalMethod = formData.type !== 'Oracle';

  // Helper: cert input with path/paste tabs
  const CertInput = ({
    label,
    tab,
    setTab,
    pathValue,
    onPathChange,
    pasteValue,
    onPasteChange,
    pathPlaceholder,
    pastePlaceholder,
  }: {
    label: string;
    tab: CertTab;
    setTab: (t: CertTab) => void;
    pathValue: string;
    onPathChange: (v: string) => void;
    pasteValue: string;
    onPasteChange: (v: string) => void;
    pathPlaceholder?: string;
    pastePlaceholder?: string;
  }) => (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1 mb-1">
        <Button type="button" variant={tab === 'path' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setTab('path')}>
          File Path
        </Button>
        <Button type="button" variant={tab === 'paste' ? 'default' : 'outline'} size="sm" className="h-6 text-xs px-2" onClick={() => setTab('paste')}>
          Paste PEM
        </Button>
      </div>
      {tab === 'path' ? (
        <Input
          value={pathValue}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder={pathPlaceholder || '/path/to/file.pem'}
          className="text-xs"
        />
      ) : (
        <Textarea
          value={pasteValue}
          onChange={(e) => onPasteChange(e.target.value)}
          placeholder={pastePlaceholder || '-----BEGIN CERTIFICATE-----\n...'}
          className="text-xs font-mono h-20"
        />
      )}
    </div>
  );

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('connections.title')}</h1>
            <p className="text-muted-foreground">
              {t('connections.description')}
            </p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleAdd} className="gap-2">
                <Plus className="h-4 w-4" />
                {t('connections.addConnection')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingConnection ? t('connections.editConnection') : t('connections.addConnection')}
                </DialogTitle>
                <DialogDescription>
                  {editingConnection
                    ? t('connections.updateConnectionDetails')
                    : t('connections.addNewConnection')
                  }
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">

                {/* Connection Name */}
                <div className="grid gap-2">
                  <Label htmlFor="name">{t('connections.connectionName')}</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="My Database"
                  />
                </div>

                {/* Database Type */}
                <div className="grid gap-2">
                  <Label htmlFor="type">{t('connections.databaseType')}</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => {
                      const newType = value as DatabaseType;
                      setFormData({
                        ...formData,
                        type: newType,
                        port: getDefaultPort(newType),
                        connectionMethod: 'standard',
                        authMethod: 'sql_auth',
                        sslMode: '',
                        encrypt: '',
                        namedInstance: '',
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PostgreSQL">PostgreSQL</SelectItem>
                      <SelectItem value="MySQL">MySQL</SelectItem>
                      <SelectItem value="SQL Server">SQL Server</SelectItem>
                      <SelectItem value="Oracle">Oracle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Connection Method */}
                {(formData.type === 'MySQL' || formData.type === 'PostgreSQL' || formData.type === 'SQL Server' || formData.type === 'Oracle') && (
                  <div className="grid gap-2">
                    <Label htmlFor="connectionMethod">{t('connections.connectionMethod')}</Label>
                    <Select
                      value={formData.connectionMethod}
                      onValueChange={(value) => setFormData({ ...formData, connectionMethod: value as ConnectionMethod })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONNECTION_METHODS[formData.type]?.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                        {allowsLocalMethod && typeof window !== 'undefined' && window.electronAPI && (
                          <SelectItem value="local">Local Database (Direct)</SelectItem>
                        )}
                        {allowsLocalMethod && (!window.electronAPI || typeof window === 'undefined') && (
                          <SelectItem value="local" disabled>Local Database (Agent) — Coming Soon</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Auth Method */}
                {formData.connectionMethod !== 'local' && (
                  <div className="grid gap-2">
                    <Label htmlFor="authMethod">Authentication Method</Label>
                    <Select
                      value={formData.authMethod}
                      onValueChange={(value) => setFormData({ ...formData, authMethod: value as AuthMethod })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTH_METHODS[formData.type]?.map((m) => (
                          <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Azure AD MFA warning */}
                {authMethod === 'azure_ad_mfa' && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex gap-2 items-start">
                      <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        <strong>Azure AD MFA / Interactive</strong> requires a browser prompt. This only works with the Local Agent on a desktop machine, not via cloud connections.
                      </p>
                    </div>
                  </div>
                )}

                {/* Kerberos info */}
                {authMethod === 'kerberos' && (
                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      <strong>Kerberos</strong> requires the backend server to be Kerberos-configured (MIT Kerberos / Windows AD). Suitable for on-premise deployments only. No credentials needed here — authentication uses the active Kerberos ticket.
                    </p>
                  </div>
                )}

                {/* Windows Auth info */}
                {authMethod === 'windows_auth' && (
                  <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      <strong>Windows Authentication</strong> uses the Windows account running the backend server. No username or password needed. Only works when the backend is in the same Windows domain.
                    </p>
                  </div>
                )}

                {/* Custom Connection String (Expert Mode) */}
                {authMethod === 'connection_string' && (
                  <div className="grid gap-2">
                    <Label htmlFor="connectionStringValue">Connection String</Label>
                    <Textarea
                      id="connectionStringValue"
                      value={formData.connectionStringValue}
                      onChange={(e) => setFormData({ ...formData, connectionStringValue: e.target.value })}
                      placeholder={
                        formData.type === 'PostgreSQL'
                          ? 'postgresql://user:pass@host:5432/dbname?sslmode=require'
                          : formData.type === 'MySQL'
                          ? 'DRIVER={MySQL ODBC 8.0 Driver};SERVER=host;DATABASE=db;USER=u;PASSWORD=p;'
                          : formData.type === 'Oracle'
                          ? 'DRIVER={Oracle 19 ODBC driver};DBQ=host:1521/service;UID=user;PWD=password;'
                          : 'DRIVER={ODBC Driver 17 for SQL Server};SERVER=host,1433;DATABASE=db;UID=u;PWD=p;'
                      }
                      className="font-mono text-xs h-24"
                    />
                    <p className="text-xs text-muted-foreground">All other fields are ignored when a custom connection string is provided.</p>
                  </div>
                )}

                {/* SSH Tunnel */}
                {formData.connectionMethod === 'ssh' && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="sshHost">SSH Hostname</Label>
                        <Input
                          id="sshHost"
                          value={formData.sshHost}
                          onChange={(e) => setFormData({ ...formData, sshHost: e.target.value })}
                          placeholder="bastion.example.com"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="sshPort">SSH Port</Label>
                        <Input
                          id="sshPort"
                          type="number"
                          value={formData.sshPort}
                          onChange={(e) => setFormData({ ...formData, sshPort: parseInt(e.target.value) || 22 })}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sshUsername">SSH Username</Label>
                      <Input
                        id="sshUsername"
                        value={formData.sshUsername}
                        onChange={(e) => setFormData({ ...formData, sshUsername: e.target.value })}
                        placeholder="user"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sshPassword">SSH Password</Label>
                      <Input
                        id="sshPassword"
                        type="password"
                        value={formData.sshPassword}
                        onChange={(e) => setFormData({ ...formData, sshPassword: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="sshKeyFile">SSH Key File (Optional)</Label>
                      <Input
                        id="sshKeyFile"
                        value={formData.sshKeyFile}
                        onChange={(e) => setFormData({ ...formData, sshKeyFile: e.target.value })}
                        placeholder="Path to SSH private key file"
                      />
                    </div>
                  </>
                )}

                {/* Local Agent */}
                {formData.connectionMethod === 'local' && (
                  <div className="grid gap-4 p-4 border rounded-lg bg-muted/50">
                    {typeof window !== 'undefined' && window.electronAPI ? (
                      <div className="p-3 bg-green-50 dark:bg-green-950 rounded border border-green-200 dark:border-green-800">
                        <div className="flex items-start gap-2">
                          <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                          <div>
                            <p className="font-medium text-green-900 dark:text-green-100">Direct Local Database Connection</p>
                            <p className="text-sm text-green-800 dark:text-green-200 mt-1">
                              In Desktop IDE, you can connect directly to local databases.
                              Simply use <strong>"Standard TCP/IP"</strong> with host <strong>"localhost"</strong> - no agent needed!
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-amber-500" />
                          <div>
                            <p className="font-medium">Local Database Connection — Coming Soon</p>
                            <p className="text-sm text-muted-foreground">
                              The Local Agent is currently under development. It will allow you to connect to local databases via a lightweight desktop app running on your machine.
                            </p>
                          </div>
                        </div>

                        {/* Coming soon banner */}
                        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                          <div className="flex items-center gap-2 min-w-0">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                            <span className="text-sm text-amber-800 dark:text-amber-300">
                              This feature is not yet available. Stay tuned!
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-2">
                          <Label htmlFor="connectionCode">Connection Code</Label>
                          {editingConnection && formData.connectionCode ? (
                            <div className="flex gap-2">
                              <Input
                                id="connectionCode"
                                value={formData.connectionCode}
                                readOnly
                                className="font-mono"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  navigator.clipboard.writeText(formData.connectionCode);
                                  toast({ title: 'Copied!', description: 'Connection code copied to clipboard.' });
                                }}
                              >
                                <Copy className="h-4 w-4 mr-1" />
                                Copy
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <Input
                                id="connectionCode"
                                value={formData.connectionCode}
                                onChange={(e) => setFormData({ ...formData, connectionCode: e.target.value })}
                                placeholder="Click 'Generate Code' to create a connection code"
                                readOnly
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    const { data, error } = await supabase.functions.invoke('database-proxy', {
                                      body: { endpoint: '/api/local-agent/generate-code', method: 'POST' },
                                    });
                                    if (error) throw error;
                                    if (data?.connection_code) {
                                      setFormData({ ...formData, connectionCode: data.connection_code, websocketUrl: data.websocket_url });
                                      toast({ title: 'Connection code generated', description: 'Use this code to connect your local agent.' });
                                    }
                                  } catch (error: any) {
                                    toast({ title: 'Error generating code', description: error.message || 'Failed to generate connection code', variant: 'destructive' });
                                  }
                                }}
                              >
                                Generate Code
                              </Button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Standard connection fields: Host / Port */}
                {formData.connectionMethod !== 'local' && formData.connectionMethod !== 'socket' && formData.connectionMethod !== 'pipe' && authMethod !== 'connection_string' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="host">
                          {formData.type === 'MySQL' && formData.connectionMethod === 'ssh' ? 'MySQL Hostname' : 'Host'}
                        </Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{t('docs.tooltipConnHost')}</TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id="host"
                        value={formData.host}
                        onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                        placeholder="localhost"
                      />
                      {(formData.host.toLowerCase() === 'localhost' || formData.host === '127.0.0.1') &&
                       formData.connectionMethod !== 'ssh' && (
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mt-2">
                          <div className="flex gap-2 items-start">
                            <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-medium text-amber-500">{t('docs.localhostWarning')}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {formData.type === 'MySQL' ? t('docs.localhostWarningTextMySQL') : t('docs.localhostWarningText')}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-2">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="port">
                          {formData.type === 'MySQL' && formData.connectionMethod === 'ssh' ? 'MySQL Server Port' : 'Port'}
                        </Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{t('docs.tooltipConnPort')}</TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id="port"
                        type="number"
                        value={formData.port}
                        onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) || 5432 })}
                      />
                    </div>
                  </div>
                )}

                {/* Named Instance (SQL Server) */}
                {formData.type === 'SQL Server' && authMethod !== 'connection_string' && formData.connectionMethod !== 'pipe' && (
                  <div className="grid gap-2">
                    <Label htmlFor="namedInstance">Named Instance (Optional)</Label>
                    <Input
                      id="namedInstance"
                      value={formData.namedInstance}
                      onChange={(e) => setFormData({ ...formData, namedInstance: e.target.value })}
                      placeholder="SQLEXPRESS — leave blank to use host:port"
                    />
                    <p className="text-xs text-muted-foreground">
                      If set, connects as <code>SERVER\INSTANCE</code> and ignores the port field.
                    </p>
                  </div>
                )}

                {/* Unix Socket Path */}
                {formData.connectionMethod === 'socket' && (
                  <div className="grid gap-2">
                    <Label htmlFor="socketPath">Unix Socket Path</Label>
                    <Input
                      id="socketPath"
                      value={formData.socketPath}
                      onChange={(e) => setFormData({ ...formData, socketPath: e.target.value })}
                      placeholder="/var/run/mysql/mysql.sock"
                    />
                  </div>
                )}

                {/* Named Pipe (Windows / SQL Server) */}
                {formData.connectionMethod === 'pipe' && (
                  <div className="grid gap-2">
                    <Label htmlFor="namedPipe">Named Pipe</Label>
                    <Input
                      id="namedPipe"
                      value={formData.namedPipe}
                      onChange={(e) => setFormData({ ...formData, namedPipe: e.target.value })}
                      placeholder={formData.type === 'MySQL' ? '\\\\.\\pipe\\MySQL' : '\\\\.\\pipe\\MSSQL$SQLEXPRESS\\sql\\query'}
                    />
                  </div>
                )}

                {/* Database & Credentials */}
                {formData.connectionMethod !== 'local' && authMethod !== 'connection_string' && (
                  <>
                    <div className="grid gap-2">
                      <div className="flex items-center gap-1">
                        <Label htmlFor="database">Database Name</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">{t('docs.tooltipConnDatabase')}</TooltipContent>
                        </Tooltip>
                      </div>
                      <Input
                        id="database"
                        value={formData.database}
                        onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                        placeholder="mydb"
                      />
                    </div>

                    {needsCredentials && (
                      <div className="grid gap-2">
                        <div className="flex items-center gap-1">
                          <Label htmlFor="username">Username</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{t('docs.tooltipConnUsername')}</TooltipContent>
                          </Tooltip>
                        </div>
                        <Input
                          id="username"
                          value={formData.username}
                          onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        />
                      </div>
                    )}

                    {needsPassword && (
                      <div className="grid gap-2">
                        <div className="flex items-center gap-1">
                          <Label htmlFor="password">Password</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{t('docs.tooltipConnPassword')}</TooltipContent>
                          </Tooltip>
                        </div>
                        <Input
                          id="password"
                          type="password"
                          value={formData.password}
                          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        />
                      </div>
                    )}
                  </>
                )}

                {/* Local agent: optional display fields */}
                {formData.connectionMethod === 'local' && (
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-4">
                      <strong>For local agent connections:</strong> Database credentials are entered in the agent application, not here.
                    </p>
                    <div className="grid gap-2">
                      <Label htmlFor="database">Database (optional — auto-filled from agent)</Label>
                      <Input
                        id="database"
                        value={formData.database}
                        onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                        placeholder="Will be filled from agent"
                      />
                    </div>
                  </div>
                )}

                {/* Azure AD fields */}
                {(authMethod === 'azure_ad_password' || authMethod === 'azure_ad_sp') && (
                  <div className="grid gap-3 p-3 border rounded-lg bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Azure AD Settings</p>
                    <div className="grid gap-2">
                      <Label htmlFor="azureTenantId">Tenant ID</Label>
                      <Input
                        id="azureTenantId"
                        value={formData.azureTenantId}
                        onChange={(e) => setFormData({ ...formData, azureTenantId: e.target.value })}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      />
                    </div>
                    {authMethod === 'azure_ad_sp' && (
                      <>
                        <div className="grid gap-2">
                          <Label htmlFor="azureClientId">Client (App) ID</Label>
                          <Input
                            id="azureClientId"
                            value={formData.azureClientId}
                            onChange={(e) => setFormData({ ...formData, azureClientId: e.target.value })}
                            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="azureClientSecret">Client Secret</Label>
                          <Input
                            id="azureClientSecret"
                            type="password"
                            value={formData.azureClientSecret}
                            onChange={(e) => setFormData({ ...formData, azureClientSecret: e.target.value })}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Azure AD Managed Identity: optional client ID */}
                {authMethod === 'azure_ad_mi' && (
                  <div className="grid gap-2 p-3 border rounded-lg bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Azure Managed Identity</p>
                    <div className="grid gap-2">
                      <Label htmlFor="azureClientId">User-assigned Managed Identity Client ID (optional)</Label>
                      <Input
                        id="azureClientId"
                        value={formData.azureClientId}
                        onChange={(e) => setFormData({ ...formData, azureClientId: e.target.value })}
                        placeholder="Leave blank for system-assigned identity"
                      />
                    </div>
                  </div>
                )}

                {/* AWS IAM fields */}
                {authMethod === 'aws_iam' && (
                  <div className="grid gap-3 p-3 border rounded-lg bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">AWS IAM Settings</p>
                    <div className="grid gap-2">
                      <Label htmlFor="awsRegion">AWS Region <span className="text-destructive">*</span></Label>
                      <Input
                        id="awsRegion"
                        value={formData.awsRegion}
                        onChange={(e) => setFormData({ ...formData, awsRegion: e.target.value })}
                        placeholder="us-east-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="awsUseInstanceProfile"
                        checked={formData.awsUseInstanceProfile}
                        onCheckedChange={(checked) => setFormData({ ...formData, awsUseInstanceProfile: checked })}
                      />
                      <Label htmlFor="awsUseInstanceProfile">Use EC2 Instance Profile / ECS Task Role</Label>
                    </div>
                    {!formData.awsUseInstanceProfile && (
                      <>
                        <div className="grid gap-2">
                          <Label htmlFor="awsAccessKeyId">Access Key ID</Label>
                          <Input
                            id="awsAccessKeyId"
                            value={formData.awsAccessKeyId}
                            onChange={(e) => setFormData({ ...formData, awsAccessKeyId: e.target.value })}
                            placeholder="AKIAIOSFODNN7EXAMPLE"
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="awsSecretAccessKey">Secret Access Key</Label>
                          <Input
                            id="awsSecretAccessKey"
                            type="password"
                            value={formData.awsSecretAccessKey}
                            onChange={(e) => setFormData({ ...formData, awsSecretAccessKey: e.target.value })}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Default Schema */}
                {(formData.type === 'MySQL' || formData.type === 'SQL Server' || formData.type === 'PostgreSQL') && authMethod !== 'connection_string' && formData.connectionMethod !== 'local' && (
                  <div className="grid gap-2">
                    <Label htmlFor="defaultSchema">Default Schema (Optional)</Label>
                    <Input
                      id="defaultSchema"
                      value={formData.defaultSchema}
                      onChange={(e) => setFormData({ ...formData, defaultSchema: e.target.value })}
                      placeholder={formData.type === 'SQL Server' ? 'dbo' : 'Leave blank to select later'}
                    />
                  </div>
                )}

                {/* SQL Server: Encrypt + Trust Server Certificate */}
                {formData.type === 'SQL Server' && authMethod !== 'connection_string' && (
                  <div className="grid gap-3 p-3 border rounded-lg bg-muted/30">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">SQL Server TLS / Encryption</p>
                    <div className="grid gap-2">
                      <Label htmlFor="encrypt">Encrypt</Label>
                      <Select
                        value={formData.encrypt || 'default'}
                        onValueChange={(value) => setFormData({ ...formData, encrypt: value === 'default' ? '' : value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Server default" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Server default</SelectItem>
                          <SelectItem value="yes">yes — Encrypt all traffic</SelectItem>
                          <SelectItem value="no">no — No encryption</SelectItem>
                          <SelectItem value="strict">strict — Strict TLS 1.3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="trustServerCertificate"
                        checked={formData.trustServerCertificate}
                        onCheckedChange={(checked) => setFormData({ ...formData, trustServerCertificate: checked })}
                      />
                      <Label htmlFor="trustServerCertificate">Trust Server Certificate (skip verification)</Label>
                    </div>
                  </div>
                )}

                {/* SSL/TLS Section (collapsible) — not for Windows Auth, Azure MI, Kerberos, connection_string, local */}
                {supportsSslConfig &&
                 !['windows_auth', 'azure_ad_integrated', 'azure_ad_mi', 'kerberos', 'connection_string'].includes(authMethod) &&
                 formData.connectionMethod !== 'local' && (
                  <div className="border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/60 text-sm font-medium transition-colors"
                      onClick={() => setSslExpanded(!sslExpanded)}
                    >
                      <span>SSL / TLS Configuration</span>
                      {sslExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {sslExpanded && (
                      <div className="grid gap-4 p-4">
                        {/* Simple SSL toggle for basic cases */}
                        <div className="flex items-center space-x-2">
                          <Switch
                            id="ssl"
                            checked={formData.useSSL}
                            onCheckedChange={(checked) => setFormData({ ...formData, useSSL: checked })}
                          />
                          <Label htmlFor="ssl">Enable SSL</Label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{t('docs.tooltipConnSsl')}</TooltipContent>
                          </Tooltip>
                        </div>

                        {/* SSL Mode Dropdown */}
                        <div className="grid gap-2">
                          <Label htmlFor="sslMode">SSL Mode</Label>
                          <Select
                            value={formData.sslMode || 'default'}
                            onValueChange={(value) => setFormData({ ...formData, sslMode: value === 'default' ? '' : value })}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Default (use Enable SSL toggle)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default (use Enable SSL toggle)</SelectItem>
                              {sslModes.map((m) => (
                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* CA Certificate */}
                        <CertInput
                          label="CA Certificate"
                          tab={certTabCa}
                          setTab={setCertTabCa}
                          pathValue={formData.sslCaPath}
                          onPathChange={(v) => setFormData({ ...formData, sslCaPath: v })}
                          pasteValue={formData.sslCa}
                          onPasteChange={(v) => setFormData({ ...formData, sslCa: v })}
                          pathPlaceholder="/etc/ssl/certs/ca.pem"
                          pastePlaceholder="-----BEGIN CERTIFICATE-----&#10;..."
                        />

                        {/* Client Certificate */}
                        <CertInput
                          label="Client Certificate"
                          tab={certTabCert}
                          setTab={setCertTabCert}
                          pathValue={formData.sslCertPath}
                          onPathChange={(v) => setFormData({ ...formData, sslCertPath: v })}
                          pasteValue={formData.sslCert}
                          onPasteChange={(v) => setFormData({ ...formData, sslCert: v })}
                          pathPlaceholder="/etc/ssl/certs/client-cert.pem"
                        />

                        {/* Client Key */}
                        <CertInput
                          label="Client Key"
                          tab={certTabKey}
                          setTab={setCertTabKey}
                          pathValue={formData.sslKeyPath}
                          onPathChange={(v) => setFormData({ ...formData, sslKeyPath: v })}
                          pasteValue={formData.sslKey}
                          onPasteChange={(v) => setFormData({ ...formData, sslKey: v })}
                          pathPlaceholder="/etc/ssl/private/client-key.pem"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Legacy SSL toggle for MySQL (outside collapsed section for quick access) */}
                {formData.type === 'MySQL' && !sslExpanded && authMethod !== 'connection_string' && formData.connectionMethod !== 'local' && (
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="ssl-mysql"
                      checked={formData.useSSL}
                      onCheckedChange={(checked) => setFormData({ ...formData, useSSL: checked })}
                    />
                    <Label htmlFor="ssl-mysql">Use SSL</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{t('docs.tooltipConnSsl')}</TooltipContent>
                    </Tooltip>
                  </div>
                )}

                {/* Generic SSL toggle for PostgreSQL (outside section) */}
                {formData.type === 'PostgreSQL' && !sslExpanded && authMethod !== 'connection_string' && !['kerberos'].includes(authMethod) && formData.connectionMethod !== 'local' && (
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="ssl"
                      checked={formData.useSSL}
                      onCheckedChange={(checked) => setFormData({ ...formData, useSSL: checked })}
                    />
                    <Label htmlFor="ssl">Use SSL</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{t('docs.tooltipConnSsl')}</TooltipContent>
                    </Tooltip>
                  </div>
                )}

              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit}>
                  {editingConnection ? 'Update' : 'Add'} Connection
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="divide-y divide-border/50">
          {user && connections.map((connection) => (
            <div key={connection.id} className="py-5 first:pt-0">
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted/50">
                      <Database className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">{connection.name}</h3>
                      <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                        <Badge variant="outline">{connection.type}</Badge>
                        {getStatusIcon(connection.status)}
                        <span className="capitalize">{connection.status}</span>
                        {connection.authMethod && connection.authMethod !== 'sql_auth' && (
                          <Badge variant="secondary" className="text-xs">
                            {AUTH_METHODS[connection.type]?.find(m => m.value === connection.authMethod)?.label || connection.authMethod}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  {connection.isDefault && (
                    <Badge variant="default" className="mt-1 flex items-center gap-1">
                      <Star className="h-3 w-3 fill-current" />
                      Default
                    </Badge>
                  )}
                  <div className="flex gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTestConnection(connection.id)}
                        >
                          Test Connection
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('docs.tooltipConnTest')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={connection.isDefault ? "default" : "outline"}
                          size="sm"
                          onClick={() => handleSetDefault(connection.id)}
                        >
                          <div className="flex items-center gap-1">
                            <Checkbox
                              checked={connection.isDefault}
                              onCheckedChange={() => handleSetDefault(connection.id)}
                              className="h-3 w-3"
                            />
                            <span className="text-xs">Default</span>
                          </div>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('docs.tooltipConnDefault', 'Set this connection as default')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(connection)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('docs.tooltipConnEdit')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(connection.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('docs.tooltipConnDelete')}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </div>
              <div className="mt-3 ml-16">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  {connection.connectionMethod === 'local' ? (
                    <>
                      <div>
                        <p className="text-muted-foreground">Method</p>
                        <Badge variant="secondary" className="mt-1">Local Agent</Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Connection Code</p>
                        <p className="font-medium font-mono text-xs">{connection.connectionCode || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Database</p>
                        <p className="font-medium">{connection.database}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <p className="font-medium">{connection.type}</p>
                      </div>
                    </>
                  ) : connection.connectionMethod === 'socket' ? (
                    <>
                      <div>
                        <p className="text-muted-foreground">Method</p>
                        <Badge variant="secondary" className="mt-1">Unix Socket</Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Socket Path</p>
                        <p className="font-medium font-mono text-xs">{connection.socketPath || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Database</p>
                        <p className="font-medium">{connection.database}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">SSL</p>
                        <p className="font-medium">{connection.sslMode || (connection.useSSL ? 'Enabled' : 'Disabled')}</p>
                      </div>
                    </>
                  ) : connection.connectionMethod === 'pipe' ? (
                    <>
                      <div>
                        <p className="text-muted-foreground">Method</p>
                        <Badge variant="secondary" className="mt-1">Named Pipe</Badge>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Pipe</p>
                        <p className="font-medium font-mono text-xs">{connection.namedPipe || '—'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Database</p>
                        <p className="font-medium">{connection.database}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <p className="font-medium">{connection.type}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-muted-foreground">Host</p>
                        <p className="font-medium">
                          {connection.namedInstance
                            ? `${connection.host}\\${connection.namedInstance}`
                            : connection.host}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Port</p>
                        <p className="font-medium">{connection.port}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Database</p>
                        <p className="font-medium">{connection.database}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">SSL</p>
                        <p className="font-medium">{connection.sslMode || (connection.useSSL ? 'Enabled' : 'Disabled')}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!user && (
            <div className="flex flex-col items-center justify-center py-16">
              <Database className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Login Required</h3>
              <p className="text-muted-foreground mb-4">
                Please log in to manage your database connections
              </p>
              <Button onClick={() => setAuthDialogOpen(true)}>
                Login / Sign Up
              </Button>
            </div>
          )}
          {user && connections.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <Database className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No connections yet</h3>
              <p className="text-muted-foreground mb-4">
                Add your first database connection to get started
              </p>
              <Button onClick={handleAdd} className="gap-2">
                <Plus className="h-4 w-4" />
                Add Connection
              </Button>
            </div>
          )}
        </div>
      </div>

      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </Layout>
  );
};

export default Connections;
