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
    PostgrestVersion: "14.5"
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
      appointment_surgical_checklist: {
        Row: {
          analiticas_sangre: string
          appointment_id: string
          clinic_id: string
          evaluacion_cardiovascular: string
          implantes_aprobados_seguro: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          analiticas_sangre?: string
          appointment_id: string
          clinic_id: string
          evaluacion_cardiovascular?: string
          implantes_aprobados_seguro?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          analiticas_sangre?: string
          appointment_id?: string
          clinic_id?: string
          evaluacion_cardiovascular?: string
          implantes_aprobados_seguro?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointment_surgical_checklist_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_surgical_checklist_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_type: string
          clinic_id: string
          created_at: string
          created_by: string
          id: string
          patient_id: string
          provider_id: string
          reason: string | null
          scheduled_at: string
          specialty_template_id: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_type?: string
          clinic_id: string
          created_at?: string
          created_by: string
          id?: string
          patient_id: string
          provider_id: string
          reason?: string | null
          scheduled_at: string
          specialty_template_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_type?: string
          clinic_id?: string
          created_at?: string
          created_by?: string
          id?: string
          patient_id?: string
          provider_id?: string
          reason?: string | null
          scheduled_at?: string
          specialty_template_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      archived_fiscal_document_items: {
        Row: {
          description: string
          fiscal_document_id: string
          id: string
          itbis_indicator: string
          line_number: number
          line_total: number
          quantity: number
          unit_price: number
        }
        Insert: {
          description: string
          fiscal_document_id: string
          id: string
          itbis_indicator: string
          line_number: number
          line_total: number
          quantity: number
          unit_price: number
        }
        Update: {
          description?: string
          fiscal_document_id?: string
          id?: string
          itbis_indicator?: string
          line_number?: number
          line_total?: number
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "archived_fiscal_document_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "archived_fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      archived_fiscal_documents: {
        Row: {
          archived_at: string
          clinic_name: string
          comprador_nombre: string
          comprador_rnc_cedula: string | null
          deletion_request_id: string
          dgii_track_id: string | null
          e_ncf: string | null
          emisor_rnc: string | null
          fecha_vencimiento_secuencia: string | null
          id: string
          issued_at: string
          monto_exento: number
          monto_gravado_total: number
          monto_total: number
          retain_until: string
          source_clinic_id: string
          status: string
          tipo_ecf: string
          total_itbis: number
          voided_at: string | null
          voided_reason: string | null
          xml: string | null
          xml_is_signed: boolean
        }
        Insert: {
          archived_at?: string
          clinic_name: string
          comprador_nombre: string
          comprador_rnc_cedula?: string | null
          deletion_request_id: string
          dgii_track_id?: string | null
          e_ncf?: string | null
          emisor_rnc?: string | null
          fecha_vencimiento_secuencia?: string | null
          id: string
          issued_at: string
          monto_exento: number
          monto_gravado_total: number
          monto_total: number
          retain_until: string
          source_clinic_id: string
          status: string
          tipo_ecf: string
          total_itbis: number
          voided_at?: string | null
          voided_reason?: string | null
          xml?: string | null
          xml_is_signed?: boolean
        }
        Update: {
          archived_at?: string
          clinic_name?: string
          comprador_nombre?: string
          comprador_rnc_cedula?: string | null
          deletion_request_id?: string
          dgii_track_id?: string | null
          e_ncf?: string | null
          emisor_rnc?: string | null
          fecha_vencimiento_secuencia?: string | null
          id?: string
          issued_at?: string
          monto_exento?: number
          monto_gravado_total?: number
          monto_total?: number
          retain_until?: string
          source_clinic_id?: string
          status?: string
          tipo_ecf?: string
          total_itbis?: number
          voided_at?: string | null
          voided_reason?: string | null
          xml?: string | null
          xml_is_signed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "archived_fiscal_documents_deletion_request_id_fkey"
            columns: ["deletion_request_id"]
            isOneToOne: false
            referencedRelation: "clinic_deletion_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_batches: {
        Row: {
          clinic_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string
          error_row_count: number
          file_name: string
          id: string
          import_type: string
          row_count: number
          rows: Json
          specialty_template_id: string | null
          status: string
          valid_row_count: number
        }
        Insert: {
          clinic_id: string
          confirmed_at?: string | null
          created_at?: string
          created_by: string
          error_row_count: number
          file_name: string
          id?: string
          import_type: string
          row_count: number
          rows: Json
          specialty_template_id?: string | null
          status?: string
          valid_row_count: number
        }
        Update: {
          clinic_id?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string
          error_row_count?: number
          file_name?: string
          id?: string
          import_type?: string
          row_count?: number
          rows?: Json
          specialty_template_id?: string | null
          status?: string
          valid_row_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_batches_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_import_batches_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_deletion_requests: {
        Row: {
          channel: string
          clinic_id: string | null
          clinic_name: string
          created_at: string
          deletion_summary: Json | null
          executed_at: string | null
          executed_by_email: string | null
          export_confirmed_at: string | null
          id: string
          note: string | null
          requested_at: string
          requested_by_email: string
          scheduled_for: string | null
          status: string
          warning_hash: string
          warning_text: string
          withdrawn_at: string | null
        }
        Insert: {
          channel: string
          clinic_id?: string | null
          clinic_name: string
          created_at?: string
          deletion_summary?: Json | null
          executed_at?: string | null
          executed_by_email?: string | null
          export_confirmed_at?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          requested_by_email: string
          scheduled_for?: string | null
          status?: string
          warning_hash: string
          warning_text: string
          withdrawn_at?: string | null
        }
        Update: {
          channel?: string
          clinic_id?: string | null
          clinic_name?: string
          created_at?: string
          deletion_summary?: Json | null
          executed_at?: string | null
          executed_by_email?: string | null
          export_confirmed_at?: string | null
          id?: string
          note?: string | null
          requested_at?: string
          requested_by_email?: string
          scheduled_for?: string | null
          status?: string
          warning_hash?: string
          warning_text?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinic_deletion_requests_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_ecf_sequences: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          next_number: number
          range_end: number
          range_start: number
          tipo_ecf: string
          valid_until: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          next_number: number
          range_end: number
          range_start: number
          tipo_ecf: string
          valid_until: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          next_number?: number
          range_end?: number
          range_start?: number
          tipo_ecf?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_ecf_sequences_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_export_log: {
        Row: {
          clinic_id: string
          created_at: string
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_export_log_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_fiscal_profiles: {
        Row: {
          business_name: string
          clinic_id: string
          commercial_name: string | null
          economic_activity: string
          email: string | null
          fiscal_address: string
          phone: string | null
          rnc: string
          updated_at: string
        }
        Insert: {
          business_name: string
          clinic_id: string
          commercial_name?: string | null
          economic_activity: string
          email?: string | null
          fiscal_address: string
          phone?: string | null
          rnc: string
          updated_at?: string
        }
        Update: {
          business_name?: string
          clinic_id?: string
          commercial_name?: string | null
          economic_activity?: string
          email?: string | null
          fiscal_address?: string
          phone?: string | null
          rnc?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_fiscal_profiles_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: true
            referencedRelation: "clinics"
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
      clinic_member_disabled_specialties: {
        Row: {
          clinic_id: string
          clinic_member_id: string
          disabled_at: string
          disabled_by_user_id: string
          id: string
          specialty_template_id: string
        }
        Insert: {
          clinic_id: string
          clinic_member_id: string
          disabled_at?: string
          disabled_by_user_id: string
          id?: string
          specialty_template_id: string
        }
        Update: {
          clinic_id?: string
          clinic_member_id?: string
          disabled_at?: string
          disabled_by_user_id?: string
          id?: string
          specialty_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_disabled_specialties_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_disabled_specialties_clinic_member_id_fkey"
            columns: ["clinic_member_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_disabled_specialties_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_member_preferred_specialties: {
        Row: {
          clinic_id: string
          clinic_member_id: string
          created_at: string
          id: string
          specialty_template_id: string
        }
        Insert: {
          clinic_id: string
          clinic_member_id: string
          created_at?: string
          id?: string
          specialty_template_id: string
        }
        Update: {
          clinic_id?: string
          clinic_member_id?: string
          created_at?: string
          id?: string
          specialty_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_member_preferred_specialties_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_preferred_specialties_clinic_member_id_fkey"
            columns: ["clinic_member_id"]
            isOneToOne: false
            referencedRelation: "clinic_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_member_preferred_specialties_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_members: {
        Row: {
          attends_patients: boolean
          clinic_id: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["clinic_member_role"]
          user_id: string
        }
        Insert: {
          attends_patients?: boolean
          clinic_id: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["clinic_member_role"]
          user_id: string
        }
        Update: {
          attends_patients?: boolean
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
      clinic_payments: {
        Row: {
          amount: number
          clinic_id: string
          created_at: string
          id: string
          note: string | null
          paid_on: string
          period_days: number
          registered_by: string
          resulting_due_on: string
        }
        Insert: {
          amount: number
          clinic_id: string
          created_at?: string
          id?: string
          note?: string | null
          paid_on: string
          period_days: number
          registered_by: string
          resulting_due_on: string
        }
        Update: {
          amount?: number
          clinic_id?: string
          created_at?: string
          id?: string
          note?: string | null
          paid_on?: string
          period_days?: number
          registered_by?: string
          resulting_due_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_payments_clinic_id_fkey"
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
      clinic_subscription_events: {
        Row: {
          changed_by: string | null
          clinic_id: string
          created_at: string
          details: Json
          id: string
          kind: string
        }
        Insert: {
          changed_by?: string | null
          clinic_id: string
          created_at?: string
          details?: Json
          id?: string
          kind: string
        }
        Update: {
          changed_by?: string | null
          clinic_id?: string
          created_at?: string
          details?: Json
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_subscription_events_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_subscriptions: {
        Row: {
          access_exempt: boolean
          billing_period_days: number | null
          block_deferred_until: string | null
          clinic_id: string
          included_clinician_seats: number | null
          next_payment_due_on: string | null
          payment_status: string
          plan_conditions: string | null
          plan_started_on: string | null
          price: number | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          access_exempt?: boolean
          billing_period_days?: number | null
          block_deferred_until?: string | null
          clinic_id: string
          included_clinician_seats?: number | null
          next_payment_due_on?: string | null
          payment_status?: string
          plan_conditions?: string | null
          plan_started_on?: string | null
          price?: number | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          access_exempt?: boolean
          billing_period_days?: number | null
          block_deferred_until?: string | null
          clinic_id?: string
          included_clinician_seats?: number | null
          next_payment_due_on?: string | null
          payment_status?: string
          plan_conditions?: string | null
          plan_started_on?: string | null
          price?: number | null
          trial_ends_at?: string | null
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
      eligibility_checks: {
        Row: {
          checked_at: string
          checked_by: string
          clinic_id: string
          id: string
          notes: string | null
          patient_id: string
          patient_insurer_id: string
          result: string
        }
        Insert: {
          checked_at?: string
          checked_by: string
          clinic_id: string
          id?: string
          notes?: string | null
          patient_id: string
          patient_insurer_id: string
          result: string
        }
        Update: {
          checked_at?: string
          checked_by?: string
          clinic_id?: string
          id?: string
          notes?: string | null
          patient_id?: string
          patient_insurer_id?: string
          result?: string
        }
        Relationships: [
          {
            foreignKeyName: "eligibility_checks_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_checks_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eligibility_checks_patient_insurer_id_fkey"
            columns: ["patient_insurer_id"]
            isOneToOne: false
            referencedRelation: "patient_insurers"
            referencedColumns: ["id"]
          },
        ]
      }
      encounters: {
        Row: {
          appointment_id: string | null
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
          appointment_id?: string | null
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
          appointment_id?: string | null
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
            foreignKeyName: "encounters_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
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
      fiscal_document_items: {
        Row: {
          description: string
          fiscal_document_id: string
          id: string
          itbis_indicator: string
          line_number: number
          line_total: number
          quantity: number
          unit_price: number
        }
        Insert: {
          description: string
          fiscal_document_id: string
          id?: string
          itbis_indicator?: string
          line_number: number
          line_total: number
          quantity?: number
          unit_price: number
        }
        Update: {
          description?: string
          fiscal_document_id?: string
          id?: string
          itbis_indicator?: string
          line_number?: number
          line_total?: number
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_document_items_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          clinic_id: string
          comprador_direccion: string | null
          comprador_email: string | null
          comprador_nombre: string
          comprador_rnc_cedula: string | null
          created_at: string
          created_by: string
          dgii_track_id: string | null
          e_ncf: string | null
          encounter_id: string | null
          fecha_vencimiento_secuencia: string | null
          id: string
          monto_exento: number
          monto_gravado_total: number
          monto_total: number
          patient_id: string
          status: string
          tipo_ecf: string
          total_itbis: number
          updated_at: string
          voided_at: string | null
          voided_by: string | null
          voided_reason: string | null
          xml_firmado: string | null
          xml_sin_firmar: string | null
        }
        Insert: {
          clinic_id: string
          comprador_direccion?: string | null
          comprador_email?: string | null
          comprador_nombre: string
          comprador_rnc_cedula?: string | null
          created_at?: string
          created_by: string
          dgii_track_id?: string | null
          e_ncf?: string | null
          encounter_id?: string | null
          fecha_vencimiento_secuencia?: string | null
          id?: string
          monto_exento?: number
          monto_gravado_total?: number
          monto_total?: number
          patient_id: string
          status?: string
          tipo_ecf?: string
          total_itbis?: number
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
          xml_firmado?: string | null
          xml_sin_firmar?: string | null
        }
        Update: {
          clinic_id?: string
          comprador_direccion?: string | null
          comprador_email?: string | null
          comprador_nombre?: string
          comprador_rnc_cedula?: string | null
          created_at?: string
          created_by?: string
          dgii_track_id?: string | null
          e_ncf?: string | null
          encounter_id?: string | null
          fecha_vencimiento_secuencia?: string | null
          id?: string
          monto_exento?: number
          monto_gravado_total?: number
          monto_total?: number
          patient_id?: string
          status?: string
          tipo_ecf?: string
          total_itbis?: number
          updated_at?: string
          voided_at?: string | null
          voided_by?: string | null
          voided_reason?: string | null
          xml_firmado?: string | null
          xml_sin_firmar?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fiscal_documents_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_claim_diagnoses: {
        Row: {
          claim_id: string
          clinic_id: string
          code: string
          code_system: string
          created_at: string
          created_by: string
          description: string
          id: string
          is_primary: boolean
          position: number
        }
        Insert: {
          claim_id: string
          clinic_id: string
          code: string
          code_system?: string
          created_at?: string
          created_by: string
          description: string
          id?: string
          is_primary?: boolean
          position?: number
        }
        Update: {
          claim_id?: string
          clinic_id?: string
          code?: string
          code_system?: string
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          is_primary?: boolean
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claim_diagnoses_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claim_diagnoses_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_claim_status_history: {
        Row: {
          approved_amount: number | null
          changed_at: string
          changed_by: string | null
          claim_id: string
          clinic_id: string
          from_status: string | null
          id: string
          rejection_reason: string | null
          to_status: string
        }
        Insert: {
          approved_amount?: number | null
          changed_at?: string
          changed_by?: string | null
          claim_id: string
          clinic_id: string
          from_status?: string | null
          id?: string
          rejection_reason?: string | null
          to_status: string
        }
        Update: {
          approved_amount?: number | null
          changed_at?: string
          changed_by?: string | null
          claim_id?: string
          clinic_id?: string
          from_status?: string | null
          id?: string
          rejection_reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claim_status_history_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "insurance_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claim_status_history_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_claims: {
        Row: {
          approved_amount: number | null
          authorization_number: string | null
          claimed_amount: number | null
          clinic_id: string
          created_at: string
          created_by: string
          encounter_id: string
          fiscal_document_id: string | null
          id: string
          notes: string | null
          paid_amount: number | null
          paid_on: string | null
          patient_insurer_id: string
          rejection_reason: string | null
          status: string
          status_updated_at: string | null
          status_updated_by: string | null
          updated_at: string
        }
        Insert: {
          approved_amount?: number | null
          authorization_number?: string | null
          claimed_amount?: number | null
          clinic_id: string
          created_at?: string
          created_by: string
          encounter_id: string
          fiscal_document_id?: string | null
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_on?: string | null
          patient_insurer_id: string
          rejection_reason?: string | null
          status?: string
          status_updated_at?: string | null
          status_updated_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_amount?: number | null
          authorization_number?: string | null
          claimed_amount?: number | null
          clinic_id?: string
          created_at?: string
          created_by?: string
          encounter_id?: string
          fiscal_document_id?: string | null
          id?: string
          notes?: string | null
          paid_amount?: number | null
          paid_on?: string | null
          patient_insurer_id?: string
          rejection_reason?: string | null
          status?: string
          status_updated_at?: string | null
          status_updated_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insurance_claims_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_encounter_id_fkey"
            columns: ["encounter_id"]
            isOneToOne: false
            referencedRelation: "encounters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_fiscal_document_id_fkey"
            columns: ["fiscal_document_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_claims_patient_insurer_id_fkey"
            columns: ["patient_insurer_id"]
            isOneToOne: false
            referencedRelation: "patient_insurers"
            referencedColumns: ["id"]
          },
        ]
      }
      insurers: {
        Row: {
          aliases: string[]
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
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
      patient_insurers: {
        Row: {
          affiliate_number: string
          clinic_id: string
          id: string
          insurer_id: string | null
          insurer_name: string
          is_current: boolean
          patient_id: string
          recorded_at: string
          recorded_by: string
        }
        Insert: {
          affiliate_number: string
          clinic_id: string
          id?: string
          insurer_id?: string | null
          insurer_name: string
          is_current?: boolean
          patient_id: string
          recorded_at?: string
          recorded_by: string
        }
        Update: {
          affiliate_number?: string
          clinic_id?: string
          id?: string
          insurer_id?: string | null
          insurer_name?: string
          is_current?: boolean
          patient_id?: string
          recorded_at?: string
          recorded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_insurers_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_insurers_insurer_id_fkey"
            columns: ["insurer_id"]
            isOneToOne: false
            referencedRelation: "insurers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_insurers_patient_id_fkey"
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
      sensitive_specialty_access_grants: {
        Row: {
          clinic_id: string
          created_at: string
          granted_at: string
          granted_by_user_id: string
          granted_to_user_id: string
          id: string
          patient_id: string
          reason: string
          revoked_at: string | null
          revoked_by_user_id: string | null
          revoked_reason: string | null
          specialty_template_id: string
        }
        Insert: {
          clinic_id: string
          created_at?: string
          granted_at?: string
          granted_by_user_id: string
          granted_to_user_id: string
          id?: string
          patient_id: string
          reason: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          revoked_reason?: string | null
          specialty_template_id: string
        }
        Update: {
          clinic_id?: string
          created_at?: string
          granted_at?: string
          granted_by_user_id?: string
          granted_to_user_id?: string
          id?: string
          patient_id?: string
          reason?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          revoked_reason?: string | null
          specialty_template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sensitive_specialty_access_grants_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sensitive_specialty_access_grants_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sensitive_specialty_access_grants_specialty_template_id_fkey"
            columns: ["specialty_template_id"]
            isOneToOne: false
            referencedRelation: "specialty_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      specialty_templates: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          requires_explicit_access: boolean
          schema: Json
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          requires_explicit_access?: boolean
          schema: Json
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          requires_explicit_access?: boolean
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
      whatsapp_messages: {
        Row: {
          clinic_id: string | null
          created_at: string
          environment: string
          error_message: string | null
          id: string
          meta_app_id: string
          meta_message_id: string | null
          patient_id: string | null
          sent_by: string
          status: string
          template_language: string
          template_name: string
          template_variables: Json
          to_phone_number: string
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          environment: string
          error_message?: string | null
          id?: string
          meta_app_id: string
          meta_message_id?: string | null
          patient_id?: string | null
          sent_by: string
          status: string
          template_language: string
          template_name: string
          template_variables?: Json
          to_phone_number: string
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          environment?: string
          error_message?: string | null
          id?: string
          meta_app_id?: string
          meta_message_id?: string | null
          patient_id?: string | null
          sent_by?: string
          status?: string
          template_language?: string
          template_name?: string
          template_variables?: Json
          to_phone_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
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
      attach_readonly_guard: { Args: { p_table: unknown }; Returns: undefined }
      can_access_sensitive_encounter: {
        Args: {
          target_clinic_id: string
          target_patient_id: string
          target_provider_id: string
          target_specialty_template_id: string
        }
        Returns: boolean
      }
      clinic_access_due_on: { Args: { p_clinic_id: string }; Returns: string }
      clinic_access_state: {
        Args: { p_clinic_id: string; p_today?: string }
        Returns: string
      }
      clinic_is_accessible: { Args: { p_clinic_id: string }; Returns: boolean }
      clinic_lifecycle_dates: {
        Args: { p_clinic_id: string }
        Returns: {
          block_deferred_until: string
          blocked_on: string
          due_on: string
          readonly_from: string
          retention_until: string
        }[]
      }
      clinic_lifecycle_offsets: {
        Args: never
        Returns: {
          grace_days: number
          readonly_days: number
          retention_years: number
        }[]
      }
      clinician_seats_used: { Args: { p_clinic_id: string }; Returns: number }
      complete_appointment_with_encounter: {
        Args: { target_appointment_id: string; target_encounter_id: string }
        Returns: undefined
      }
      confirm_deletion_export: {
        Args: { p_request_id: string }
        Returns: string
      }
      create_clinic_with_admin: {
        Args: {
          clinic_business_model: Database["public"]["Enums"]["clinic_business_model"]
          clinic_name: string
          clinic_province: string
        }
        Returns: string
      }
      current_user_email: { Args: never; Returns: string }
      data_deletion_offsets: {
        Args: never
        Returns: {
          fiscal_archive_years: number
          wait_days: number
        }[]
      }
      dr_today: { Args: { p_ts?: string }; Returns: string }
      execute_clinic_data_deletion: {
        Args: { p_confirm_name: string; p_request_id: string }
        Returns: string[]
      }
      extend_clinic_trial: {
        Args: { p_days: number; p_reason: string; target_clinic_id: string }
        Returns: undefined
      }
      generate_fiscal_document: {
        Args: {
          comprador_direccion: string
          comprador_email: string
          comprador_nombre: string
          comprador_rnc_cedula: string
          items: Json
          target_encounter_id: string
          target_patient_id: string
        }
        Returns: string
      }
      get_my_clinic_access: {
        Args: never
        Returns: {
          clinic_id: string
          days_to_block: number
          days_to_expiry: number
          days_to_readonly: number
          seats_included: number
          seats_used: number
          state: string
        }[]
      }
      grant_sensitive_specialty_access: {
        Args: {
          p_reason: string
          target_patient_id: string
          target_specialty_template_id: string
          target_user_id: string
        }
        Returns: string
      }
      is_admin_of_active_clinic: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_billing_staff_of_active_clinic: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_clinic_admin: { Args: { target_clinic_id: string }; Returns: boolean }
      is_clinic_clinician: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_clinic_member: { Args: { target_clinic_id: string }; Returns: boolean }
      is_clinic_writable: { Args: { p_clinic_id: string }; Returns: boolean }
      is_clinician_of_active_clinic: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_member_of_active_clinic: {
        Args: { target_clinic_id: string }
        Returns: boolean
      }
      is_platform_operator: { Args: never; Returns: boolean }
      is_specialty_enabled_for_clinician: {
        Args: {
          target_clinic_id: string
          target_specialty_template_id: string
          target_user_id: string
        }
        Returns: boolean
      }
      list_policies_open_when_blocked: { Args: never; Returns: string[] }
      list_unguarded_tables: { Args: never; Returns: string[] }
      log_clinic_export: { Args: { p_kind: string }; Returns: undefined }
      match_insurer: { Args: { p_name: string }; Returns: string }
      my_admin_clinic_id: { Args: never; Returns: string }
      normalize_insurer_name: { Args: { p_name: string }; Returns: string }
      operator_clinic_access_overview: {
        Args: never
        Returns: {
          block_deferred_until: string
          blocked_on: string
          clinic_id: string
          days_to_block: number
          days_to_expiry: number
          days_to_readonly: number
          due_on: string
          retention_until: string
          seats_used: number
          state: string
        }[]
      }
      operator_register_deletion_request: {
        Args: {
          p_note: string
          p_requester_email: string
          p_warning_text: string
          target_clinic_id: string
        }
        Returns: string
      }
      operator_start_expired_retention_deletion: {
        Args: { target_clinic_id: string }
        Returns: string
      }
      operator_unmatched_insurers: {
        Args: never
        Returns: {
          insurer_name: string
          uses: number
        }[]
      }
      readonly_guard_exempt_tables: { Args: never; Returns: string[] }
      register_clinic_payment: {
        Args: {
          p_amount: number
          p_note: string
          p_paid_on: string
          target_clinic_id: string
        }
        Returns: undefined
      }
      request_clinic_data_deletion: {
        Args: { p_accepted: boolean; p_warning_text: string }
        Returns: string
      }
      revoke_consent: {
        Args: { reason: string; target_consent_id: string }
        Returns: undefined
      }
      revoke_sensitive_specialty_access: {
        Args: { p_reason: string; target_grant_id: string }
        Returns: undefined
      }
      set_clinic_access_exempt: {
        Args: { p_exempt: boolean; p_reason: string; target_clinic_id: string }
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
      set_clinic_block_agreement: {
        Args: { p_reason: string; p_until: string; target_clinic_id: string }
        Returns: undefined
      }
      set_clinic_clinician_seats: {
        Args: { p_reason: string; p_seats: number; target_clinic_id: string }
        Returns: undefined
      }
      set_clinic_plan_period: {
        Args: {
          p_amount: number
          p_period_days: number
          p_start_on: string
          target_clinic_id: string
        }
        Returns: undefined
      }
      set_member_attends_patients: {
        Args: {
          p_attends: boolean
          p_reason: string
          target_clinic_id: string
          target_user_id: string
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
      upsert_clinic_fiscal_profile: {
        Args: {
          business_name: string
          commercial_name: string
          economic_activity: string
          email: string
          fiscal_address: string
          phone: string
          rnc: string
          target_clinic_id: string
        }
        Returns: undefined
      }
      upsert_insurer: {
        Args: {
          p_aliases: string[]
          p_id?: string
          p_is_active: boolean
          p_name: string
        }
        Returns: string
      }
      void_fiscal_document: {
        Args: { reason: string; target_fiscal_document_id: string }
        Returns: undefined
      }
      withdraw_clinic_data_deletion: {
        Args: { p_request_id: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
