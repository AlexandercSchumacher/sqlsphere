# models.py
# Data models for API requests

from typing import Optional, Literal, Annotated
from pydantic import BaseModel, Field, ConfigDict

class DatabaseConnection(BaseModel):
    """Database connection parameters from frontend."""
    type: Annotated[
        Literal["mysql", "postgresql", "sqlserver", "oracle"],
        Field(description="Database type")
    ]
    connection_method: Annotated[
        Literal["standard", "ssh", "local", "socket", "pipe"],
        Field(default="standard", alias="connectionMethod", description="Connection method")
    ] = "standard"
    host: Optional[str] = Field(default=None, description="Database host/IP")
    port: Optional[int] = Field(default=None, description="Database port")
    database: str = Field(..., description="Database name")
    username: str = Field(default="", description="Database username")
    password: str = Field(default="", description="Database password")
    use_ssl: bool = Field(default=False, alias="useSSL", description="Whether to require SSL/TLS")

    # SSH tunnel parameters (optional)
    ssh_host: Optional[str] = Field(default=None, alias="sshHost")
    ssh_port: Optional[int] = Field(default=None, alias="sshPort")
    ssh_username: Optional[str] = Field(default=None, alias="sshUsername")
    ssh_password: Optional[str] = Field(default=None, alias="sshPassword")
    ssh_key_file: Optional[str] = Field(default=None, alias="sshKeyFile")

    # SQL Server/Postgres schema hint
    default_schema: Optional[str] = Field(default=None, alias="defaultSchema")

    # Local agent connection code (optional, only for connection_method="local")
    connection_code: Optional[str] = Field(default=None, alias="connectionCode", description="Connection code for local agent")

    # Authentication method
    auth_method: Optional[Literal[
        "sql_auth",            # Standard user/pass (MySQL, PG, MSSQL)
        "windows_auth",        # Windows/SSPI Trusted Connection (MSSQL)
        "ssl_cert",            # Client-Certificate as auth (MySQL, PG)
        "aws_iam",             # AWS RDS IAM Token (MySQL, PG)
        "azure_ad_password",   # Azure AD user/pass (MSSQL, PG)
        "azure_ad_integrated", # Azure AD Integrated/Windows (MSSQL)
        "azure_ad_mfa",        # Azure AD Interactive/MFA (MSSQL)
        "azure_ad_sp",         # Azure AD Service Principal (MSSQL, PG)
        "azure_ad_mi",         # Azure AD Managed Identity (MSSQL)
        "kerberos",            # Kerberos/GSSAPI (PG, MSSQL)
        "connection_string",   # Raw connection string (all)
    ]] = Field(default="sql_auth", alias="authMethod")

    # SSL/TLS configuration
    ssl_mode: Optional[Literal[
        # PostgreSQL modes
        "disable", "allow", "prefer", "require", "verify-ca", "verify-full",
        # MySQL modes
        "disabled", "preferred", "required", "verify_ca", "verify_identity",
    ]] = Field(default=None, alias="sslMode")
    ssl_ca: Optional[str] = Field(default=None, alias="sslCa")           # PEM content
    ssl_ca_path: Optional[str] = Field(default=None, alias="sslCaPath")  # file path
    ssl_cert: Optional[str] = Field(default=None, alias="sslCert")       # PEM content
    ssl_cert_path: Optional[str] = Field(default=None, alias="sslCertPath")
    ssl_key: Optional[str] = Field(default=None, alias="sslKey")         # PEM content
    ssl_key_path: Optional[str] = Field(default=None, alias="sslKeyPath")

    # Unix Socket / Named Pipe
    socket_path: Optional[str] = Field(default=None, alias="socketPath")       # Unix socket
    named_pipe: Optional[str] = Field(default=None, alias="namedPipe")         # Windows named pipe
    named_instance: Optional[str] = Field(default=None, alias="namedInstance") # MSSQL SERVER\INSTANCE

    # Azure AD credentials
    azure_tenant_id: Optional[str] = Field(default=None, alias="azureTenantId")
    azure_client_id: Optional[str] = Field(default=None, alias="azureClientId")
    azure_client_secret: Optional[str] = Field(default=None, alias="azureClientSecret")

    # AWS IAM credentials
    aws_region: Optional[str] = Field(default=None, alias="awsRegion")
    aws_access_key_id: Optional[str] = Field(default=None, alias="awsAccessKeyId")
    aws_secret_access_key: Optional[str] = Field(default=None, alias="awsSecretAccessKey")
    aws_use_instance_profile: bool = Field(default=False, alias="awsUseInstanceProfile")

    # SQL Server specific
    encrypt: Optional[Literal["yes", "no", "strict"]] = Field(default=None)
    trust_server_certificate: bool = Field(default=False, alias="trustServerCertificate")

    # Raw connection string (expert mode) — all other fields are ignored when set
    connection_string_value: Optional[str] = Field(default=None, alias="connectionStringValue")

    model_config = ConfigDict(populate_by_name=True)

class ConnectionSession(BaseModel):
    """Session information for storing connection state."""
    session_id: str
    connection: DatabaseConnection
    created_at: str
    expires_at: str

class QueryRequest(BaseModel):
    """Request for SQL query or chat."""
    session_id: str = Field(..., description="Session ID from connection test")
    query: Optional[str] = Field(default=None, description="User query or question")
    conversation_history: Optional[list] = Field(default=[], description="Previous conversation")
    language: Optional[str] = Field(default="en", description="Language code (e.g., 'en', 'de', 'es', 'it')")
    active_model: Optional[str] = Field(default=None, alias="activeModel", description="LLM model to use: 'claude' or 'chatgpt'")
    current_editor_code: Optional[str] = Field(default=None, alias="currentEditorCode", description="Current SQL code in the editor (with intelligent context selection)")
    code_context_metadata: Optional[dict] = Field(default=None, alias="codeContextMetadata", description="Metadata about code context (total_lines, context_lines, cursor_line)")

ScheduleQueryMode = Literal["manual", "nl"]
ScheduleChartType = Literal["auto", "bar", "line", "area", "pie", "table"]

class ScheduleCreate(BaseModel):
    """Create a scheduled query."""
    user_id: str
    connection_id: str = Field(..., alias="connectionId")
    name: str
    sql_text: str = Field(default="", alias="sqlText")
    query_mode: ScheduleQueryMode = Field(default="manual", alias="queryMode")
    nl_prompt: Optional[str] = Field(default=None, alias="nlPrompt")
    generated_sql: Optional[str] = Field(default=None, alias="generatedSql")
    sql_final: Optional[str] = Field(default=None, alias="sqlFinal")
    report_description: Optional[str] = Field(default=None, alias="reportDescription")
    include_chart: bool = Field(default=False, alias="includeChart")
    chart_type: ScheduleChartType = Field(default="auto", alias="chartType")
    chart_title: Optional[str] = Field(default=None, alias="chartTitle")
    schedule_type: Literal["daily", "weekly", "monthly"] = Field(..., alias="scheduleType")
    schedule_time: str = Field(default="08:00", alias="scheduleTime")
    schedule_day_of_week: Optional[int] = Field(default=None, alias="scheduleDayOfWeek")
    schedule_day_of_month: Optional[int] = Field(default=None, alias="scheduleDayOfMonth")
    timezone: str = "UTC"
    email_recipients: list[str] = Field(default=[], alias="emailRecipients")
    output_format: Literal["csv", "json"] = Field(default="csv", alias="outputFormat")
    model_config = ConfigDict(populate_by_name=True)

class ScheduleUpdate(BaseModel):
    """Update a scheduled query."""
    user_id: Optional[str] = None
    name: Optional[str] = None
    sql_text: Optional[str] = Field(default=None, alias="sqlText")
    query_mode: Optional[ScheduleQueryMode] = Field(default=None, alias="queryMode")
    nl_prompt: Optional[str] = Field(default=None, alias="nlPrompt")
    generated_sql: Optional[str] = Field(default=None, alias="generatedSql")
    sql_final: Optional[str] = Field(default=None, alias="sqlFinal")
    report_description: Optional[str] = Field(default=None, alias="reportDescription")
    include_chart: Optional[bool] = Field(default=None, alias="includeChart")
    chart_type: Optional[ScheduleChartType] = Field(default=None, alias="chartType")
    chart_title: Optional[str] = Field(default=None, alias="chartTitle")
    schedule_type: Optional[Literal["daily", "weekly", "monthly"]] = Field(default=None, alias="scheduleType")
    schedule_time: Optional[str] = Field(default=None, alias="scheduleTime")
    schedule_day_of_week: Optional[int] = Field(default=None, alias="scheduleDayOfWeek")
    schedule_day_of_month: Optional[int] = Field(default=None, alias="scheduleDayOfMonth")
    timezone: Optional[str] = None
    email_recipients: Optional[list[str]] = Field(default=None, alias="emailRecipients")
    output_format: Optional[Literal["csv", "json"]] = Field(default=None, alias="outputFormat")
    is_active: Optional[bool] = Field(default=None, alias="isActive")
    model_config = ConfigDict(populate_by_name=True)

class AlertCreate(BaseModel):
    """Create a data alert."""
    user_id: str
    connection_id: str = Field(..., alias="connectionId")
    name: str
    nl_condition: str = Field(..., alias="nlCondition")
    sql_text: str = Field(default="", alias="sqlText")
    query_mode: ScheduleQueryMode = Field(default="manual", alias="queryMode")
    nl_prompt: Optional[str] = Field(default=None, alias="nlPrompt")
    generated_sql: Optional[str] = Field(default=None, alias="generatedSql")
    sql_final: Optional[str] = Field(default=None, alias="sqlFinal")
    check_interval_minutes: int = Field(default=60, alias="checkIntervalMinutes")
    email_recipients: list[str] = Field(default=[], alias="emailRecipients")
    model_config = ConfigDict(populate_by_name=True)

class AlertUpdate(BaseModel):
    """Update a data alert."""
    user_id: Optional[str] = None
    name: Optional[str] = None
    nl_condition: Optional[str] = Field(default=None, alias="nlCondition")
    sql_text: Optional[str] = Field(default=None, alias="sqlText")
    query_mode: Optional[ScheduleQueryMode] = Field(default=None, alias="queryMode")
    nl_prompt: Optional[str] = Field(default=None, alias="nlPrompt")
    generated_sql: Optional[str] = Field(default=None, alias="generatedSql")
    sql_final: Optional[str] = Field(default=None, alias="sqlFinal")
    check_interval_minutes: Optional[int] = Field(default=None, alias="checkIntervalMinutes")
    email_recipients: Optional[list[str]] = Field(default=None, alias="emailRecipients")
    is_active: Optional[bool] = Field(default=None, alias="isActive")
    model_config = ConfigDict(populate_by_name=True)

class DashboardWidgetGenerate(BaseModel):
    """Generate a dashboard widget from natural language."""
    user_id: Optional[str] = None
    connection_id: str = Field(..., alias="connectionId")
    prompt: str
    session_id: Optional[str] = Field(default=None, alias="sessionId")
    model_config = ConfigDict(populate_by_name=True)

class ScheduleGenerateSQLRequest(BaseModel):
    """Generate SQL for a scheduled report from natural language."""
    user_id: Optional[str] = None
    connection_id: str = Field(..., alias="connectionId")
    prompt: str
    model_config = ConfigDict(populate_by_name=True)

class SchedulePreviewRequest(BaseModel):
    """Preview a scheduled report query."""
    user_id: Optional[str] = None
    connection_id: str = Field(..., alias="connectionId")
    sql_text: str = Field(..., alias="sqlText")
    chart_type: ScheduleChartType = Field(default="auto", alias="chartType")
    chart_title: Optional[str] = Field(default=None, alias="chartTitle")
    row_limit: int = Field(default=100, ge=1, le=500, alias="rowLimit")
    name: Optional[str] = Field(default=None)
    report_description: Optional[str] = Field(default=None, alias="reportDescription")
    include_chart: bool = Field(default=False, alias="includeChart")
    email_recipients: Optional[str] = Field(default=None, alias="emailRecipients")
    output_format: Optional[str] = Field(default="csv", alias="outputFormat")
    model_config = ConfigDict(populate_by_name=True)

class AlertGenerateSQLRequest(BaseModel):
    """Generate SQL for a data alert from natural language."""
    user_id: Optional[str] = None
    connection_id: str = Field(..., alias="connectionId")
    prompt: str
    model_config = ConfigDict(populate_by_name=True)

class AlertPreviewRequest(BaseModel):
    """Preview a data alert query."""
    user_id: Optional[str] = None
    connection_id: str = Field(..., alias="connectionId")
    sql_text: str = Field(..., alias="sqlText")
    row_limit: int = Field(default=100, ge=1, le=500, alias="rowLimit")
    model_config = ConfigDict(populate_by_name=True)

class DashboardWidgetRefresh(BaseModel):
    """Refresh widget data."""
    user_id: Optional[str] = None
    connection_id: str = Field(..., alias="connectionId")
    sql_text: str = Field(..., alias="sqlText")
    model_config = ConfigDict(populate_by_name=True)

class VisualizationPreviewRequest(BaseModel):
    """Request payload for visualization preview data."""
    connection: DatabaseConnection = Field(..., description="Database connection details")
    schema_name: Optional[str] = Field(default=None, alias="schema", description="Schema to query")
    table_name: str = Field(..., alias="table", description="Table name")
    x_column: str = Field(..., alias="xColumn", description="Column to use on the X axis")
    y_column: Optional[str] = Field(default=None, alias="yColumn", description="Optional column for aggregation")
    aggregation: Literal["count", "sum", "avg", "none"] = Field(default="count", description="Aggregation to apply")
    limit: int = Field(default=20, ge=1, le=500, description="Maximum number of rows/buckets to return")

    model_config = ConfigDict(populate_by_name=True, ser_json_timedelta="iso8601")
