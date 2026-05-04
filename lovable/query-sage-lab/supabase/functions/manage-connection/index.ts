import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Encryption helper - uses database function for secure encryption
async function encryptCredential(supabase: any, text: string): Promise<any> {
  if (!text) return null;

  const { data, error } = await supabase.rpc('encrypt_credential', { plaintext: text });

  if (error) {
    console.error('Error encrypting credential:', error);
    throw new Error(`Encryption failed: ${error.message}`);
  }

  return data;
}

// Decryption helper - uses database function for secure decryption
async function decryptCredential(supabase: any, encrypted: any): Promise<string> {
  if (!encrypted) return '';

  try {
    const { data, error } = await supabase.rpc('decrypt_credential', { encrypted });

    if (error) {
      console.error('Error decrypting credential:', error);
      return '';
    }

    return data || '';
  } catch (e) {
    console.error('Error decrypting credential:', e);
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { action, connectionId, connectionData } = await req.json();

    if (action === 'create') {
      // Create service role client for encryption
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const insertData: any = {
        user_id: user.id,
        name: connectionData.name,
        type: connectionData.type,
        connection_method: connectionData.connectionMethod,
        host: connectionData.host,
        port: connectionData.port,
        database: connectionData.database,
        username: connectionData.username,
        use_ssl: connectionData.useSSL,
        ssh_host: connectionData.sshHost,
        ssh_port: connectionData.sshPort,
        ssh_username: connectionData.sshUsername,
        socket_path: connectionData.socketPath,
        named_pipe: connectionData.namedPipe,
        named_instance: connectionData.namedInstance,
        default_schema: connectionData.defaultSchema,
        connection_code: connectionData.connectionCode || null,
        status: 'unknown',
        is_default: connectionData.isDefault === true,
        // New auth/SSL fields
        auth_method: connectionData.authMethod || 'sql_auth',
        ssl_mode: connectionData.sslMode || null,
        ssl_ca_path: connectionData.sslCaPath || null,
        ssl_cert_path: connectionData.sslCertPath || null,
        ssl_key_path: connectionData.sslKeyPath || null,
        azure_tenant_id: connectionData.azureTenantId || null,
        azure_client_id: connectionData.azureClientId || null,
        aws_region: connectionData.awsRegion || null,
        aws_use_instance_profile: connectionData.awsUseInstanceProfile || false,
        encrypt: connectionData.encrypt || null,
        trust_server_certificate: connectionData.trustServerCertificate || false,
      };

      // Encrypt sensitive credentials
      if (connectionData.password) {
        insertData.password = await encryptCredential(supabaseAdmin, connectionData.password);
      }
      if (connectionData.sshPassword) {
        insertData.ssh_password = await encryptCredential(supabaseAdmin, connectionData.sshPassword);
      }
      if (connectionData.sshKeyFile) {
        insertData.ssh_key_file = await encryptCredential(supabaseAdmin, connectionData.sshKeyFile);
      }
      // SSL PEM content (sensitive)
      if (connectionData.sslCa) {
        insertData.ssl_ca = await encryptCredential(supabaseAdmin, connectionData.sslCa);
      }
      if (connectionData.sslCert) {
        insertData.ssl_cert = await encryptCredential(supabaseAdmin, connectionData.sslCert);
      }
      if (connectionData.sslKey) {
        insertData.ssl_key = await encryptCredential(supabaseAdmin, connectionData.sslKey);
      }
      // Azure AD sensitive fields
      if (connectionData.azureClientSecret) {
        insertData.azure_client_secret = await encryptCredential(supabaseAdmin, connectionData.azureClientSecret);
      }
      // AWS sensitive fields
      if (connectionData.awsAccessKeyId) {
        insertData.aws_access_key_id = await encryptCredential(supabaseAdmin, connectionData.awsAccessKeyId);
      }
      if (connectionData.awsSecretAccessKey) {
        insertData.aws_secret_access_key = await encryptCredential(supabaseAdmin, connectionData.awsSecretAccessKey);
      }
      // Custom connection string (sensitive)
      if (connectionData.connectionStringValue) {
        insertData.connection_string_value = await encryptCredential(supabaseAdmin, connectionData.connectionStringValue);
      }

      const { data, error } = await supabase
        .from('connections')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          success: true,
          connection: {
            ...data,
            password: null,
            ssh_password: null,
            ssh_key_file: null,
            ssl_ca: null,
            ssl_cert: null,
            ssl_key: null,
            azure_client_secret: null,
            aws_access_key_id: null,
            aws_secret_access_key: null,
            connection_string_value: null,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'update') {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const updateData: any = {
        name: connectionData.name,
        type: connectionData.type,
        connection_method: connectionData.connectionMethod,
        host: connectionData.host,
        port: connectionData.port,
        database: connectionData.database,
        username: connectionData.username,
        use_ssl: connectionData.useSSL,
        ssh_host: connectionData.sshHost,
        ssh_port: connectionData.sshPort,
        ssh_username: connectionData.sshUsername,
        socket_path: connectionData.socketPath,
        named_pipe: connectionData.namedPipe,
        named_instance: connectionData.namedInstance,
        default_schema: connectionData.defaultSchema,
        connection_code: connectionData.connectionCode || null,
        status: 'unknown',
        // New auth/SSL fields
        auth_method: connectionData.authMethod || 'sql_auth',
        ssl_mode: connectionData.sslMode || null,
        ssl_ca_path: connectionData.sslCaPath || null,
        ssl_cert_path: connectionData.sslCertPath || null,
        ssl_key_path: connectionData.sslKeyPath || null,
        azure_tenant_id: connectionData.azureTenantId || null,
        azure_client_id: connectionData.azureClientId || null,
        aws_region: connectionData.awsRegion || null,
        aws_use_instance_profile: connectionData.awsUseInstanceProfile || false,
        encrypt: connectionData.encrypt || null,
        trust_server_certificate: connectionData.trustServerCertificate || false,
      };

      if (typeof connectionData.isDefault === 'boolean') {
        updateData.is_default = connectionData.isDefault;
      }

      // Only update credentials if provided
      if (connectionData.password) {
        updateData.password = await encryptCredential(supabaseAdmin, connectionData.password);
      }
      if (connectionData.sshPassword) {
        updateData.ssh_password = await encryptCredential(supabaseAdmin, connectionData.sshPassword);
      }
      if (connectionData.sshKeyFile) {
        updateData.ssh_key_file = await encryptCredential(supabaseAdmin, connectionData.sshKeyFile);
      }
      if (connectionData.sslCa) {
        updateData.ssl_ca = await encryptCredential(supabaseAdmin, connectionData.sslCa);
      }
      if (connectionData.sslCert) {
        updateData.ssl_cert = await encryptCredential(supabaseAdmin, connectionData.sslCert);
      }
      if (connectionData.sslKey) {
        updateData.ssl_key = await encryptCredential(supabaseAdmin, connectionData.sslKey);
      }
      if (connectionData.azureClientSecret) {
        updateData.azure_client_secret = await encryptCredential(supabaseAdmin, connectionData.azureClientSecret);
      }
      if (connectionData.awsAccessKeyId) {
        updateData.aws_access_key_id = await encryptCredential(supabaseAdmin, connectionData.awsAccessKeyId);
      }
      if (connectionData.awsSecretAccessKey) {
        updateData.aws_secret_access_key = await encryptCredential(supabaseAdmin, connectionData.awsSecretAccessKey);
      }
      if (connectionData.connectionStringValue) {
        updateData.connection_string_value = await encryptCredential(supabaseAdmin, connectionData.connectionStringValue);
      }

      const { data, error } = await supabase
        .from('connections')
        .update(updateData)
        .eq('id', connectionId)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;

      return new Response(
        JSON.stringify({
          success: true,
          connection: {
            ...data,
            password: null,
            ssh_password: null,
            ssh_key_file: null,
            ssl_ca: null,
            ssl_cert: null,
            ssl_key: null,
            azure_client_secret: null,
            aws_access_key_id: null,
            aws_secret_access_key: null,
            connection_string_value: null,
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'test') {
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const { data: connection, error: fetchError } = await supabase
        .from('connections')
        .select('*')
        .eq('id', connectionId)
        .eq('user_id', user.id)
        .single();

      if (fetchError || !connection) {
        throw new Error('Connection not found');
      }

      // Decrypt all sensitive credentials
      const decryptedPassword = await decryptCredential(supabaseAdmin, connection.password);
      const decryptedSshPassword = await decryptCredential(supabaseAdmin, connection.ssh_password);
      const decryptedSshKeyFile = await decryptCredential(supabaseAdmin, connection.ssh_key_file);
      const decryptedSslCa = await decryptCredential(supabaseAdmin, connection.ssl_ca);
      const decryptedSslCert = await decryptCredential(supabaseAdmin, connection.ssl_cert);
      const decryptedSslKey = await decryptCredential(supabaseAdmin, connection.ssl_key);
      const decryptedAzureClientSecret = await decryptCredential(supabaseAdmin, connection.azure_client_secret);
      const decryptedAwsAccessKeyId = await decryptCredential(supabaseAdmin, connection.aws_access_key_id);
      const decryptedAwsSecretAccessKey = await decryptCredential(supabaseAdmin, connection.aws_secret_access_key);
      const decryptedConnectionString = await decryptCredential(supabaseAdmin, connection.connection_string_value);

      // For local agent connections, test via FastAPI directly
      if (connection.connection_method === 'local') {
        const FASTAPI_BASE_URL = Deno.env.get('FASTAPI_BASE_URL') || '';
        const FASTAPI_AUTH_TOKEN = Deno.env.get('FASTAPI_AUTH_TOKEN');

        const testResponse = await fetch(`${FASTAPI_BASE_URL}/connect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(FASTAPI_AUTH_TOKEN ? { 'Authorization': `Bearer ${FASTAPI_AUTH_TOKEN}` } : {}),
          },
          body: JSON.stringify({
            type: connection.type?.toLowerCase() || 'mysql',
            connection_method: 'local',
            connection_code: connection.connection_code,
            database: connection.database || '',
            host: connection.host || '',
            port: connection.port || 3306,
            username: connection.username || '',
            password: '',
            use_ssl: connection.use_ssl || false,
            default_schema: connection.default_schema || '',
          }),
        });

        const testResult = await testResponse.json();
        const newStatus = testResponse.ok && testResult.success ? 'connected' : 'error';

        await supabase
          .from('connections')
          .update({ status: newStatus })
          .eq('id', connectionId)
          .eq('user_id', user.id);

        return new Response(
          JSON.stringify({
            success: testResponse.ok && testResult.success,
            message: testResult.message || (testResult.success ? 'Connection successful (via local agent)' : 'Connection failed'),
            error: testResult.error || testResult.detail,
            status: newStatus,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Call test-connection function with all new fields
      const testResponse = await supabase.functions.invoke('test-connection', {
        body: {
          name: connection.name,
          type: connection.type,
          connectionMethod: connection.connection_method,
          host: connection.host,
          port: connection.port,
          database: connection.database,
          username: connection.username,
          password: decryptedPassword,
          useSSL: connection.use_ssl,
          sshHost: connection.ssh_host,
          sshPort: connection.ssh_port,
          sshUsername: connection.ssh_username,
          sshPassword: decryptedSshPassword,
          sshKeyFile: decryptedSshKeyFile,
          socketPath: connection.socket_path,
          namedPipe: connection.named_pipe,
          namedInstance: connection.named_instance,
          defaultSchema: connection.default_schema,
          authMethod: connection.auth_method,
          sslMode: connection.ssl_mode,
          sslCa: decryptedSslCa,
          sslCaPath: connection.ssl_ca_path,
          sslCert: decryptedSslCert,
          sslCertPath: connection.ssl_cert_path,
          sslKey: decryptedSslKey,
          sslKeyPath: connection.ssl_key_path,
          azureTenantId: connection.azure_tenant_id,
          azureClientId: connection.azure_client_id,
          azureClientSecret: decryptedAzureClientSecret,
          awsRegion: connection.aws_region,
          awsAccessKeyId: decryptedAwsAccessKeyId,
          awsSecretAccessKey: decryptedAwsSecretAccessKey,
          awsUseInstanceProfile: connection.aws_use_instance_profile,
          encrypt: connection.encrypt,
          trustServerCertificate: connection.trust_server_certificate,
          connectionStringValue: decryptedConnectionString,
        }
      });

      if (testResponse.error) {
        throw testResponse.error;
      }

      const testResult = testResponse.data;
      const newStatus = testResult.success ? 'connected' : 'error';

      await supabase
        .from('connections')
        .update({ status: newStatus })
        .eq('id', connectionId)
        .eq('user_id', user.id);

      return new Response(
        JSON.stringify({
          success: testResult.success,
          message: testResult.message,
          error: testResult.error,
          status: newStatus,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else if (action === 'set-default') {
      await supabase
        .from('connections')
        .update({ is_default: false })
        .eq('user_id', user.id);

      await supabase
        .from('connections')
        .update({ is_default: true })
        .eq('id', connectionId)
        .eq('user_id', user.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      throw new Error('Invalid action');
    }

  } catch (error) {
    console.error('Error in manage-connection:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
