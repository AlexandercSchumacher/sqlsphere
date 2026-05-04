import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      name,
      type,
      connectionMethod,
      host,
      port,
      database,
      username,
      password,
      useSSL,
      sshHost,
      sshPort,
      sshUsername,
      sshPassword,
      sshKeyFile,
      socketPath,
      namedPipe,
      namedInstance,
      defaultSchema,
      // New fields
      authMethod,
      sslMode,
      sslCa,
      sslCaPath,
      sslCert,
      sslCertPath,
      sslKey,
      sslKeyPath,
      azureTenantId,
      azureClientId,
      azureClientSecret,
      awsRegion,
      awsAccessKeyId,
      awsSecretAccessKey,
      awsUseInstanceProfile,
      encrypt,
      trustServerCertificate,
      connectionStringValue,
    } = await req.json();

    console.log('Testing connection:', { name, type, connectionMethod, host, port, database, authMethod });

    if (!type) {
      return new Response(
        JSON.stringify({ success: false, error: 'Database type is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For socket connections, different validation
    if (connectionMethod === 'socket') {
      if (!database || !username) {
        return new Response(
          JSON.stringify({ success: false, error: 'Database name and username are required for socket connections' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (authMethod !== 'connection_string' && connectionMethod !== 'pipe') {
      if (!host || !port || !database) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing required connection parameters' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Build common FastAPI payload
    const fastapiPayload = (dbType: string) => ({
      host: host || '',
      port: parseInt(port) || 0,
      database: database || '',
      username: username || '',
      password: password || '',
      connection_method: connectionMethod || 'standard',
      use_ssl: useSSL || false,
      ssh_host: sshHost || '',
      ssh_port: sshPort || 22,
      ssh_username: sshUsername || '',
      ssh_password: sshPassword || '',
      ssh_key_file: sshKeyFile || '',
      socket_path: socketPath || '',
      named_pipe: namedPipe || '',
      named_instance: namedInstance || '',
      default_schema: defaultSchema || '',
      type: dbType,
      auth_method: authMethod || 'sql_auth',
      ssl_mode: sslMode || null,
      ssl_ca: sslCa || null,
      ssl_ca_path: sslCaPath || null,
      ssl_cert: sslCert || null,
      ssl_cert_path: sslCertPath || null,
      ssl_key: sslKey || null,
      ssl_key_path: sslKeyPath || null,
      azure_tenant_id: azureTenantId || null,
      azure_client_id: azureClientId || null,
      azure_client_secret: azureClientSecret || null,
      aws_region: awsRegion || null,
      aws_access_key_id: awsAccessKeyId || null,
      aws_secret_access_key: awsSecretAccessKey || null,
      aws_use_instance_profile: awsUseInstanceProfile || false,
      encrypt: encrypt || null,
      trust_server_certificate: trustServerCertificate || false,
      connection_string_value: connectionStringValue || null,
    });

    const FASTAPI_BASE_URL = Deno.env.get('FASTAPI_BASE_URL') || '';
    const FASTAPI_AUTH_TOKEN = Deno.env.get('FASTAPI_AUTH_TOKEN');

    const fastapiHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(FASTAPI_AUTH_TOKEN ? { 'Authorization': `Bearer ${FASTAPI_AUTH_TOKEN}` } : {}),
    };

    let success = false;
    let errorMessage = '';

    switch (type.toLowerCase()) {
      case 'postgresql': {
        // Always route through FastAPI for full feature support (SSH, socket, SSL certs, AWS IAM, etc.)
        if (
          connectionMethod === 'ssh' ||
          connectionMethod === 'socket' ||
          authMethod === 'aws_iam' ||
          authMethod === 'kerberos' ||
          authMethod === 'azure_ad_password' ||
          authMethod === 'azure_ad_sp' ||
          sslCa ||
          sslCert ||
          sslKey ||
          authMethod === 'connection_string'
        ) {
          try {
            console.log('PostgreSQL connection test via FastAPI:', { host, port: parseInt(port), database, username, connectionMethod, authMethod });

            const response = await fetch(`${FASTAPI_BASE_URL}/connect`, {
              method: 'POST',
              headers: fastapiHeaders,
              body: JSON.stringify(fastapiPayload('postgresql')),
            });

            const result = await response.json();
            console.log('FastAPI PostgreSQL test response:', result);

            if (response.ok && result.success) {
              success = true;
            } else {
              errorMessage = result.error || result.message || result.detail || 'Failed to connect to PostgreSQL';
            }
          } catch (error) {
            errorMessage = (error as Error).message || 'Failed to connect to PostgreSQL';
            console.error('PostgreSQL FastAPI connection error:', error);
          }
        } else {
          try {
            const { Client } = await import('https://deno.land/x/postgres@v0.17.0/mod.ts');

            const clientConfig: any = {
              user: username,
              password: password,
              database: database,
              hostname: host,
              port: parseInt(port),
            };

            const client = new Client(clientConfig);

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout')), 10000)
            );

            await Promise.race([client.connect(), timeoutPromise]);
            await client.queryArray('SELECT 1');
            await client.end();

            success = true;
            console.log('PostgreSQL connection successful');
          } catch (error) {
            errorMessage = (error as Error).message || 'Failed to connect to PostgreSQL';
            console.error('PostgreSQL connection error:', error);
          }
        }
        break;
      }

      case 'mysql': {
        // Route all MySQL through FastAPI (full SSL, socket/pipe, AWS IAM, etc. support)
        try {
          console.log('MySQL connection test via FastAPI:', { host, port: parseInt(port), database, username, authMethod, connectionMethod });

          const response = await fetch(`${FASTAPI_BASE_URL}/connect`, {
            method: 'POST',
            headers: fastapiHeaders,
            body: JSON.stringify(fastapiPayload('mysql')),
          });

          const result = await response.json();
          console.log('FastAPI MySQL test response:', result);

          if (response.ok && result.success) {
            success = true;
            console.log('MySQL connection successful via FastAPI');
          } else {
            errorMessage = result.error || result.message || result.detail || 'Failed to connect to MySQL';
            console.error('MySQL connection failed via FastAPI:', errorMessage);
          }
        } catch (error) {
          errorMessage = (error as Error).message || 'Failed to connect to MySQL';
          console.error('MySQL connection error:', error);
        }
        break;
      }

      case 'sqlserver':
      case 'sql server': {
        // Route through FastAPI for SSH, Windows Auth, Azure AD, Named Instance, etc.
        if (connectionMethod === 'ssh' || connectionMethod === 'pipe' ||
            authMethod === 'windows_auth' || authMethod?.startsWith('azure_ad') ||
            authMethod === 'kerberos' || authMethod === 'connection_string' || namedInstance) {
          try {
            console.log('SQL Server connection test via FastAPI:', { host, database, authMethod, namedInstance });

            const response = await fetch(`${FASTAPI_BASE_URL}/connect`, {
              method: 'POST',
              headers: fastapiHeaders,
              body: JSON.stringify(fastapiPayload('sqlserver')),
            });

            const result = await response.json();
            console.log('FastAPI SQL Server test response:', result);

            if (response.ok && result.success) {
              success = true;
            } else {
              errorMessage = result.error || result.message || result.detail || 'Failed to connect to SQL Server';
            }
          } catch (error) {
            errorMessage = (error as Error).message || 'Failed to connect to SQL Server via FastAPI';
            console.error('SQL Server FastAPI connection error:', error);
          }
        } else {
          try {
            const { connect } = await import('https://deno.land/x/mssql@v0.2.0/mod.ts');

            const config = {
              server: host,
              port: parseInt(port),
              database: database,
              user: username,
              password: password,
              options: {
                encrypt: encrypt === 'yes' || encrypt === 'strict' || useSSL || false,
                trustServerCertificate: trustServerCertificate || true,
              },
            };

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Connection timeout')), 10000)
            );

            const pool = await Promise.race([connect(config), timeoutPromise]);
            await pool.query`SELECT 1 AS test`;
            await pool.close();

            success = true;
            console.log('SQL Server connection successful');
          } catch (error) {
            errorMessage = (error as Error).message || 'Failed to connect to SQL Server';
            console.error('SQL Server connection error:', error);
          }
        }
        break;
      }

      case 'oracle': {
        try {
          console.log('Oracle connection test via FastAPI:', { host, port: parseInt(port), database, username, authMethod });

          const response = await fetch(`${FASTAPI_BASE_URL}/connect`, {
            method: 'POST',
            headers: fastapiHeaders,
            body: JSON.stringify(fastapiPayload('oracle')),
          });

          const result = await response.json();
          console.log('FastAPI Oracle test response:', result);

          if (response.ok && result.success) {
            success = true;
            console.log('Oracle connection successful via FastAPI');
          } else {
            errorMessage = result.error || result.message || result.detail || 'Failed to connect to Oracle';
          }
        } catch (error) {
          errorMessage = (error as Error).message || 'Failed to connect to Oracle';
          console.error('Oracle connection error:', error);
        }
        break;
      }

      default:
        errorMessage = `Unsupported database type: ${type}`;
        console.log('Unsupported database type:', type);
    }

    return new Response(
      JSON.stringify({
        success,
        error: errorMessage || undefined,
        message: success ? 'Connection successful' : errorMessage
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in test-connection function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Internal server error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
