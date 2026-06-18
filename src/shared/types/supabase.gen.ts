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
      cash_cierres_dia: {
        Row: {
          ajuste_motivo: string | null
          ajuste_tipo: string | null
          created_at: string | null
          diferencia_crc: number | null
          ef_real_m_crc: number | null
          ef_real_n_crc: number | null
          id: string
          manager: string
          notas: string | null
          otros_m_crc: number | null
          otros_n_crc: number | null
          propinas_m_crc: number | null
          propinas_n_crc: number | null
          remanente_crc: number | null
          remanente_usd: number | null
          sep_diaria_crc: number | null
          sep_diaria_usd: number | null
          sep_registradora_crc: number | null
          sep_registradora_usd: number | null
          session_date: string
          tipo: string
          tipo_cambio: number | null
          updated_at: string | null
          vm_crc: number | null
          vm_usd: number | null
          vn_crc: number | null
          vn_usd: number | null
        }
        Insert: {
          ajuste_motivo?: string | null
          ajuste_tipo?: string | null
          created_at?: string | null
          diferencia_crc?: number | null
          ef_real_m_crc?: number | null
          ef_real_n_crc?: number | null
          id?: string
          manager?: string
          notas?: string | null
          otros_m_crc?: number | null
          otros_n_crc?: number | null
          propinas_m_crc?: number | null
          propinas_n_crc?: number | null
          remanente_crc?: number | null
          remanente_usd?: number | null
          sep_diaria_crc?: number | null
          sep_diaria_usd?: number | null
          sep_registradora_crc?: number | null
          sep_registradora_usd?: number | null
          session_date: string
          tipo?: string
          tipo_cambio?: number | null
          updated_at?: string | null
          vm_crc?: number | null
          vm_usd?: number | null
          vn_crc?: number | null
          vn_usd?: number | null
        }
        Update: {
          ajuste_motivo?: string | null
          ajuste_tipo?: string | null
          created_at?: string | null
          diferencia_crc?: number | null
          ef_real_m_crc?: number | null
          ef_real_n_crc?: number | null
          id?: string
          manager?: string
          notas?: string | null
          otros_m_crc?: number | null
          otros_n_crc?: number | null
          propinas_m_crc?: number | null
          propinas_n_crc?: number | null
          remanente_crc?: number | null
          remanente_usd?: number | null
          sep_diaria_crc?: number | null
          sep_diaria_usd?: number | null
          sep_registradora_crc?: number | null
          sep_registradora_usd?: number | null
          session_date?: string
          tipo?: string
          tipo_cambio?: number | null
          updated_at?: string | null
          vm_crc?: number | null
          vm_usd?: number | null
          vn_crc?: number | null
          vn_usd?: number | null
        }
        Relationships: []
      }
      cash_movements: {
        Row: {
          account_id: string | null
          amount_crc: number
          amount_usd: number | null
          approved_at: string | null
          approved_by: string | null
          attachments: Json
          caja_origen: string | null
          client_op_id: string | null
          created_at: string
          created_by: string
          currency: Database["public"]["Enums"]["currency"]
          description: string
          employee_name: string | null
          exchange_rate: number | null
          id: string
          method: string | null
          movement_type: string
          session_id: string | null
          shift: string | null
          status: string
          subcategory: string | null
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          amount_crc: number
          amount_usd?: number | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          caja_origen?: string | null
          client_op_id?: string | null
          created_at?: string
          created_by: string
          currency?: Database["public"]["Enums"]["currency"]
          description: string
          employee_name?: string | null
          exchange_rate?: number | null
          id?: string
          method?: string | null
          movement_type: string
          session_id?: string | null
          shift?: string | null
          status?: string
          subcategory?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          amount_crc?: number
          amount_usd?: number | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json
          caja_origen?: string | null
          client_op_id?: string | null
          created_at?: string
          created_by?: string
          currency?: Database["public"]["Enums"]["currency"]
          description?: string
          employee_name?: string | null
          exchange_rate?: number | null
          id?: string
          method?: string | null
          movement_type?: string
          session_id?: string | null
          shift?: string | null
          status?: string
          subcategory?: string | null
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cash_movements_supplier"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          cajero_name: string | null
          closed_by: string | null
          created_at: string
          final_bank_crc: number | null
          final_cash_crc: number | null
          final_cash_usd: number | null
          final_safe_crc: number | null
          final_service_crc: number | null
          final_suppliers_crc: number | null
          id: string
          initial_cash_crc: number | null
          initial_cash_usd: number | null
          initial_service_crc: number
          initial_suppliers_crc: number
          midday_check_at: string | null
          midday_check_by: string | null
          notes: string | null
          opened_by: string
          session_date: string
          shift_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cajero_name?: string | null
          closed_by?: string | null
          created_at?: string
          final_bank_crc?: number | null
          final_cash_crc?: number | null
          final_cash_usd?: number | null
          final_safe_crc?: number | null
          final_service_crc?: number | null
          final_suppliers_crc?: number | null
          id?: string
          initial_cash_crc?: number | null
          initial_cash_usd?: number | null
          initial_service_crc?: number
          initial_suppliers_crc?: number
          midday_check_at?: string | null
          midday_check_by?: string | null
          notes?: string | null
          opened_by: string
          session_date: string
          shift_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cajero_name?: string | null
          closed_by?: string | null
          created_at?: string
          final_bank_crc?: number | null
          final_cash_crc?: number | null
          final_cash_usd?: number | null
          final_safe_crc?: number | null
          final_service_crc?: number | null
          final_suppliers_crc?: number | null
          id?: string
          initial_cash_crc?: number | null
          initial_cash_usd?: number | null
          initial_service_crc?: number
          initial_suppliers_crc?: number
          midday_check_at?: string | null
          midday_check_by?: string | null
          notes?: string | null
          opened_by?: string
          session_date?: string
          shift_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_midday_check_by_fkey"
            columns: ["midday_check_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_interactions: {
        Row: {
          amount_crc: number | null
          channel: string | null
          created_at: string | null
          created_by: string | null
          customer_id: string | null
          id: string
          notes: string | null
          points_earned: number | null
          points_spent: number | null
          reference_id: string | null
          type: string | null
        }
        Insert: {
          amount_crc?: number | null
          channel?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          points_earned?: number | null
          points_spent?: number | null
          reference_id?: string | null
          type?: string | null
        }
        Update: {
          amount_crc?: number | null
          channel?: string | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          points_earned?: number | null
          points_spent?: number | null
          reference_id?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_interactions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          active: boolean | null
          birth_date: string | null
          channel_origin: string | null
          created_at: string | null
          email: string | null
          first_seen: string | null
          id: string
          last_seen: string | null
          name: string | null
          notes: string | null
          phone: string
          points: number | null
          tier: string | null
          total_spent_crc: number | null
          total_visits: number | null
          updated_at: string | null
          wallet_pass_id: string | null
        }
        Insert: {
          active?: boolean | null
          birth_date?: string | null
          channel_origin?: string | null
          created_at?: string | null
          email?: string | null
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          name?: string | null
          notes?: string | null
          phone: string
          points?: number | null
          tier?: string | null
          total_spent_crc?: number | null
          total_visits?: number | null
          updated_at?: string | null
          wallet_pass_id?: string | null
        }
        Update: {
          active?: boolean | null
          birth_date?: string | null
          channel_origin?: string | null
          created_at?: string | null
          email?: string | null
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          name?: string | null
          notes?: string | null
          phone?: string
          points?: number | null
          tier?: string | null
          total_spent_crc?: number | null
          total_visits?: number | null
          updated_at?: string | null
          wallet_pass_id?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          clave_fe: string | null
          created_at: string
          created_by: string | null
          estado: string
          id: string
          image_path: string
          linked_movement_id: string | null
          raw_json: Json | null
          sha256: string | null
          tipo: string | null
        }
        Insert: {
          clave_fe?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          image_path: string
          linked_movement_id?: string | null
          raw_json?: Json | null
          sha256?: string | null
          tipo?: string | null
        }
        Update: {
          clave_fe?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          image_path?: string
          linked_movement_id?: string | null
          raw_json?: Json | null
          sha256?: string | null
          tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_linked_movement_id_fkey"
            columns: ["linked_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          pos_name: string | null
          profile_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id?: string
          is_active?: boolean
          pos_name?: string | null
          profile_id?: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          pos_name?: string | null
          profile_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          rate_date: string
          source: string | null
          usd_to_crc: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          rate_date: string
          source?: string | null
          usd_to_crc: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          rate_date?: string
          source?: string | null
          usd_to_crc?: number
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fe_documentos: {
        Row: {
          check_id: string | null
          clave: string | null
          consecutivo: string | null
          created_at: string
          error_msg: string | null
          estado: string
          id: string
          order_id: string
          payment_id: string | null
          provider: string
          provider_ref: string | null
          receptor_email: string | null
          receptor_id: string | null
          receptor_nombre: string | null
          tipo: string
          total: number
          total_iva: number
          total_neto: number
          total_servicio: number
          updated_at: string
        }
        Insert: {
          check_id?: string | null
          clave?: string | null
          consecutivo?: string | null
          created_at?: string
          error_msg?: string | null
          estado?: string
          id?: string
          order_id: string
          payment_id?: string | null
          provider?: string
          provider_ref?: string | null
          receptor_email?: string | null
          receptor_id?: string | null
          receptor_nombre?: string | null
          tipo?: string
          total?: number
          total_iva?: number
          total_neto?: number
          total_servicio?: number
          updated_at?: string
        }
        Update: {
          check_id?: string | null
          clave?: string | null
          consecutivo?: string | null
          created_at?: string
          error_msg?: string | null
          estado?: string
          id?: string
          order_id?: string
          payment_id?: string | null
          provider?: string
          provider_ref?: string | null
          receptor_email?: string | null
          receptor_id?: string | null
          receptor_nombre?: string | null
          tipo?: string
          total?: number
          total_iva?: number
          total_neto?: number
          total_servicio?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fe_documentos_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "pos_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fe_documentos_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pos_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fe_documentos_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "pos_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_accounts: {
        Row: {
          code: string | null
          id: string
          is_leaf: boolean | null
          name: string
          parent_id: string | null
          section: string | null
          sort: number | null
        }
        Insert: {
          code?: string | null
          id: string
          is_leaf?: boolean | null
          name: string
          parent_id?: string | null
          section?: string | null
          sort?: number | null
        }
        Update: {
          code?: string | null
          id?: string
          is_leaf?: boolean | null
          name?: string
          parent_id?: string | null
          section?: string | null
          sort?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_actuals: {
        Row: {
          account_id: string | null
          amount: number
          created_at: string | null
          id: string
          month: number
          note: string | null
          source: string | null
          year: number
        }
        Insert: {
          account_id?: string | null
          amount?: number
          created_at?: string | null
          id?: string
          month: number
          note?: string | null
          source?: string | null
          year: number
        }
        Update: {
          account_id?: string | null
          amount?: number
          created_at?: string | null
          id?: string
          month?: number
          note?: string | null
          source?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_actuals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_budget: {
        Row: {
          account_id: string
          amount: number
          month: number
          year: number
        }
        Insert: {
          account_id: string
          amount?: number
          month: number
          year: number
        }
        Update: {
          account_id?: string
          amount?: number
          month?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "finance_budget_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_prices: {
        Row: {
          created_at: string
          document_id: string | null
          fecha: string | null
          id: string
          ingredient_id: string | null
          precio_unitario: number | null
          supplier_id: string | null
          unidad: string | null
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          fecha?: string | null
          id?: string
          ingredient_id?: string | null
          precio_unitario?: number | null
          supplier_id?: string | null
          unidad?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string | null
          fecha?: string | null
          id?: string
          ingredient_id?: string | null
          precio_unitario?: number | null
          supplier_id?: string | null
          unidad?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_prices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_prices_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingredient_prices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          category: string | null
          cost_per_unit: number | null
          created_at: string | null
          current_stock: number | null
          id: string
          min_stock: number | null
          name: string
          notes: string | null
          supplier: string | null
          unit: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          current_stock?: number | null
          id?: string
          min_stock?: number | null
          name: string
          notes?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          cost_per_unit?: number | null
          created_at?: string | null
          current_stock?: number | null
          id?: string
          min_stock?: number | null
          name?: string
          notes?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          cash_movement_id: string | null
          created_at: string | null
          created_by: string | null
          document_id: string | null
          id: string
          ingredient_id: string
          movement_type: string
          notes: string | null
          qty_delta: number
          reference_id: string | null
          unit: string
          unit_cost: number | null
        }
        Insert: {
          cash_movement_id?: string | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          id?: string
          ingredient_id: string
          movement_type: string
          notes?: string | null
          qty_delta: number
          reference_id?: string | null
          unit: string
          unit_cost?: number | null
        }
        Update: {
          cash_movement_id?: string | null
          created_at?: string | null
          created_by?: string | null
          document_id?: string | null
          id?: string
          ingredient_id?: string
          movement_type?: string
          notes?: string | null
          qty_delta?: number
          reference_id?: string | null
          unit?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      loyalty_config: {
        Row: {
          id: number
          rules: Json
          updated_at: string | null
        }
        Insert: {
          id?: number
          rules?: Json
          updated_at?: string | null
        }
        Update: {
          id?: number
          rules?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      loyalty_rewards: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          points_cost: number
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          points_cost?: number
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          points_cost?: number
        }
        Relationships: []
      }
      menu_categories: {
        Row: {
          category: string
          family_id: string | null
          hidden_comandero: boolean
          sort_order: number
          subfamily: string
        }
        Insert: {
          category: string
          family_id?: string | null
          hidden_comandero?: boolean
          sort_order?: number
          subfamily?: string
        }
        Update: {
          category?: string
          family_id?: string | null
          hidden_comandero?: boolean
          sort_order?: number
          subfamily?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "menu_families"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_families: {
        Row: {
          icon: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          icon?: string
          id: string
          label: string
          sort_order?: number
        }
        Update: {
          icon?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      modifier_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          location_id: string
          max_selections: number
          min_selections: number
          name: string
          required: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string
          max_selections?: number
          min_selections?: number
          name: string
          required?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string
          max_selections?: number
          min_selections?: number
          name?: string
          required?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      modifiers: {
        Row: {
          created_at: string
          group_id: string
          id: string
          is_active: boolean
          name: string
          price_delta_crc: number
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          is_active?: boolean
          name: string
          price_delta_crc?: number
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          is_active?: boolean
          name?: string
          price_delta_crc?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifiers_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_checks: {
        Row: {
          amount_crc: number
          created_at: string
          id: string
          idx: number
          items_snapshot: Json
          kind: string
          label: string
          order_id: string
          paid: boolean
          paid_at: string | null
        }
        Insert: {
          amount_crc: number
          created_at?: string
          id?: string
          idx: number
          items_snapshot?: Json
          kind: string
          label?: string
          order_id: string
          paid?: boolean
          paid_at?: string | null
        }
        Update: {
          amount_crc?: number
          created_at?: string
          id?: string
          idx?: number
          items_snapshot?: Json
          kind?: string
          label?: string
          order_id?: string
          paid?: boolean
          paid_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_checks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pos_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_kds_settings: {
        Row: {
          category_order: Json
          course_thresholds: Json
          location_id: string
          postres_priority: boolean
          postres_threshold: number
          subcategory_order: Json
          updated_at: string
        }
        Insert: {
          category_order?: Json
          course_thresholds?: Json
          location_id: string
          postres_priority?: boolean
          postres_threshold?: number
          subcategory_order?: Json
          updated_at?: string
        }
        Update: {
          category_order?: Json
          course_thresholds?: Json
          location_id?: string
          postres_priority?: boolean
          postres_threshold?: number
          subcategory_order?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_kds_settings_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: true
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_order_items: {
        Row: {
          aplica_servicio: boolean
          base_price_crc: number
          course: string
          created_at: string
          id: string
          kitchen_status: string
          marched_at: string | null
          merged_from_order: string | null
          modifiers: Json
          note: string
          order_id: string
          price_crc: number
          product_name: string
          qty: number
          ready_at: string | null
          seat: number
          station: string
          subcategory: string
          tax_type: string
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          aplica_servicio?: boolean
          base_price_crc?: number
          course?: string
          created_at?: string
          id?: string
          kitchen_status?: string
          marched_at?: string | null
          merged_from_order?: string | null
          modifiers?: Json
          note?: string
          order_id: string
          price_crc?: number
          product_name: string
          qty?: number
          ready_at?: string | null
          seat?: number
          station?: string
          subcategory?: string
          tax_type?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          aplica_servicio?: boolean
          base_price_crc?: number
          course?: string
          created_at?: string
          id?: string
          kitchen_status?: string
          marched_at?: string | null
          merged_from_order?: string | null
          modifiers?: Json
          note?: string
          order_id?: string
          price_crc?: number
          product_name?: string
          qty?: number
          ready_at?: string | null
          seat?: number
          station?: string
          subcategory?: string
          tax_type?: string
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pos_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_order_items_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_orders: {
        Row: {
          channel: string
          closed_at: string | null
          closed_by: string | null
          cogs_crc: number | null
          created_at: string
          current_salonero_id: string | null
          id: string
          location_id: string
          merge_trace: Json
          merged_into: string | null
          notes: string
          opened_by: string
          pax: number
          salonero_name: string
          status: string
          table_id: string | null
          table_name: string
          transfers: Json
          updated_at: string
        }
        Insert: {
          channel?: string
          closed_at?: string | null
          closed_by?: string | null
          cogs_crc?: number | null
          created_at?: string
          current_salonero_id?: string | null
          id?: string
          location_id: string
          merge_trace?: Json
          merged_into?: string | null
          notes?: string
          opened_by: string
          pax: number
          salonero_name?: string
          status?: string
          table_id?: string | null
          table_name: string
          transfers?: Json
          updated_at?: string
        }
        Update: {
          channel?: string
          closed_at?: string | null
          closed_by?: string | null
          cogs_crc?: number | null
          created_at?: string
          current_salonero_id?: string | null
          id?: string
          location_id?: string
          merge_trace?: Json
          merged_into?: string | null
          notes?: string
          opened_by?: string
          pax?: number
          salonero_name?: string
          status?: string
          table_id?: string | null
          table_name?: string
          transfers?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_orders_current_salonero_id_fkey"
            columns: ["current_salonero_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_orders_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "pos_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_orders_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "salon_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payments: {
        Row: {
          amount_crc: number
          change_crc: number
          check_id: string | null
          client_op_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          exchange_rate_used: number | null
          id: string
          method: string
          note: string
          order_id: string
          received_crc: number
          received_usd: number
          tip_crc: number
          tip_currency: string
        }
        Insert: {
          amount_crc: number
          change_crc?: number
          check_id?: string | null
          client_op_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate_used?: number | null
          id?: string
          method: string
          note?: string
          order_id: string
          received_crc?: number
          received_usd?: number
          tip_crc?: number
          tip_currency?: string
        }
        Update: {
          amount_crc?: number
          change_crc?: number
          check_id?: string | null
          client_op_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate_used?: number | null
          id?: string
          method?: string
          note?: string
          order_id?: string
          received_crc?: number
          received_usd?: number
          tip_crc?: number
          tip_currency?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_payments_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "pos_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pos_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_prices: {
        Row: {
          is_demo: boolean
          location_id: string
          price_final_crc: number | null
          product_name: string
          tax_type: string
          updated_at: string
        }
        Insert: {
          is_demo?: boolean
          location_id: string
          price_final_crc?: number | null
          product_name: string
          tax_type?: string
          updated_at?: string
        }
        Update: {
          is_demo?: boolean
          location_id?: string
          price_final_crc?: number | null
          product_name?: string
          tax_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_prices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_prices_product_name_fkey"
            columns: ["product_name"]
            isOneToOne: false
            referencedRelation: "product_map"
            referencedColumns: ["nombre"]
          },
        ]
      }
      product_map: {
        Row: {
          allergens: string
          aplica_servicio: boolean
          cabys: string | null
          ciiu: string | null
          clasificacion: string | null
          costo_unitario: number | null
          is_active: boolean
          multiplicador: number | null
          nombre: string
          photo_url: string | null
          prep_time_min: number | null
          station: string
          subclasificacion: string | null
          tipo: string
          updated_at: string | null
        }
        Insert: {
          allergens?: string
          aplica_servicio?: boolean
          cabys?: string | null
          ciiu?: string | null
          clasificacion?: string | null
          costo_unitario?: number | null
          is_active?: boolean
          multiplicador?: number | null
          nombre: string
          photo_url?: string | null
          prep_time_min?: number | null
          station?: string
          subclasificacion?: string | null
          tipo?: string
          updated_at?: string | null
        }
        Update: {
          allergens?: string
          aplica_servicio?: boolean
          cabys?: string | null
          ciiu?: string | null
          clasificacion?: string | null
          costo_unitario?: number | null
          is_active?: boolean
          multiplicador?: number | null
          nombre?: string
          photo_url?: string | null
          prep_time_min?: number | null
          station?: string
          subclasificacion?: string | null
          tipo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      product_modifier_groups: {
        Row: {
          group_id: string
          product_name: string
          sort_order: number
        }
        Insert: {
          group_id: string
          product_name: string
          sort_order?: number
        }
        Update: {
          group_id?: string
          product_name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_modifier_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifier_groups_product_name_fkey"
            columns: ["product_name"]
            isOneToOne: false
            referencedRelation: "product_map"
            referencedColumns: ["nombre"]
          },
        ]
      }
      product_modifier_options: {
        Row: {
          enabled: boolean
          modifier_id: string
          price_delta_override_crc: number | null
          product_name: string
        }
        Insert: {
          enabled?: boolean
          modifier_id: string
          price_delta_override_crc?: number | null
          product_name: string
        }
        Update: {
          enabled?: boolean
          modifier_id?: string
          price_delta_override_crc?: number | null
          product_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_modifier_options_modifier_id_fkey"
            columns: ["modifier_id"]
            isOneToOne: false
            referencedRelation: "modifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifier_options_product_name_fkey"
            columns: ["product_name"]
            isOneToOne: false
            referencedRelation: "product_map"
            referencedColumns: ["nombre"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          id: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit: string
          waste_factor: number | null
        }
        Insert: {
          id?: string
          ingredient_id: string
          quantity: number
          recipe_id: string
          unit: string
          waste_factor?: number | null
        }
        Update: {
          id?: string
          ingredient_id?: string
          quantity?: number
          recipe_id?: string
          unit?: string
          waste_factor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          created_at: string | null
          id: string
          notes: string | null
          product_name: string
          updated_at: string | null
          yield_qty: number | null
          yield_unit: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          notes?: string | null
          product_name: string
          updated_at?: string | null
          yield_qty?: number | null
          yield_unit?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          notes?: string | null
          product_name?: string
          updated_at?: string | null
          yield_qty?: number | null
          yield_unit?: string | null
        }
        Relationships: []
      }
      role_tip_points: {
        Row: {
          points: number
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          points: number
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          points?: number
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      salon_tables: {
        Row: {
          capacity: number
          created_at: string
          height: number | null
          id: string
          is_active: boolean
          kind: string
          location_id: string
          name: string
          pos_x: number
          pos_y: number
          shape: string
          updated_at: string
          width: number | null
        }
        Insert: {
          capacity?: number
          created_at?: string
          height?: number | null
          id?: string
          is_active?: boolean
          kind?: string
          location_id: string
          name: string
          pos_x?: number
          pos_y?: number
          shape?: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          capacity?: number
          created_at?: string
          height?: number | null
          id?: string
          is_active?: boolean
          kind?: string
          location_id?: string
          name?: string
          pos_x?: number
          pos_y?: number
          shape?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "salon_tables_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      sops: {
        Row: {
          category: string
          content: string
          created_at: string | null
          created_by: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category?: string
          content?: string
          created_at?: string | null
          created_by?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string | null
          created_by?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sops_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_item_map: {
        Row: {
          codigo: string | null
          descripcion_factura: string | null
          es_inventario: boolean
          factor_conversion: number
          id: string
          ingredient_id: string | null
          supplier_id: string | null
          unidad_factura: string | null
          updated_at: string
        }
        Insert: {
          codigo?: string | null
          descripcion_factura?: string | null
          es_inventario?: boolean
          factor_conversion?: number
          id?: string
          ingredient_id?: string | null
          supplier_id?: string | null
          unidad_factura?: string | null
          updated_at?: string
        }
        Update: {
          codigo?: string | null
          descripcion_factura?: string | null
          es_inventario?: boolean
          factor_conversion?: number
          id?: string
          ingredient_id?: string | null
          supplier_id?: string | null
          unidad_factura?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_item_map_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_item_map_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          aliases: string[] | null
          category: string | null
          ciclo_pago: string | null
          contact: string | null
          created_at: string
          cuenta_iban: string | null
          id: string
          is_active: boolean
          metodo_pago: string | null
          moneda: string | null
          name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[] | null
          category?: string | null
          ciclo_pago?: string | null
          contact?: string | null
          created_at?: string
          cuenta_iban?: string | null
          id?: string
          is_active?: boolean
          metodo_pago?: string | null
          moneda?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[] | null
          category?: string | null
          ciclo_pago?: string | null
          contact?: string | null
          created_at?: string
          cuenta_iban?: string | null
          id?: string
          is_active?: boolean
          metodo_pago?: string | null
          moneda?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      tip_entries: {
        Row: {
          client_op_id: string | null
          covered_role: string | null
          created_at: string
          employee_id: string
          hours_worked: number
          id: string
          payout_crc: number | null
          points: number | null
          session_id: string
          tip_amount_crc: number
          tip_amount_usd: number
          updated_at: string
        }
        Insert: {
          client_op_id?: string | null
          covered_role?: string | null
          created_at?: string
          employee_id: string
          hours_worked: number
          id?: string
          payout_crc?: number | null
          points?: number | null
          session_id: string
          tip_amount_crc?: number
          tip_amount_usd?: number
          updated_at?: string
        }
        Update: {
          client_op_id?: string | null
          covered_role?: string | null
          created_at?: string
          employee_id?: string
          hours_worked?: number
          id?: string
          payout_crc?: number | null
          points?: number | null
          session_id?: string
          tip_amount_crc?: number
          tip_amount_usd?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "tip_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_sessions: {
        Row: {
          closed_by: string | null
          created_at: string
          exchange_rate: number
          id: string
          notes: string | null
          opened_by: string
          pool_barra_crc: number
          pool_efectivo_crc: number
          pool_efectivo_usd: number
          pool_pos_crc: number
          pool_pos_usd: number
          session_date: string
          shift_type: string
          status: string
          updated_at: string
        }
        Insert: {
          closed_by?: string | null
          created_at?: string
          exchange_rate?: number
          id?: string
          notes?: string | null
          opened_by: string
          pool_barra_crc?: number
          pool_efectivo_crc?: number
          pool_efectivo_usd?: number
          pool_pos_crc?: number
          pool_pos_usd?: number
          session_date: string
          shift_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          closed_by?: string | null
          created_at?: string
          exchange_rate?: number
          id?: string
          notes?: string | null
          opened_by?: string
          pool_barra_crc?: number
          pool_efectivo_crc?: number
          pool_efectivo_usd?: number
          pool_pos_crc?: number
          pool_pos_usd?: number
          session_date?: string
          shift_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_sessions_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tip_sessions_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_comps: {
        Row: {
          created_at: string | null
          data: Json
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data: Json
          id?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data?: Json
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ventas_dias: {
        Row: {
          data: Json
          file_name: string | null
          id: string
          session_date: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          data: Json
          file_name?: string | null
          id?: string
          session_date: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          data?: Json
          file_name?: string | null
          id?: string
          session_date?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_dias_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_hist: {
        Row: {
          data: Json
          session_date: string
          source: string | null
        }
        Insert: {
          data: Json
          session_date: string
          source?: string | null
        }
        Update: {
          data?: Json
          session_date?: string
          source?: string | null
        }
        Relationships: []
      }
      ventas_metas: {
        Row: {
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      my_turno_stats: { Args: { p_date?: string }; Returns: Json }
      pos_cobrar_check: {
        Args: {
          p_amount_crc: number
          p_change_crc: number
          p_check_id: string
          p_client_op_id: string
          p_closed_by: string
          p_currency: string
          p_exchange_rate_used: number
          p_method: string
          p_note: string
          p_order_id: string
          p_received_crc: number
          p_received_usd: number
          p_tip_crc: number
          p_tip_currency: string
        }
        Returns: Json
      }
      pos_cobrar_orden: {
        Args: {
          p_amount_crc: number
          p_change_crc: number
          p_client_op_id: string
          p_closed_by: string
          p_currency: string
          p_exchange_rate_used: number
          p_method: string
          p_note: string
          p_order_id: string
          p_received_crc: number
          p_received_usd: number
          p_tip_crc: number
          p_tip_currency: string
        }
        Returns: Json
      }
      pos_merge_orden: {
        Args: {
          p_by_name: string
          p_checks: Json
          p_from: string
          p_into: string
        }
        Returns: undefined
      }
      pos_reopen_orden: {
        Args: { p_by: string; p_order_id: string; p_reason: string }
        Returns: undefined
      }
      pos_unmerge_orden: {
        Args: { p_from: string; p_into: string }
        Returns: undefined
      }
      sync_pos_tips_to_pool: {
        Args: { p_date: string; p_session_id: string }
        Returns: Json
      }
      verify_manager: {
        Args: { p_email: string; p_password: string }
        Returns: boolean
      }
    }
    Enums: {
      currency: "CRC" | "USD"
      user_role:
        | "owner"
        | "contador"
        | "manager"
        | "cajero"
        | "salonero"
        | "barman"
        | "barback"
        | "runner"
        | "cocina"
        | "proveedor"
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
      currency: ["CRC", "USD"],
      user_role: [
        "owner",
        "contador",
        "manager",
        "cajero",
        "salonero",
        "barman",
        "barback",
        "runner",
        "cocina",
        "proveedor",
      ],
    },
  },
} as const
