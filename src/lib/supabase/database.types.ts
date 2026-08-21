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
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      allergies: {
        Row: {
          clinic_id: string
          id: string
          patient_id: string
          reaction: string | null
          recorded_at: string
          severity: string | null
          status: string
          substance: string
        }
        Insert: {
          clinic_id: string
          id?: string
          patient_id: string
          reaction?: string | null
          recorded_at?: string
          severity?: string | null
          status?: string
          substance: string
        }
        Update: {
          clinic_id?: string
          id?: string
          patient_id?: string
          reaction?: string | null
          recorded_at?: string
          severity?: string | null
          status?: string
          substance?: string
        }
        Relationships: [
          {
            foreignKeyName: "allergies_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allergies_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_internal_notes: {
        Row: {
          clinic_id: string
          created_at: string
          created_by: string
          id: string
          note: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          created_by: string
          id?: string
          note: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          created_by?: string
          id?: string
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_internal_notes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_members: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["clinic_member_role"]
          user_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["clinic_member_role"]
          user_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["clinic_member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_members_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_plan_changes: {
        Row: {
          business_model: Database["public"]["Enums"]["clinic_business_model"]
          changed_by: string
          clinic_id: string
          created_at: string
          id: string
          plan_conditions: string | null
          price: number | null
        }
        Insert: {
          business_model: Database["public"]["Enums"]["clinic_business_model"]
          changed_by: string
          clinic_id: string
          created_at?: string
          id?: string
          plan_conditions?: string | null
          price?: number | null
        }
        Update: {
          business_model?: Database["public"]["Enums"]["clinic_business_model"]
          changed_by?: string
          clinic_id?: string
          created_at?: string
          id?: string
          plan_conditions?: string | null
          price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_plan_changes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_status_changes: {
        Row: {
          changed_by: string
          clinic_id: string
          created_at: string
          id: string
          is_active: boolean
          reason: string
        }
        Insert: {
          changed_by: string
          clinic_id: string
          created_at?: string
          id?: string
          is_active: boolean
          reason: string
        }
        Update: {
          changed_by?: string
          clinic_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_status_changes_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_subscriptions: {
        Row: {
          clinic_id: string
          next_payment_due_on: string | null
          payment_status: string
          plan_conditions: string | null
          price: number | null
          updated_at: string
        }
        Insert: {
          clinic_id: string
          next_payment_due_on?: string | null
          payment_status?: string
          plan_conditions?: string | null
          price?: number | null
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          next_payment_due_on?: string | null
          payment_status?: string
          plan_conditions?: string | null
          price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_subscriptions_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          business_model: Database["public"]["Enums"]["clinic_business_model"]
          created_at: string
          id: string
          is_active: boolean
          name: string
          province: string
          updated_at: string
        }
        Insert: {
          business_model: Database["public"]["Enums"]["clinic_business_model"]
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          province: string
          updated_at?: string
        }
        Update: {
          business_model?: Database["public"]["Enums"]["clinic_business_model"]
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          province?: string
          updated_at?: string
        }
        Relationships: []
      }
      consent_templates: {
        Row: {
          body: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          title: string
        }
        Insert: {
          body: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          title: string
        }
        Update: {
          body?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          title?: string
        }
        Relationships: []
      }
      consents: {
        Row: {
          clinic_id: string
          consent_template_id: string
          created_at: string
          document_content: string
          document_hash: string
          document_title: string
          encounter_id: string | null
          id: string
          patient_id: string
          recorded_by: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          signed_at: string
          signer_ip: unknown
          signer_name: string
          signer_national_id: string | null
          signer_relationship: string
          signer_user_agent: string | null
          status: string
        }
        Insert: {
          clinic_id: string
          consent_template_id: string
          created_at?: string
          document_content: string
          document_hash: string
          document_title: string
          encounter_id?: string | null
          id?: string
          patient_id: string
          recorded_by: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          signed_at?: string
          signer_ip?: unknown
          signer_name: string
          signer_national_id?: string | null
          signer_relationship?: string
          signer_user_agent?: string | null
          status?: string
        }
        Update: {
          clinic_id?: string
          consent_template_id?: string
          created_at?: string
          document_content?: string
          document_hash?: string
          document_title?: string
          encounter_id?: string | null
          id?: string
          patient_id?: string
          recorded_by?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          signed_at?: string
          signer_ip?: unknown
          signer_name?: string
          signer_national_id?: string | null
          signer_relationship?: string
          signer_user_agent?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "consents_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_consent_template_id_fkey"
            columns: ["consent_template_id"]
            isOneToOne: false
            referencedRelation: "consent_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      encounters: {
        Row: {
          chief_complaint: string | null
          clinic_id: string
          created_at: string
          encounter_date: string
          id: string
          patient_id: string
          provider_id: string
          specialty_data: Json
          specialty_template_id: string
          updated_at: string
        }
        Insert: {
          chief_complaint?: string | null
          clinic_id: string
          created_at?: string
          encounter_date?: string
          id?: string
          patient_id: string
          provider_id: string
          specialty_data?: Json
          specialty_template_id: string
          updated_at?: string
        }
        Update: {
          chief_complaint?: string | null
          clinic_id?: string
          created_at?: string
          encounter_date?: string
          id?: string
          patient_id?: string
          provider_id?: string
          specialty_data?: Json
          specialty_template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "encounters_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounters_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "encounters_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          clinic_id: string
          created_at: string
          discontinued_at: string | null
          dose: string | null
          frequency: string | null
          id: string
          name: string
          patient_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          discontinued_at?: string | null
          dose?: string | null
          frequency?: string | null
          id?: string
          name: string
          patient_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          discontinued_at?: string | null
          dose?: string | null
          frequency?: string | null
          id?: string
          name?: string
          patient_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medications_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          clinic_id: string
          created_at: string
          date_of_birth: string
          email: string | null
          first_name: string
          id: string
          last_name: string
          national_id: string | null
          phone: string | null
          sex: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          date_of_birth: string
          email?: string | null
          first_name: string
          id?: string
          last_name: string
          national_id?: string | null
          phone?: string | null
          sex: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          date_of_birth?: string
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string
          national_id?: string | null
          phone?: string | null
          sex?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_operators: {
        Row: {
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      specialty_templates: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          schema: Json
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          schema: Json
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          schema?: Json
        }
        Relationships: []
      }
      vital_signs: {
        Row: {
          clinic_id: string
          diastolic_bp: number | null
          encounter_id: string
          heart_rate: number | null
          height_cm: number | null
          id: string
          oxygen_saturation: number | null
          recorded_at: string
          respiratory_rate: number | null
          systolic_bp: number | null
          temperature_celsius: number | null
          weight_kg: number | null
        }
        Insert: {
          clinic_id: string
          diastolic_bp?: number | null
          encounter_id: string
          heart_rate?: number | null
          height_cm?: number | null
          id?: string
          oxygen_saturation?: number | null
          recorded_at?: string
          respiratory_rate?: number | null
          systolic_bp?: number | null
          temperature_celsius?: number | null
          weight_kg?: number | null
        }
        Update: {
          clinic_id?: string
          diastolic_bp?: number | null
          encounter_id?: string
          heart_rate?: number | null
          height_cm?: number | null
          id?: string
          oxygen_saturation?: number | null
          recorded_at?: string
          respiratory_rate?: number | null
          systolic_bp?: number | null
          temperature_celsius?: number | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vital_signs_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vital_signs_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_clinic_internal_note: {
        Args: { note: string; target_clinic_id: string }
        Returns: undefined
      }
      create_clinic_with_admin: {
        Args: {
          clinic_business_model: Database["public"]["Enums"]["clinic_business_model"]
          clinic_name: string
          clinic_province: string
        }
        Returns: string
      }
      is_clinic_admin: { Args: { target_clinic_id: string }; Returns: boolean }
      is_clinic_clinician: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_clinic_member: { Args: { target_clinic_id: string }; Returns: boolean }
      is_clinician_of_active_clinic: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_member_of_active_clinic: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_platform_operator: { Args: never; Returns: boolean }
      revoke_consent: {
        Args: { reason: string; target_consent_id: string }
        Returns: undefined
      }
      set_clinic_active_status: {
        Args: {
          new_is_active: boolean
          reason: string
          target_clinic_id: string
        }
        Returns: undefined
      }
      update_clinic_payment_status: {
        Args: {
          new_next_payment_due_on: string
          new_payment_status: string
          target_clinic_id: string
        }
        Returns: undefined
      }
      update_clinic_plan: {
        Args: {
          new_business_model: Database["public"]["Enums"]["clinic_business_model"]
          new_conditions: string
          new_price: number
          target_clinic_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      clinic_business_model: "modelo_c" | "modelo_e" | "modelo_f"
      clinic_member_role: "admin" | "medico" | "recepcion"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      clinic_business_model: ["modelo_c", "modelo_e", "modelo_f"],
      clinic_member_role: ["admin", "medico", "recepcion"],
    },
  },
} as const
