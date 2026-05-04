import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: {
  waitUntil: (promise: Promise<any>) => void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Large file threshold (5MB base64 = ~3.75MB file)
const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024;

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const fastApiAuthToken = Deno.env.get('FASTAPI_AUTH_TOKEN');
    const fastApiBaseUrl = Deno.env.get('FASTAPI_BASE_URL') || '';

    // Validate required environment variables
    if (!supabaseUrl || !supabaseServiceKey || !fastApiAuthToken) {
      console.error('Missing required environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the authorization header from the request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's token to verify authentication
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify the user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      console.error('Authentication error:', authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { endpoint, connectionId, ...params } = await req.json();

    // Create service client early for endpoints that don't need connection
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);

    // Handle all /api/* endpoints — proxy to FastAPI backend
    if (endpoint?.startsWith('/api/')) {
      const method = params.method || req.method || 'GET';
      // Always append user_id as query param (some POST endpoints also need it)
      let url = `${fastApiBaseUrl}${endpoint}`;
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}user_id=${user.id}`;

      const requestOptions: RequestInit = {
        method,
        headers: {
          'Authorization': `Bearer ${fastApiAuthToken}`,
          'Content-Type': 'application/json',
        },
      };

      if ((method === 'POST' || method === 'PUT') && params.body) {
        // Inject user_id into body for create/update requests
        const bodyWithUser = { ...params.body, user_id: user.id };
        requestOptions.body = JSON.stringify(bodyWithUser);
      }

      const response = await fetch(url, requestOptions);
      const responseText = await response.text();
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error(`FastAPI /api/* endpoint returned non-JSON response (status ${response.status}):`, responseText.substring(0, 200));
        data = { error: `Backend returned non-JSON response (status ${response.status})` };
      }

      return new Response(
        JSON.stringify(data),
        {
          status: response.ok ? response.status : 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Handle import status check endpoint (doesn't need connectionId)
    if (endpoint === '/upload/import-status') {
      const jobId = params.job_id;
      if (!jobId) {
        return new Response(
          JSON.stringify({ error: 'Missing job_id parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Fetch import status from import_history
      const { data: importJob, error: fetchError } = await serviceSupabase
        .from('import_history')
        .select('*')
        .eq('id', jobId)
        .eq('user_id', user.id)
        .single();
      
      if (fetchError || !importJob) {
        return new Response(
          JSON.stringify({ error: 'Import job not found', job_id: jobId }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Check if still processing (rows_imported = -1)
      const isProcessing = importJob.rows_imported === -1;
      const hasError = importJob.rows_failed === -1;
      
      return new Response(
        JSON.stringify({
          job_id: jobId,
          status: isProcessing ? 'processing' : (hasError ? 'error' : 'complete'),
          rows_imported: isProcessing ? 0 : importJob.rows_imported,
          rows_failed: hasError ? 0 : importJob.rows_failed,
          total_rows: importJob.total_rows,
          error_summary: importJob.error_summary,
          warnings: importJob.warnings,
          success: !isProcessing && !hasError && importJob.rows_imported > 0,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle session refresh (doesn't need connectionId, just session_id)
    if (endpoint === '/session-refresh') {
      const sessionId = params.session_id;
      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'Missing session_id parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const refreshUrl = `${fastApiBaseUrl}/session/${sessionId}/refresh`;
      const refreshResponse = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fastApiAuthToken}`,
          'Content-Type': 'application/json',
        },
      });

      const refreshData = await refreshResponse.json().catch(() => ({}));
      return new Response(
        JSON.stringify(refreshData),
        { status: refreshResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle session validation (doesn't need connectionId, just session_id)
    if (endpoint === '/session-validate') {
      const sessionId = params.session_id;
      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: 'Missing session_id parameter' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const validateUrl = `${fastApiBaseUrl}/session/${sessionId}`;
      const validateResponse = await fetch(validateUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${fastApiAuthToken}`,
        },
      });

      const validateData = await validateResponse.json().catch(() => ({}));
      return new Response(
        JSON.stringify(validateData),
        { status: validateResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!endpoint || !connectionId) {
      return new Response(
        JSON.stringify({ error: 'Missing endpoint or connectionId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`User ${user.id} requesting ${endpoint} for connection ${connectionId}`, {
      hasFile: !!params.file,
      hasFilename: !!params.filename,
      fileType: typeof params.file,
      fileLength: params.file?.length || 0,
      filename: params.filename,
      paramKeys: Object.keys(params),
      paramValues: Object.keys(params).reduce((acc, key) => {
        if (key === 'file') {
          acc[key] = `[base64 string, length: ${params[key]?.length || 0}]`;
        } else {
          acc[key] = params[key];
        }
        return acc;
      }, {} as Record<string, any>)
    });

    // Fetch connection details with service role key (to decrypt credentials)
    const { data: connection, error: fetchError } = await serviceSupabase
      .from('connections')
      .select('*')
      .eq('id', connectionId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !connection) {
      console.error('Error fetching connection:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Connection not found or access denied' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt credentials server-side using database function
    const decryptedPassword = await decryptCredential(serviceSupabase, connection.password);
    const decryptedSshPassword = await decryptCredential(serviceSupabase, connection.ssh_password);
    const decryptedSshKeyFile = await decryptCredential(serviceSupabase, connection.ssh_key_file);
    const decryptedSslCa = await decryptCredential(serviceSupabase, connection.ssl_ca);
    const decryptedSslCert = await decryptCredential(serviceSupabase, connection.ssl_cert);
    const decryptedSslKey = await decryptCredential(serviceSupabase, connection.ssl_key);
    const decryptedAzureClientSecret = await decryptCredential(serviceSupabase, connection.azure_client_secret);
    const decryptedAwsAccessKeyId = await decryptCredential(serviceSupabase, connection.aws_access_key_id);
    const decryptedAwsSecretAccessKey = await decryptCredential(serviceSupabase, connection.aws_secret_access_key);
    const decryptedConnectionString = await decryptCredential(serviceSupabase, connection.connection_string_value);

    const dbParams = {
      host: connection.host,
      port: connection.port,
      database: connection.database,
      username: connection.username,
      password: decryptedPassword,
      connection_method: connection.connection_method,
      use_ssl: connection.use_ssl,
      ssh_host: connection.ssh_host,
      ssh_port: connection.ssh_port,
      ssh_username: connection.ssh_username,
      ssh_password: decryptedSshPassword,
      ssh_key_file: decryptedSshKeyFile,
      socket_path: connection.socket_path,
      named_pipe: connection.named_pipe,
      named_instance: connection.named_instance,
      default_schema: connection.default_schema,
      auth_method: connection.auth_method,
      ssl_mode: connection.ssl_mode,
      ssl_ca: decryptedSslCa || null,
      ssl_ca_path: connection.ssl_ca_path,
      ssl_cert: decryptedSslCert || null,
      ssl_cert_path: connection.ssl_cert_path,
      ssl_key: decryptedSslKey || null,
      ssl_key_path: connection.ssl_key_path,
      azure_tenant_id: connection.azure_tenant_id,
      azure_client_id: connection.azure_client_id,
      azure_client_secret: decryptedAzureClientSecret || null,
      aws_region: connection.aws_region,
      aws_access_key_id: decryptedAwsAccessKeyId || null,
      aws_secret_access_key: decryptedAwsSecretAccessKey || null,
      aws_use_instance_profile: connection.aws_use_instance_profile || false,
      encrypt: connection.encrypt,
      trust_server_certificate: connection.trust_server_certificate || false,
      connection_string_value: decryptedConnectionString || null,
      connection_code: connection.connection_code || undefined, // For local agent connections
      type: connection.type.toLowerCase(), // Convert to lowercase for FastAPI validation
    };

    // Session handling for endpoints that rely on a FastAPI session.
    let fastApiSessionId: string | undefined = undefined;

    const createFastApiSession = async (): Promise<string> => {
      const connectUrl = `${fastApiBaseUrl}/connect`;
      const connectResponse = await fetch(connectUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${fastApiAuthToken}`,
        },
        body: JSON.stringify(dbParams),
      });

      const connectData = await connectResponse.json().catch(() => ({}));
      if (!connectResponse.ok) {
        console.error('Failed to create FastAPI session:', connectData);
        const isLocalAgent = dbParams.connection_method === 'local';
        const errorMessage = isLocalAgent
          ? 'Local agent not responding. Please ensure the agent is running with your saved connection code.'
          : 'Failed to establish database session';
        throw {
          status: connectResponse.status,
          error: errorMessage,
          details: connectData,
        };
      }

      const createdSessionId = connectData?.session_id as string | undefined;
      if (!createdSessionId) {
        console.error('No session_id returned from /connect');
        throw {
          status: 500,
          error: 'Failed to get session ID from FastAPI',
          details: connectData,
        };
      }

      console.log(`Created FastAPI session: ${createdSessionId.substring(0, 8)}...`);
      return createdSessionId;
    };

    const cacheFastApiSession = async (sessionId: string) => {
      try {
        const { data: existingConnection } = await serviceSupabase
          .from('connections')
          .select('metadata')
          .eq('id', connectionId)
          .single();

        const existingMetadata = existingConnection?.metadata || {};
        await serviceSupabase
          .from('connections')
          .update({
            metadata: {
              ...existingMetadata,
              fastapi_session_id: sessionId,
              fastapi_session_created_at: new Date().toISOString(),
            },
          })
          .eq('id', connectionId);
      } catch (cacheError) {
        console.error('Failed to cache FastAPI session in connection metadata:', cacheError);
      }
    };

    // /chat keeps the existing behavior: reuse cached session for pending actions.
    if (endpoint === '/chat') {
      if (params.pendingActionId) {
        const { data: connectionData } = await serviceSupabase
          .from('connections')
          .select('metadata')
          .eq('id', connectionId)
          .single();

        if (connectionData?.metadata?.fastapi_session_id) {
          fastApiSessionId = connectionData.metadata.fastapi_session_id;
          console.log(`Reusing cached FastAPI session: ${fastApiSessionId?.substring(0, 8)}...`);
        }
      }

      if (!fastApiSessionId) {
        console.log('Creating new FastAPI session for chat endpoint');
        try {
          fastApiSessionId = await createFastApiSession();
          await cacheFastApiSession(fastApiSessionId);
        } catch (e: any) {
          return new Response(
            JSON.stringify({
              error: e?.error || 'Failed to establish database session',
              details: e?.details || e,
            }),
            {
              status: e?.status || 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
      }
    }

    // Build FastAPI request
    const fastApiUrl = `${fastApiBaseUrl}${endpoint}`;
    
    // Remove session_id from params if it exists (for /chat endpoint, we use the FastAPI session)
    const { session_id: _, ...paramsWithoutSessionId } = params;
    
    // Handle file upload endpoints (send base64 in JSON body)
    let requestBody: any;
    
    // Check which upload endpoints require file_base64
    // /upload/preview and /upload/import require file_base64
    // /upload/create-table and /upload/mapping do NOT require file_base64
    const uploadEndpointsRequiringFile = ['/upload/preview', '/upload/import'];
    const requiresFile = uploadEndpointsRequiringFile.some(ep => endpoint.includes(ep));
    
    if (endpoint.includes('/upload/')) {
      // For upload endpoints, send base64 file in JSON body
      // FastAPI expects connection as a JSON string
      
      console.log('Processing upload endpoint, params received:', {
        paramKeys: Object.keys(params),
        hasFile: 'file' in params,
        hasFilename: 'filename' in params,
        fileType: typeof params.file,
        fileValue: params.file ? `[string, length: ${params.file.length}]` : params.file,
        filenameValue: params.filename
      });
      
      // Build request body with connection
      requestBody = {
        connection: JSON.stringify(dbParams),
      };
      
      if (requiresFile) {
        // Check if we have a storage_path (for large files) or file_base64 (for small files)
        const storagePath = params.storage_path || params.storagePath;
        const fileBase64 = params.file || params.file_base64 || params.fileBase64;
        const fileName = params.filename || params.fileName;
        
        if (storagePath) {
          // Download file from Storage and convert to Base64
          // Files are limited to 25MB, so Base64 conversion is safe
          console.log('Downloading file from Storage:', storagePath);
          
          try {
            // Security: Validate and sanitize the storage path to prevent path traversal attacks
            // Remove any path traversal attempts (../, ..\, etc.)
            let sanitizedPath = storagePath.replace(/\.\./g, '').replace(/\\/g, '/');
            
            // Clean up the storage path - remove 'imports/' prefix if present
            // download expects path relative to bucket (without bucket name)
            let cleanPath = sanitizedPath;
            if (cleanPath.startsWith('imports/')) {
              cleanPath = cleanPath.substring('imports/'.length);
            }
            
            // Security: Additional validation - path should not be empty and should not contain dangerous characters
            if (!cleanPath || cleanPath.trim().length === 0) {
              console.error('Invalid storage path after sanitization:', storagePath);
              return new Response(
                JSON.stringify({ 
                  error: 'Invalid file path',
                  details: 'Storage path is invalid or empty after sanitization'
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            
            // Security: Validate path format (should be user_id/timestamp_filename)
            // Path should not start with / and should match expected pattern
            if (cleanPath.startsWith('/') || cleanPath.includes('//')) {
              console.error('Invalid path format:', cleanPath);
              return new Response(
                JSON.stringify({ 
                  error: 'Invalid file path format',
                  details: 'Path contains invalid characters or format'
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            
            // Debug: Log the path we're trying to access
            console.log('Attempting to download file directly:', {
              originalPath: storagePath,
              sanitizedPath: sanitizedPath,
              cleanPath: cleanPath,
              bucket: 'imports'
            });
            
            // Download file directly using Service Role Key (bypasses policies)
            let fileData: Blob | null = null;
            let downloadError: any = null;
            
            // Try alternative path formats
            const pathVariations = [
              cleanPath, // user_id/timestamp_filename
              storagePath.replace(/^imports\//, ''), // Remove imports/ if present
              `imports/${cleanPath}`, // Add imports/ prefix
            ];
            
            // Remove duplicates
            const uniquePaths = [...new Set(pathVariations)];
            
            console.log('Trying to download file with paths:', uniquePaths);
            
            for (const pathToTry of uniquePaths) {
              console.log(`Attempting to download with path: "${pathToTry}"`);
              const result = await serviceSupabase
                .storage
                .from('imports')
                .download(pathToTry);
              
              if (!result.error && result.data) {
                fileData = result.data;
                console.log(`✅ Successfully downloaded with path: "${pathToTry}"`);
                break;
              } else {
                console.log(`❌ Failed with path "${pathToTry}":`, result.error?.message || result.error);
                downloadError = result.error;
              }
            }
            
            if (!fileData) {
              console.error('Failed to download file from Storage after trying all paths:', {
                originalPath: storagePath,
                cleanPath: cleanPath,
                triedPaths: uniquePaths,
                lastError: downloadError
              });
              return new Response(
                JSON.stringify({ 
                  error: 'Failed to download file from Storage',
                  details: downloadError?.message || 'File not found. Please ensure the file was uploaded successfully.',
                  debug: {
                    originalPath: storagePath,
                    cleanPath: cleanPath,
                    triedPaths: uniquePaths
                  }
                }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            
            // Convert blob to base64 (in chunks to avoid stack overflow)
            // Files are limited to 25MB, so Base64 conversion is safe (25MB -> ~33MB Base64)
            const arrayBuffer = await fileData.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binaryString = '';
            const chunkSize = 8192; // Process in 8KB chunks
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.slice(i, i + chunkSize);
              // Convert Uint8Array chunk to array for String.fromCharCode
              const chunkArray = Array.from(chunk);
              binaryString += String.fromCharCode(...chunkArray);
            }
            const base64Content = btoa(binaryString);
            
            console.log('Successfully downloaded file and converted to base64, length:', base64Content.length);
            // Send base64 content to FastAPI - DO NOT send storage_path as FastAPI will try to download it again
            requestBody.file_base64 = base64Content;
            // Note: Intentionally NOT sending storage_path to prevent FastAPI from trying to download
          } catch (e) {
            console.error('Error generating signed URL:', e);
            return new Response(
              JSON.stringify({ 
                error: 'Failed to generate file access URL',
                details: e instanceof Error ? e.message : 'Unknown error'
              }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } else if (fileBase64 !== undefined && fileBase64 !== null && fileBase64 !== '') {
          // Small file: use provided base64
          requestBody.file_base64 = String(fileBase64); // Ensure it's a string
          console.log('Added file_base64 to request body, length:', requestBody.file_base64.length);
        } else {
          console.error('ERROR: Neither storage_path nor file_base64 provided!', {
            hasStoragePath: !!storagePath,
            hasFileBase64: !!fileBase64,
            fileBase64Type: typeof fileBase64,
            allParamKeys: Object.keys(params)
          });
          // Return error immediately if file_base64 is missing for endpoints that require it
          return new Response(
            JSON.stringify({ 
              error: 'Missing file parameter',
              details: 'Either storage_path or file_base64 is required for /upload/preview and /upload/import endpoints',
              receivedParams: Object.keys(params)
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        // Add filename if present
        if (fileName !== undefined && fileName !== null && fileName !== '') {
          requestBody.filename = String(fileName);
          console.log('Added filename to request body:', requestBody.filename);
        }
        
        // Add parsing parameters if provided (encoding, delimiter, header_row, skip_rows)
        if (params.encoding) requestBody.encoding = params.encoding;
        if (params.delimiter) requestBody.delimiter = params.delimiter;
        if (params.header_row !== undefined) requestBody.header_row = params.header_row;
        if (params.skip_rows !== undefined) requestBody.skip_rows = params.skip_rows;
      }
      
      // Add other parameters (excluding session_id, file, filename, file_base64, storage_path, encoding, delimiter, header_row, skip_rows, and connectionId/endpoint)
      // Note: duplicate_handling should be passed through
      const { file: _, filename: __, session_id: ___, file_base64: ____, fileBase64: _____, storage_path: ______, storagePath: _______, encoding: ________, delimiter: _________, header_row: __________, skip_rows: ___________, ...otherParams } = params;
      for (const [key, value] of Object.entries(otherParams)) {
        if (key !== 'connectionId' && key !== 'endpoint') {
          requestBody[key] = value;
        }
      }
      
      // Final check - ensure file_base64 is present for endpoints that require it
      // (storage_path is converted to file_base64 by the edge function, not sent to FastAPI)
      if (requiresFile && !requestBody.file_base64) {
        console.error('CRITICAL: file_base64 is not present after processing!', {
          requestBodyKeys: Object.keys(requestBody),
          paramsKeys: Object.keys(params),
          hasStoragePath: !!(params.storage_path || params.storagePath),
          fileBase64InParams: 'file' in params,
          paramsFile: params.file,
          paramsFileType: typeof params.file
        });
        return new Response(
          JSON.stringify({ 
            error: 'Missing file parameter',
            details: 'file_base64 is required for /upload/preview and /upload/import endpoints but was not found in request',
            receivedParams: Object.keys(params),
            requestBodyKeys: Object.keys(requestBody)
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      // Log for debugging (storage_path and file_url will be removed before sending to FastAPI)
      console.log('Upload endpoint request body final:', {
        hasConnection: !!requestBody.connection,
        hasFileBase64: !!requestBody.file_base64,
        hasFilename: !!requestBody.filename,
        fileBase64Length: requestBody.file_base64?.length || 0,
        filename: requestBody.filename,
        requestBodyKeys: Object.keys(requestBody)
      });
    } else if (endpoint === '/query') {
      // For /query endpoint, send connection as object and query separately
      requestBody = {
        connection: dbParams,
        query: params.query,
      };
      // Include session_id if provided (for local agent connections)
      if (params.session_id) {
        requestBody.session_id = params.session_id;
      }
    } else if (endpoint === '/object-definition') {
      // For /object-definition endpoint, send connection as object and convert camelCase to snake_case
      requestBody = {
        connection: dbParams,
        object_name: params.objectName || params.object_name,
        object_type: params.objectType || params.object_type,
        schema: params.schema || null,
      };
    } else {
      // Regular JSON request
      requestBody = {
        ...dbParams,
        ...paramsWithoutSessionId,
        // Pass through session_id for non-chat endpoints
        ...(endpoint !== '/chat' && params.session_id ? { session_id: params.session_id } : {}),
        // Always use the FastAPI session ID for /chat endpoint
        ...(endpoint === '/chat' && fastApiSessionId ? { session_id: fastApiSessionId } : {}),
      };
    }

    console.log(`Forwarding request to FastAPI: ${fastApiUrl}`, {
      endpoint,
      hasSessionId: !!requestBody.session_id,
      sessionId: requestBody.session_id?.substring(0, 8) + '...',
      hasFileBase64: !!requestBody.file_base64,
      hasFilename: !!requestBody.filename,
      fileBase64Length: requestBody.file_base64?.length || 0
    });

    // CRITICAL: Remove storage_path and file_url from requestBody before sending to FastAPI
    // FastAPI cannot download from Supabase storage (it has a proxy client init error)
    // We must only send file_base64 which we already downloaded and converted
    if (requestBody.storage_path) {
      console.log('Removing storage_path from requestBody - FastAPI should only receive file_base64');
      delete requestBody.storage_path;
    }
    if (requestBody.file_url) {
      console.log('Removing file_url from requestBody - FastAPI should only receive file_base64');
      delete requestBody.file_url;
    }

    // Make authenticated request to FastAPI
    // For upload endpoints that require file (preview and import), check that file_base64 is present
    // Note: /upload/create-table and /upload/mapping do NOT require file_base64
    if (requiresFile && !requestBody.file_base64) {
      console.error('CRITICAL: file_base64 not present before sending to FastAPI!', {
        endpoint,
        requestBodyKeys: Object.keys(requestBody),
        requestBody: JSON.stringify(requestBody).substring(0, 500)
      });
      return new Response(
        JSON.stringify({ 
          error: 'Internal error: file parameter missing',
          details: 'file_base64 must be set in request body before sending to FastAPI'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Log the actual request body being sent (sanitize credentials and truncate file_base64 for logging)
    const sanitizeForLogging = (obj: Record<string, unknown>): Record<string, unknown> => {
      const sensitiveFields = ['password', 'ssh_password', 'ssh_key_file'];
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveFields.includes(key) && value) {
          sanitized[key] = '[REDACTED]';
        } else if (key === 'file_base64' && typeof value === 'string') {
          sanitized[key] = `[TRUNCATED: ${value.length} chars]`;
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    };
    const logRequestBody = sanitizeForLogging(requestBody);
    console.log('Sending request to FastAPI:', {
      url: fastApiUrl,
      method: 'POST',
      requestBodyKeys: Object.keys(requestBody),
      requestBodyPreview: logRequestBody,
      fileBase64Present: !!requestBody.file_base64,
      fileBase64Length: requestBody.file_base64?.length || 0,
      fileBase64Type: typeof requestBody.file_base64
    });
    
    // Serialize request body to JSON
    let requestBodyJson: string;
    try {
      requestBodyJson = JSON.stringify(requestBody);
      console.log('Request body JSON serialized successfully, length:', requestBodyJson.length);
    } catch (e) {
      console.error('Failed to serialize request body to JSON:', e);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to serialize request',
          details: String(e)
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Check if this is a large file import that should run in background
    const isLargeImport = endpoint.includes('/upload/import') && 
                          requestBody.file_base64 && 
                          requestBody.file_base64.length > LARGE_FILE_THRESHOLD;
    
    if (isLargeImport) {
      console.log('Large file import detected, using background processing', {
        fileSize: requestBody.file_base64.length,
        threshold: LARGE_FILE_THRESHOLD
      });
      
      // Create a job ID for tracking
      const jobId = crypto.randomUUID();
      
      // Create preliminary import_history record with 'processing' status (rows_imported = -1)
      try {
        const { error: insertError } = await serviceSupabase
          .from('import_history')
          .insert({
            id: jobId,
            user_id: user.id,
            connection_id: connectionId,
            filename: requestBody.filename || 'unknown',
            table_name: requestBody.table_name || 'unknown',
            schema_name: requestBody.schema || null,
            rows_imported: -1, // -1 indicates 'processing'
            rows_failed: 0,
            total_rows: 0,
            duplicate_handling: requestBody.duplicate_handling || 'error',
            mapping: typeof requestBody.mapping === 'string' ? JSON.parse(requestBody.mapping) : requestBody.mapping,
            file_columns: typeof requestBody.file_columns === 'string' ? JSON.parse(requestBody.file_columns) : requestBody.file_columns,
          });
        
        if (insertError) {
          console.error('Failed to create import job record:', insertError);
        } else {
          console.log('Created import job record:', jobId);
        }
      } catch (e) {
        console.error('Error creating import job record:', e);
      }
      
      // Define background task
      const backgroundImport = async () => {
        console.log('Starting background import for job:', jobId);
        try {
          const response = await fetch(fastApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${fastApiAuthToken}`,
            },
            body: requestBodyJson,
          });
          
          const responseText = await response.text();
          let responseData: any;
          
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = { error: responseText };
          }
          
          console.log('Background import completed:', {
            jobId,
            status: response.status,
            success: response.ok,
            rowsImported: responseData.rows_imported,
            rowsFailed: responseData.rows_failed
          });
          
          // Update import_history with results
          const updateData: any = {
            rows_imported: responseData.rows_imported || 0,
            rows_failed: responseData.rows_failed || 0,
            total_rows: responseData.total_rows || 0,
            error_summary: responseData.error_summary || (response.ok ? null : responseData.error || 'Import failed'),
            warnings: responseData.warnings || [],
          };
          
          const { error: updateError } = await serviceSupabase
            .from('import_history')
            .update(updateData)
            .eq('id', jobId);
          
          if (updateError) {
            console.error('Failed to update import job record:', updateError);
          } else {
            console.log('Updated import job record:', jobId);
          }
        } catch (e) {
          console.error('Background import failed:', e);
          // Update with error
          await serviceSupabase
            .from('import_history')
            .update({
              rows_imported: 0,
              rows_failed: -1, // -1 for rows_failed indicates error
              error_summary: e instanceof Error ? e.message : 'Background import failed',
            })
            .eq('id', jobId);
        }
      };
      
      // Start background task
      EdgeRuntime.waitUntil(backgroundImport());
      
      // Return immediately with job ID
      return new Response(
        JSON.stringify({
          status: 'processing',
          job_id: jobId,
          message: 'Import started in background. Poll /upload/import-status for results.',
        }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // For small files or non-import endpoints, proceed synchronously
    // Determine if this is a GET endpoint (e.g., /session/{id}/query-results)
    const isGetEndpoint = endpoint.match(/^\/session\/[^/]+\/query-results/);
    
    let fastApiResponse: Response;
    if (isGetEndpoint) {
      // For GET endpoints, pass params as query string
      const queryParams = new URLSearchParams();
      if (params.limit) queryParams.append('limit', String(params.limit));
      const getUrl = queryParams.toString() ? `${fastApiUrl}?${queryParams.toString()}` : fastApiUrl;
      
      console.log('Making GET request to FastAPI:', { url: getUrl });
      fastApiResponse = await fetch(getUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${fastApiAuthToken}`,
        },
      });
    } else {
      fastApiResponse = await fetch(fastApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${fastApiAuthToken}`,
      },
        body: requestBodyJson,
      });
    }

    // Check if this is an HTML response (e.g., /visualization/html)
    // Extract base endpoint without query params for checking
    const baseEndpoint = endpoint.split('?')[0];
    const contentType = fastApiResponse.headers.get('content-type') || '';
    const isHtmlResponse = contentType.includes('text/html') || baseEndpoint.includes('/visualization/html');
    
    // Read response body once
    const responseText = await fastApiResponse.text();
    
    console.log('FastAPI response:', {
      endpoint,
      baseEndpoint,
      contentType,
      isHtmlResponse,
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 100),
      status: fastApiResponse.status,
      ok: fastApiResponse.ok
    });
    
    // If it's an HTML response, return it directly
    if (isHtmlResponse) {
      if (!fastApiResponse.ok) {
        console.error('FastAPI HTML response error:', {
          status: fastApiResponse.status,
          statusText: fastApiResponse.statusText,
          responsePreview: responseText.substring(0, 200)
        });
        return new Response(
          JSON.stringify({ 
            error: 'Failed to generate visualization',
            details: responseText.substring(0, 500)
          }),
          { 
            status: fastApiResponse.status, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      if (!responseText || responseText.trim().length === 0) {
        console.error('Empty HTML response from FastAPI');
        return new Response(
          JSON.stringify({ 
            error: 'Empty HTML response from server',
            details: 'The visualization endpoint returned no content'
          }),
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      console.log('FastAPI HTML response successful, length:', responseText.length);
      // Return HTML as JSON string (frontend will extract it)
      return new Response(
        JSON.stringify({ html: responseText }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }
    
    // For JSON responses, parse and handle normally
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse FastAPI response as JSON:', responseText.substring(0, 200));
      return new Response(
        JSON.stringify({ 
          error: 'Invalid response from FastAPI',
          details: responseText.substring(0, 500)
        }),
        { 
          status: fastApiResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    if (!fastApiResponse.ok) {
      console.error('FastAPI error:', {
        status: fastApiResponse.status,
        statusText: fastApiResponse.statusText,
        detail: responseData.detail,
        error: responseData.error,
        fullResponse: responseData
      });
      
      const detailText = typeof responseData?.detail === 'string' ? responseData.detail.toLowerCase() : '';
      const isSessionError = fastApiResponse.status === 404 || detailText.includes('session');
      const isSessionAwareEndpoint = endpoint === '/chat';

      // Retry once with a fresh session for session-sensitive endpoints.
      if (isSessionAwareEndpoint && isSessionError) {
        console.log(`Session error detected for ${endpoint}, creating new session and retrying...`);
        try {
          const refreshedSessionId = await createFastApiSession();
          await cacheFastApiSession(refreshedSessionId);

          const retryRequestBody = {
            ...requestBody,
            session_id: refreshedSessionId,
          };

          const retryResponse = await fetch(fastApiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${fastApiAuthToken}`,
            },
            body: JSON.stringify(retryRequestBody),
          });

          const retryData = await retryResponse.json();

          if (retryResponse.ok) {
            return new Response(
              JSON.stringify(retryData),
              {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              }
            );
          }
        } catch (retryError) {
          console.error('Failed to refresh FastAPI session for retry:', retryError);
        }
      }
      
      // For /chat endpoint, if the response has a valid chat response structure (even with error),
      // forward it as 200 so the frontend can handle it properly
      if (endpoint === '/chat' && responseData && (responseData.success !== undefined || responseData.mode || responseData.explanation)) {
        console.log('Forwarding chat response with error status as 200 for frontend handling');
        return new Response(
          JSON.stringify(responseData),
          { 
            status: 200, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      // Extract the actual error message from various possible locations
      let errorMessage = 'FastAPI request failed';
      if (responseData.detail) {
        // FastAPI HTTPException uses 'detail'
        errorMessage = typeof responseData.detail === 'string' 
          ? responseData.detail 
          : JSON.stringify(responseData.detail);
      } else if (responseData.error) {
        // Some endpoints use 'error'
        errorMessage = typeof responseData.error === 'string'
          ? responseData.error
          : JSON.stringify(responseData.error);
      } else if (responseData.message) {
        // Some endpoints use 'message'
        errorMessage = typeof responseData.message === 'string'
          ? responseData.message
          : JSON.stringify(responseData.message);
      } else if (responseText && responseText.length < 1000) {
        // If response is short and not JSON, use it directly
        errorMessage = responseText;
      }
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage,
          detail: errorMessage,  // Also include as 'detail' for consistency
          details: responseData 
        }),
        { 
          status: fastApiResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('FastAPI request successful');

    return new Response(
      JSON.stringify(responseData),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in database-proxy:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
