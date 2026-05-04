export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      alert_notifications: {
        Row: {
          alert_id: string | null
          created_at: string
          id: string
          is_read: boolean
          message: string
          title: string
          user_id: string
        }
        Insert: {
          alert_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          title: string
          user_id: string
        }
        Update: {
          alert_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "data_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          table_data: Json | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          table_data?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          table_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          connection_id: string | null
          created_at: string
          database_type: string | null
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          database_type?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          database_type?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_sessions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          auth_method: string | null
          aws_access_key_id: string | null
          aws_region: string | null
          aws_secret_access_key: string | null
          aws_use_instance_profile: boolean | null
          azure_client_id: string | null
          azure_client_secret: string | null
          azure_tenant_id: string | null
          connection_code: string | null
          connection_method: string | null
          connection_string_value: string | null
          created_at: string
          database: string | null
          default_schema: string | null
          encrypt: string | null
          host: string | null
          id: string
          is_default: boolean | null
          metadata: Json | null
          name: string
          named_instance: string | null
          named_pipe: string | null
          password: string | null
          port: number | null
          socket_path: string | null
          ssh_host: string | null
          ssh_key_file: string | null
          ssh_password: string | null
          ssh_port: number | null
          ssh_username: string | null
          ssl_ca: string | null
          ssl_ca_path: string | null
          ssl_cert: string | null
          ssl_cert_path: string | null
          ssl_key: string | null
          ssl_key_path: string | null
          ssl_mode: string | null
          status: string | null
          trust_server_certificate: boolean | null
          type: string
          updated_at: string
          use_ssl: boolean | null
          user_id: string
          username: string | null
        }
        Insert: {
          auth_method?: string | null
          aws_access_key_id?: string | null
          aws_region?: string | null
          aws_secret_access_key?: string | null
          aws_use_instance_profile?: boolean | null
          azure_client_id?: string | null
          azure_client_secret?: string | null
          azure_tenant_id?: string | null
          connection_code?: string | null
          connection_method?: string | null
          connection_string_value?: string | null
          created_at?: string
          database?: string | null
          default_schema?: string | null
          encrypt?: string | null
          host?: string | null
          id?: string
          is_default?: boolean | null
          metadata?: Json | null
          name: string
          named_instance?: string | null
          named_pipe?: string | null
          password?: string | null
          port?: number | null
          socket_path?: string | null
          ssh_host?: string | null
          ssh_key_file?: string | null
          ssh_password?: string | null
          ssh_port?: number | null
          ssh_username?: string | null
          ssl_ca?: string | null
          ssl_ca_path?: string | null
          ssl_cert?: string | null
          ssl_cert_path?: string | null
          ssl_key?: string | null
          ssl_key_path?: string | null
          ssl_mode?: string | null
          status?: string | null
          trust_server_certificate?: boolean | null
          type: string
          updated_at?: string
          use_ssl?: boolean | null
          user_id: string
          username?: string | null
        }
        Update: {
          auth_method?: string | null
          aws_access_key_id?: string | null
          aws_region?: string | null
          aws_secret_access_key?: string | null
          aws_use_instance_profile?: boolean | null
          azure_client_id?: string | null
          azure_client_secret?: string | null
          azure_tenant_id?: string | null
          connection_code?: string | null
          connection_method?: string | null
          connection_string_value?: string | null
          created_at?: string
          database?: string | null
          default_schema?: string | null
          encrypt?: string | null
          host?: string | null
          id?: string
          is_default?: boolean | null
          metadata?: Json | null
          name?: string
          named_instance?: string | null
          named_pipe?: string | null
          password?: string | null
          port?: number | null
          socket_path?: string | null
          ssh_host?: string | null
          ssh_key_file?: string | null
          ssh_password?: string | null
          ssh_port?: number | null
          ssh_username?: string | null
          ssl_ca?: string | null
          ssl_ca_path?: string | null
          ssl_cert?: string | null
          ssl_cert_path?: string | null
          ssl_key?: string | null
          ssl_key_path?: string | null
          ssl_mode?: string | null
          status?: string | null
          trust_server_certificate?: boolean | null
          type?: string
          updated_at?: string
          use_ssl?: boolean | null
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      dashboard_widgets: {
        Row: {
          chart_type: string | null
          config: Json | null
          created_at: string
          dashboard_id: string
          filters: Json | null
          group_by_key: string | null
          id: string
          position: number
          sql: string
          title: string
          widget_type: string
          width: string
          x_key: string | null
          y_keys: string[] | null
        }
        Insert: {
          chart_type?: string | null
          config?: Json | null
          created_at?: string
          dashboard_id: string
          filters?: Json | null
          group_by_key?: string | null
          id?: string
          position?: number
          sql: string
          title: string
          widget_type: string
          width?: string
          x_key?: string | null
          y_keys?: string[] | null
        }
        Update: {
          chart_type?: string | null
          config?: Json | null
          created_at?: string
          dashboard_id?: string
          filters?: Json | null
          group_by_key?: string | null
          id?: string
          position?: number
          sql?: string
          title?: string
          widget_type?: string
          width?: string
          x_key?: string | null
          y_keys?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_dashboard_id_fkey"
            columns: ["dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          connection_id: string | null
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboards_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      data_alerts: {
        Row: {
          check_interval_minutes: number
          connection_id: string
          created_at: string
          email_recipients: string[]
          generated_sql: string | null
          id: string
          is_active: boolean
          last_checked_at: string | null
          last_triggered_at: string | null
          name: string
          nl_prompt: string | null
          nl_condition: string
          query_mode: string
          sql_final: string
          sql_text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          check_interval_minutes?: number
          connection_id: string
          created_at?: string
          email_recipients?: string[]
          generated_sql?: string | null
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          last_triggered_at?: string | null
          name: string
          nl_prompt?: string | null
          nl_condition: string
          query_mode?: string
          sql_final: string
          sql_text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          check_interval_minutes?: number
          connection_id?: string
          created_at?: string
          email_recipients?: string[]
          generated_sql?: string | null
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          last_triggered_at?: string | null
          name?: string
          nl_prompt?: string | null
          nl_condition?: string
          query_mode?: string
          sql_final?: string
          sql_text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_alerts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      encryption_keys: {
        Row: {
          created_at: string | null
          id: string
          key_data: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key_data: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key_data?: string
          name?: string
        }
        Relationships: []
      }
      import_history: {
        Row: {
          connection_id: string | null
          created_at: string | null
          duplicate_handling: string | null
          error_summary: string | null
          file_columns: Json | null
          filename: string
          id: string
          mapping: Json | null
          preview_data: Json | null
          rows_failed: number
          rows_imported: number
          schema_name: string | null
          table_name: string
          total_rows: number
          user_id: string
          warnings: string[] | null
        }
        Insert: {
          connection_id?: string | null
          created_at?: string | null
          duplicate_handling?: string | null
          error_summary?: string | null
          file_columns?: Json | null
          filename: string
          id?: string
          mapping?: Json | null
          preview_data?: Json | null
          rows_failed?: number
          rows_imported?: number
          schema_name?: string | null
          table_name: string
          total_rows?: number
          user_id: string
          warnings?: string[] | null
        }
        Update: {
          connection_id?: string | null
          created_at?: string | null
          duplicate_handling?: string | null
          error_summary?: string | null
          file_columns?: Json | null
          filename?: string
          id?: string
          mapping?: Json | null
          preview_data?: Json | null
          rows_failed?: number
          rows_imported?: number
          schema_name?: string | null
          table_name?: string
          total_rows?: number
          user_id?: string
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "import_history_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      query_history: {
        Row: {
          connection_id: string | null
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          id: string
          is_favorite: boolean
          row_count: number | null
          sql_text: string
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          is_favorite?: boolean
          row_count?: number | null
          sql_text: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          is_favorite?: boolean
          row_count?: number | null
          sql_text?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "query_history_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_queries: {
        Row: {
          chart_title: string | null
          chart_type: string
          connection_id: string
          created_at: string
          email_recipients: string[]
          generated_sql: string | null
          id: string
          include_chart: boolean
          is_active: boolean
          last_run_at: string | null
          name: string
          nl_prompt: string | null
          next_run_at: string | null
          output_format: string
          query_mode: string
          report_description: string | null
          schedule_day_of_month: number | null
          schedule_day_of_week: number | null
          schedule_time: string
          sql_final: string
          schedule_type: string
          sql_text: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chart_title?: string | null
          chart_type?: string
          connection_id: string
          created_at?: string
          email_recipients?: string[]
          generated_sql?: string | null
          id?: string
          include_chart?: boolean
          is_active?: boolean
          last_run_at?: string | null
          name: string
          nl_prompt?: string | null
          next_run_at?: string | null
          output_format?: string
          query_mode?: string
          report_description?: string | null
          schedule_day_of_month?: number | null
          schedule_day_of_week?: number | null
          schedule_time?: string
          sql_final: string
          schedule_type: string
          sql_text: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chart_title?: string | null
          chart_type?: string
          connection_id?: string
          created_at?: string
          email_recipients?: string[]
          generated_sql?: string | null
          id?: string
          include_chart?: boolean
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          nl_prompt?: string | null
          next_run_at?: string | null
          output_format?: string
          query_mode?: string
          report_description?: string | null
          schedule_day_of_month?: number | null
          schedule_day_of_week?: number | null
          schedule_time?: string
          sql_final?: string
          schedule_type?: string
          sql_text?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_queries_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "connections"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_query_runs: {
        Row: {
          chart_generated: boolean
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          row_count: number | null
          schedule_id: string
          summary_text: string | null
          started_at: string
          status: string
        }
        Insert: {
          chart_generated?: boolean
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          row_count?: number | null
          schedule_id: string
          summary_text?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          chart_generated?: boolean
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          row_count?: number | null
          schedule_id?: string
          summary_text?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_query_runs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "scheduled_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_queries: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          result_columns: string[]
          result_data: Json
          row_count: number
          sql_text: string
          title: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          result_columns?: string[]
          result_data?: Json
          row_count?: number
          sql_text: string
          title: string
          token?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          result_columns?: string[]
          result_data?: Json
          row_count?: number
          sql_text?: string
          title?: string
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      user_lifetime_usage: {
        Row: {
          created_at: string
          id: string
          total_imports: number
          total_visualizations: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          total_imports?: number
          total_visualizations?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          total_imports?: number
          total_visualizations?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          dark_mode: boolean
          id: string
          language: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dark_mode?: boolean
          id?: string
          language?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dark_mode?: boolean
          id?: string
          language?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_usage: {
        Row: {
          created_at: string
          id: string
          imports_count: number
          messages_sent: number
          updated_at: string
          usage_date: string
          user_id: string
          visualizations_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          imports_count?: number
          messages_sent?: number
          updated_at?: string
          usage_date?: string
          user_id: string
          visualizations_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          imports_count?: number
          messages_sent?: number
          updated_at?: string
          usage_date?: string
          user_id?: string
          visualizations_count?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decrypt_credential: { Args: { encrypted: string }; Returns: string }
      encrypt_credential: { Args: { plaintext: string }; Returns: string }
      get_shared_query: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          expires_at: string
          result_columns: string[]
          result_data: Json
          row_count: number
          sql_text: string
          title: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
