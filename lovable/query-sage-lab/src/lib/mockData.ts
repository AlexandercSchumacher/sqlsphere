export type DatabaseType = 'PostgreSQL' | 'MySQL' | 'SQL Server' | 'Oracle';
export type ConnectionMethod = 'standard' | 'ssh' | 'socket' | 'pipe' | 'local';

export type AuthMethod =
  | 'sql_auth'
  | 'windows_auth'
  | 'ssl_cert'
  | 'aws_iam'
  | 'azure_ad_password'
  | 'azure_ad_integrated'
  | 'azure_ad_mfa'
  | 'azure_ad_sp'
  | 'azure_ad_mi'
  | 'kerberos'
  | 'connection_string';

export type SSLMode =
  // PostgreSQL modes
  | 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full'
  // MySQL modes
  | 'disabled' | 'preferred' | 'required' | 'verify_ca' | 'verify_identity';

export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  connectionMethod?: ConnectionMethod;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  useSSL: boolean;
  // SSH Tunnel fields
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshKeyFile?: string;
  // Socket/Pipe fields
  socketPath?: string;
  namedPipe?: string;
  namedInstance?: string;
  // Default schema
  defaultSchema?: string;
  // Default connection flag
  isDefault?: boolean;
  status: 'connected' | 'error' | 'unknown' | 'loading';
  // Local agent
  connectionCode?: string;

  // Authentication method
  authMethod?: AuthMethod;

  // SSL/TLS configuration
  sslMode?: SSLMode;
  sslCa?: string;      // PEM content
  sslCaPath?: string;  // file path
  sslCert?: string;    // PEM content
  sslCertPath?: string;
  sslKey?: string;     // PEM content
  sslKeyPath?: string;

  // Azure AD
  azureTenantId?: string;
  azureClientId?: string;
  azureClientSecret?: string;

  // AWS IAM
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsUseInstanceProfile?: boolean;

  // SQL Server specific
  encrypt?: 'yes' | 'no' | 'strict';
  trustServerCertificate?: boolean;

  // Raw connection string (expert mode)
  connectionStringValue?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  databaseId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  sqlQuery?: string;
  tableData?: any[];
  timestamp: Date;
  isErrorSuggestion?: boolean;  // True if this message contains SQL fix suggestion after an error
}

export interface SchemaNode {
  name: string;
  type: 'schema' | 'table' | 'view' | 'procedure' | 'column' | 'group' | 'function' | 'trigger' | 'sequence' | 'materializedView';
  dataType?: string;
  children?: SchemaNode[];
}

export const mockConnections: DatabaseConnection[] = [
  {
    id: '1',
    name: 'Production DB',
    type: 'PostgreSQL',
    host: 'prod-db.example.com',
    port: 5432,
    database: 'maindb',
    username: 'admin',
    password: '********',
    useSSL: true,
    isDefault: true,
    status: 'connected',
  },
  {
    id: '2',
    name: 'Analytics DB',
    type: 'MySQL',
    host: 'analytics.example.com',
    port: 3306,
    database: 'analytics',
    username: 'analyst',
    password: '********',
    useSSL: false,
    status: 'connected',
  },
  {
    id: '3',
    name: 'Dev Database',
    type: 'SQL Server',
    host: 'dev-sql.example.com',
    port: 1433,
    database: 'devdb',
    username: 'developer',
    password: '********',
    useSSL: false,
    status: 'error',
  },
];

export const mockChatSessions: ChatSession[] = [
  {
    id: '1',
    title: 'Sales Analysis',
    databaseId: '1',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  },
  {
    id: '2',
    title: 'User Metrics',
    databaseId: '2',
    createdAt: new Date('2024-01-14'),
    updatedAt: new Date('2024-01-14'),
  },
];

export const mockMessages: ChatMessage[] = [
  {
    id: '1',
    sessionId: '1',
    role: 'user',
    content: 'Show me total sales by region for last month',
    timestamp: new Date('2024-01-15T10:00:00'),
  },
  {
    id: '2',
    sessionId: '1',
    role: 'assistant',
    content: 'Here are the total sales by region for last month:',
    sqlQuery: 'SELECT region, SUM(amount) as total_sales FROM sales WHERE date >= \'2023-12-01\' AND date < \'2024-01-01\' GROUP BY region ORDER BY total_sales DESC',
    tableData: [
      { region: 'North America', total_sales: 1250000 },
      { region: 'Europe', total_sales: 980000 },
      { region: 'Asia', total_sales: 750000 },
      { region: 'South America', total_sales: 420000 },
    ],
    timestamp: new Date('2024-01-15T10:00:05'),
  },
];

export const mockSchema: SchemaNode[] = [
  {
    name: 'public',
    type: 'schema',
    children: [
      {
        name: 'users',
        type: 'table',
        children: [
          { name: 'id', type: 'column', dataType: 'integer' },
          { name: 'email', type: 'column', dataType: 'varchar(255)' },
          { name: 'name', type: 'column', dataType: 'varchar(100)' },
          { name: 'created_at', type: 'column', dataType: 'timestamp' },
        ],
      },
      {
        name: 'sales',
        type: 'table',
        children: [
          { name: 'id', type: 'column', dataType: 'integer' },
          { name: 'region', type: 'column', dataType: 'varchar(50)' },
          { name: 'amount', type: 'column', dataType: 'decimal(10,2)' },
          { name: 'date', type: 'column', dataType: 'date' },
        ],
      },
    ],
  },
];
