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
      accounting_entries: {
        Row: {
          account_id: string
          amount_crc: number
          client_op_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          entry_date: string
          fx_rate: number
          id: string
          kind: string
          month: number
          note: string | null
          reverses_entry_id: string | null
          source_id: string | null
          source_type: string
          status: string
          year: number
        }
        Insert: {
          account_id: string
          amount_crc: number
          client_op_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_date: string
          fx_rate?: number
          id?: string
          kind: string
          month: number
          note?: string | null
          reverses_entry_id?: string | null
          source_id?: string | null
          source_type: string
          status?: string
          year: number
        }
        Update: {
          account_id?: string
          amount_crc?: number
          client_op_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          entry_date?: string
          fx_rate?: number
          id?: string
          kind?: string
          month?: number
          note?: string | null
          reverses_entry_id?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "accounting_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "finance_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_entries_reverses_entry_id_fkey"
            columns: ["reverses_entry_id"]
            isOneToOne: false
            referencedRelation: "accounting_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_cierres_dia: {
        Row: {
          ajuste_motivo: string | null
          ajuste_tipo: string | null
          close_op_id: string | null
          created_at: string | null
          diferencia_crc: number | null
          ef_real_m_crc: number | null
          ef_real_n_crc: number | null
          id: string
          manager: string
          notas: string | null
          otros_m_crc: number | null
          otros_n_crc: number | null
          primer_conteo_crc: number | null
          primer_conteo_usd: number | null
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
          close_op_id?: string | null
          created_at?: string | null
          diferencia_crc?: number | null
          ef_real_m_crc?: number | null
          ef_real_n_crc?: number | null
          id?: string
          manager?: string
          notas?: string | null
          otros_m_crc?: number | null
          otros_n_crc?: number | null
          primer_conteo_crc?: number | null
          primer_conteo_usd?: number | null
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
          close_op_id?: string | null
          created_at?: string | null
          diferencia_crc?: number | null
          ef_real_m_crc?: number | null
          ef_real_n_crc?: number | null
          id?: string
          manager?: string
          notas?: string | null
          otros_m_crc?: number | null
          otros_n_crc?: number | null
          primer_conteo_crc?: number | null
          primer_conteo_usd?: number | null
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
          classification: string | null
          client_op_id: string | null
          created_at: string
          created_by: string
          currency: Database["public"]["Enums"]["currency"]
          description: string
          employee_name: string | null
          exchange_rate: number | null
          factura_verified_at: string | null
          factura_verified_by: string | null
          id: string
          method: string | null
          movement_type: string
          proveedor_notificado_at: string | null
          session_id: string | null
          shift: string | null
          status: string
          subcategory: string | null
          suggested_classification: string | null
          suggested_confidence: number | null
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
          classification?: string | null
          client_op_id?: string | null
          created_at?: string
          created_by: string
          currency?: Database["public"]["Enums"]["currency"]
          description: string
          employee_name?: string | null
          exchange_rate?: number | null
          factura_verified_at?: string | null
          factura_verified_by?: string | null
          id?: string
          method?: string | null
          movement_type: string
          proveedor_notificado_at?: string | null
          session_id?: string | null
          shift?: string | null
          status?: string
          subcategory?: string | null
          suggested_classification?: string | null
          suggested_confidence?: number | null
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
          classification?: string | null
          client_op_id?: string | null
          created_at?: string
          created_by?: string
          currency?: Database["public"]["Enums"]["currency"]
          description?: string
          employee_name?: string | null
          exchange_rate?: number | null
          factura_verified_at?: string | null
          factura_verified_by?: string | null
          id?: string
          method?: string | null
          movement_type?: string
          proveedor_notificado_at?: string | null
          session_id?: string | null
          shift?: string | null
          status?: string
          subcategory?: string | null
          suggested_classification?: string | null
          suggested_confidence?: number | null
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
            foreignKeyName: "cash_movements_factura_verified_by_fkey"
            columns: ["factura_verified_by"]
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
      cash_movements_pre_migracion_2026_07: {
        Row: {
          account_id: string | null
          amount_crc: number | null
          amount_usd: number | null
          approved_at: string | null
          approved_by: string | null
          attachments: Json | null
          caja_origen: string | null
          classification: string | null
          client_op_id: string | null
          created_at: string | null
          created_by: string | null
          currency: Database["public"]["Enums"]["currency"] | null
          description: string | null
          employee_name: string | null
          exchange_rate: number | null
          factura_verified_at: string | null
          factura_verified_by: string | null
          id: string | null
          method: string | null
          movement_type: string | null
          session_id: string | null
          shift: string | null
          status: string | null
          subcategory: string | null
          suggested_classification: string | null
          suggested_confidence: number | null
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          amount_crc?: number | null
          amount_usd?: number | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json | null
          caja_origen?: string | null
          classification?: string | null
          client_op_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"] | null
          description?: string | null
          employee_name?: string | null
          exchange_rate?: number | null
          factura_verified_at?: string | null
          factura_verified_by?: string | null
          id?: string | null
          method?: string | null
          movement_type?: string | null
          session_id?: string | null
          shift?: string | null
          status?: string | null
          subcategory?: string | null
          suggested_classification?: string | null
          suggested_confidence?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          amount_crc?: number | null
          amount_usd?: number | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json | null
          caja_origen?: string | null
          classification?: string | null
          client_op_id?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency"] | null
          description?: string | null
          employee_name?: string | null
          exchange_rate?: number | null
          factura_verified_at?: string | null
          factura_verified_by?: string | null
          id?: string | null
          method?: string | null
          movement_type?: string | null
          session_id?: string | null
          shift?: string | null
          status?: string | null
          subcategory?: string | null
          suggested_classification?: string | null
          suggested_confidence?: number | null
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      club_alertas: {
        Row: {
          canal: string | null
          creado_en: string
          detalle: Json | null
          enviado_en: string | null
          id: number
          location_id: string
          miembro_id: string | null
          movimiento_id: string | null
          tipo: string
        }
        Insert: {
          canal?: string | null
          creado_en?: string
          detalle?: Json | null
          enviado_en?: string | null
          id?: never
          location_id: string
          miembro_id?: string | null
          movimiento_id?: string | null
          tipo: string
        }
        Update: {
          canal?: string | null
          creado_en?: string
          detalle?: Json | null
          enviado_en?: string | null
          id?: never
          location_id?: string
          miembro_id?: string | null
          movimiento_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_alertas_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_alertas_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_alertas_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: true
            referencedRelation: "club_movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      club_auditoria: {
        Row: {
          accion: string
          actor: string | null
          antes: Json | null
          despues: Json | null
          en: string
          id: number
          objeto_id: string | null
          rol: string | null
          tabla: string
        }
        Insert: {
          accion: string
          actor?: string | null
          antes?: Json | null
          despues?: Json | null
          en?: string
          id?: never
          objeto_id?: string | null
          rol?: string | null
          tabla: string
        }
        Update: {
          accion?: string
          actor?: string | null
          antes?: Json | null
          despues?: Json | null
          en?: string
          id?: never
          objeto_id?: string | null
          rol?: string | null
          tabla?: string
        }
        Relationships: []
      }
      club_canje_intentos: {
        Row: {
          actor: string | null
          en: string
          id: number
          miembro_id: string | null
          motivo: string
        }
        Insert: {
          actor?: string | null
          en?: string
          id?: never
          miembro_id?: string | null
          motivo: string
        }
        Update: {
          actor?: string | null
          en?: string
          id?: never
          miembro_id?: string | null
          motivo?: string
        }
        Relationships: []
      }
      club_codigos_canje: {
        Row: {
          codigo_hash: string
          creado_en: string
          id: string
          invalidado_en: string | null
          location_id: string
          miembro_id: string
          movimiento_id: string | null
          usado_en: string | null
          usado_por: string | null
          vence_en: string
        }
        Insert: {
          codigo_hash: string
          creado_en?: string
          id?: string
          invalidado_en?: string | null
          location_id: string
          miembro_id: string
          movimiento_id?: string | null
          usado_en?: string | null
          usado_por?: string | null
          vence_en: string
        }
        Update: {
          codigo_hash?: string
          creado_en?: string
          id?: string
          invalidado_en?: string | null
          location_id?: string
          miembro_id?: string
          movimiento_id?: string | null
          usado_en?: string | null
          usado_por?: string | null
          vence_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_codigos_canje_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_codigos_canje_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_codigos_canje_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: true
            referencedRelation: "club_movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      club_comparacion_vieja: {
        Row: {
          cargado_en: string
          cargado_por: string | null
          id: number
          location_id: string
          miembro_id: string
          personas: number
          semana: string
        }
        Insert: {
          cargado_en?: string
          cargado_por?: string | null
          id?: never
          location_id: string
          miembro_id: string
          personas: number
          semana: string
        }
        Update: {
          cargado_en?: string
          cargado_por?: string | null
          id?: never
          location_id?: string
          miembro_id?: string
          personas?: number
          semana?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_comparacion_vieja_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_comparacion_vieja_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_config: {
        Row: {
          anfitrion_nuevo_dias: number
          anfitrion_tope_mes_crc: number
          articulos_cero_permitidos: string[]
          aviso_dias: number[]
          aviso_privacidad_version: string
          canje_min: number
          canje_paso: number
          club_activo: boolean
          cortesia_familia: number | null
          cortesia_subclasificacion: number | null
          cortesias_por_visita: number
          created_at: string
          cupon_dias: number
          cupones_max_dia_referente: number
          cupones_max_minuto_local: number
          direccion: string | null
          lc_articulo_codigo: string
          lc_excepciones_desde: string | null
          lc_invitado_codigo: string
          location_id: string
          mapa_url: string | null
          max_creditos_por_visita: number
          nombre: string | null
          personas_por_credito: number
          pm_pausado: boolean
          pm_pct: number
          pos_logins_caja: string[]
          premio_vence_dias: number
          premios_referente_mes: number
          premios_validador_mes: number
          promo_articulo_codigo: string | null
          puente_latencia_min: number
          socio_autoalta_max_dia: number
          socio_autoalta_purga_dias: number
          socio_provisional_dias: number
          socio_visitas_por_dia: number
          socio_visitas_semana_max: number
          socios_por_factura: number
          solo_salon: boolean
          tarjeta_manual_activa: boolean
          tarjeta_manual_tope_dia: number
          turno_corte: string
          updated_at: string
          valor_credito_crc: number
          vencimiento_meses: number
          wallet_apple_activo: boolean
        }
        Insert: {
          anfitrion_nuevo_dias?: number
          anfitrion_tope_mes_crc?: number
          articulos_cero_permitidos?: string[]
          aviso_dias?: number[]
          aviso_privacidad_version?: string
          canje_min?: number
          canje_paso?: number
          club_activo?: boolean
          cortesia_familia?: number | null
          cortesia_subclasificacion?: number | null
          cortesias_por_visita?: number
          created_at?: string
          cupon_dias?: number
          cupones_max_dia_referente?: number
          cupones_max_minuto_local?: number
          direccion?: string | null
          lc_articulo_codigo?: string
          lc_excepciones_desde?: string | null
          lc_invitado_codigo?: string
          location_id: string
          mapa_url?: string | null
          max_creditos_por_visita?: number
          nombre?: string | null
          personas_por_credito?: number
          pm_pausado?: boolean
          pm_pct?: number
          pos_logins_caja?: string[]
          premio_vence_dias?: number
          premios_referente_mes?: number
          premios_validador_mes?: number
          promo_articulo_codigo?: string | null
          puente_latencia_min?: number
          socio_autoalta_max_dia?: number
          socio_autoalta_purga_dias?: number
          socio_provisional_dias?: number
          socio_visitas_por_dia?: number
          socio_visitas_semana_max?: number
          socios_por_factura?: number
          solo_salon?: boolean
          tarjeta_manual_activa?: boolean
          tarjeta_manual_tope_dia?: number
          turno_corte?: string
          updated_at?: string
          valor_credito_crc?: number
          vencimiento_meses?: number
          wallet_apple_activo?: boolean
        }
        Update: {
          anfitrion_nuevo_dias?: number
          anfitrion_tope_mes_crc?: number
          articulos_cero_permitidos?: string[]
          aviso_dias?: number[]
          aviso_privacidad_version?: string
          canje_min?: number
          canje_paso?: number
          club_activo?: boolean
          cortesia_familia?: number | null
          cortesia_subclasificacion?: number | null
          cortesias_por_visita?: number
          created_at?: string
          cupon_dias?: number
          cupones_max_dia_referente?: number
          cupones_max_minuto_local?: number
          direccion?: string | null
          lc_articulo_codigo?: string
          lc_excepciones_desde?: string | null
          lc_invitado_codigo?: string
          location_id?: string
          mapa_url?: string | null
          max_creditos_por_visita?: number
          nombre?: string | null
          personas_por_credito?: number
          pm_pausado?: boolean
          pm_pct?: number
          pos_logins_caja?: string[]
          premio_vence_dias?: number
          premios_referente_mes?: number
          premios_validador_mes?: number
          promo_articulo_codigo?: string | null
          puente_latencia_min?: number
          socio_autoalta_max_dia?: number
          socio_autoalta_purga_dias?: number
          socio_provisional_dias?: number
          socio_visitas_por_dia?: number
          socio_visitas_semana_max?: number
          socios_por_factura?: number
          solo_salon?: boolean
          tarjeta_manual_activa?: boolean
          tarjeta_manual_tope_dia?: number
          turno_corte?: string
          updated_at?: string
          valor_credito_crc?: number
          vencimiento_meses?: number
          wallet_apple_activo?: boolean
        }
        Relationships: []
      }
      club_config_historial: {
        Row: {
          cambiado_en: string
          cambiado_por: string | null
          campo: string
          id: number
          location_id: string
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          cambiado_en?: string
          cambiado_por?: string | null
          campo: string
          id?: never
          location_id: string
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          cambiado_en?: string
          cambiado_por?: string | null
          campo?: string
          id?: never
          location_id?: string
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: []
      }
      club_cortesias: {
        Row: {
          activa: boolean
          actualizada_en: string
          actualizada_por: string | null
          codigo_producto: string
          creada_en: string
          creada_por: string | null
          familia: number | null
          id: string
          location_id: string
          nombre: string
        }
        Insert: {
          activa?: boolean
          actualizada_en?: string
          actualizada_por?: string | null
          codigo_producto: string
          creada_en?: string
          creada_por?: string | null
          familia?: number | null
          id?: string
          location_id: string
          nombre: string
        }
        Update: {
          activa?: boolean
          actualizada_en?: string
          actualizada_por?: string | null
          codigo_producto?: string
          creada_en?: string
          creada_por?: string | null
          familia?: number | null
          id?: string
          location_id?: string
          nombre?: string
        }
        Relationships: []
      }
      club_cruces_manuales: {
        Row: {
          elegido_en: string
          elegido_por: string | null
          location_id: string
          movimiento_id: string
          nota: string | null
          numero_factura: string
        }
        Insert: {
          elegido_en?: string
          elegido_por?: string | null
          location_id: string
          movimiento_id: string
          nota?: string | null
          numero_factura: string
        }
        Update: {
          elegido_en?: string
          elegido_por?: string | null
          location_id?: string
          movimiento_id?: string
          nota?: string | null
          numero_factura?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_cruces_manuales_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: true
            referencedRelation: "club_movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      club_cruces_manuales_historial: {
        Row: {
          elegido_en: string
          elegido_por: string | null
          id: number
          location_id: string
          movimiento_id: string
          nota: string | null
          numero_factura: string
        }
        Insert: {
          elegido_en?: string
          elegido_por?: string | null
          id?: never
          location_id: string
          movimiento_id: string
          nota?: string | null
          numero_factura: string
        }
        Update: {
          elegido_en?: string
          elegido_por?: string | null
          id?: never
          location_id?: string
          movimiento_id?: string
          nota?: string | null
          numero_factura?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_cruces_manuales_historial_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "club_movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      club_cupones: {
        Row: {
          codigo: string
          creado_en: string
          created_at: string
          estado: string
          factura_pos: string | null
          id: string
          location_id: string
          personas: number | null
          pos_ref: Json | null
          referente_id: string
          usado_en: string | null
          usado_por: string | null
          vence_en: string
        }
        Insert: {
          codigo?: string
          creado_en?: string
          created_at?: string
          estado?: string
          factura_pos?: string | null
          id?: string
          location_id: string
          personas?: number | null
          pos_ref?: Json | null
          referente_id: string
          usado_en?: string | null
          usado_por?: string | null
          vence_en: string
        }
        Update: {
          codigo?: string
          creado_en?: string
          created_at?: string
          estado?: string
          factura_pos?: string | null
          id?: string
          location_id?: string
          personas?: number | null
          pos_ref?: Json | null
          referente_id?: string
          usado_en?: string | null
          usado_por?: string | null
          vence_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_cupones_referente_id_fkey"
            columns: ["referente_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_cupones_referente_id_fkey"
            columns: ["referente_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_cupones_contactos: {
        Row: {
          created_at: string
          cupon_id: string
          email: string | null
          nombre: string | null
          optin: boolean
          whatsapp: string | null
        }
        Insert: {
          created_at?: string
          cupon_id: string
          email?: string | null
          nombre?: string | null
          optin?: boolean
          whatsapp?: string | null
        }
        Update: {
          created_at?: string
          cupon_id?: string
          email?: string | null
          nombre?: string | null
          optin?: boolean
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_cupones_contactos_cupon_id_fkey"
            columns: ["cupon_id"]
            isOneToOne: true
            referencedRelation: "club_cupones"
            referencedColumns: ["id"]
          },
        ]
      }
      club_descuentos_tipo: {
        Row: {
          activo: boolean
          actualizado_en: string
          actualizado_por: string | null
          creado_en: string
          creado_por: string | null
          id: string
          location_id: string
          nombre: string
          pct: number
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          actualizado_por?: string | null
          creado_en?: string
          creado_por?: string | null
          id?: string
          location_id: string
          nombre: string
          pct: number
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          actualizado_por?: string | null
          creado_en?: string
          creado_por?: string | null
          id?: string
          location_id?: string
          nombre?: string
          pct?: number
        }
        Relationships: []
      }
      club_entorno: {
        Row: {
          marcado_en: string
          nombre: string
        }
        Insert: {
          marcado_en?: string
          nombre: string
        }
        Update: {
          marcado_en?: string
          nombre?: string
        }
        Relationships: []
      }
      club_excepciones_resueltas: {
        Row: {
          id: number
          location_id: string
          nota: string
          ref: string
          resuelto_en: string
          resuelto_por: string | null
          tipo: string
        }
        Insert: {
          id?: never
          location_id: string
          nota: string
          ref: string
          resuelto_en?: string
          resuelto_por?: string | null
          tipo: string
        }
        Update: {
          id?: never
          location_id?: string
          nota?: string
          ref?: string
          resuelto_en?: string
          resuelto_por?: string | null
          tipo?: string
        }
        Relationships: []
      }
      club_marcadores_descuento: {
        Row: {
          activo: boolean
          actualizado_en: string
          actualizado_por: string | null
          codigo_producto: string
          creado_en: string
          creado_por: string | null
          id: string
          location_id: string
          nombre: string
          pct_esperado: number | null
        }
        Insert: {
          activo?: boolean
          actualizado_en?: string
          actualizado_por?: string | null
          codigo_producto: string
          creado_en?: string
          creado_por?: string | null
          id?: string
          location_id: string
          nombre: string
          pct_esperado?: number | null
        }
        Update: {
          activo?: boolean
          actualizado_en?: string
          actualizado_por?: string | null
          codigo_producto?: string
          creado_en?: string
          creado_por?: string | null
          id?: string
          location_id?: string
          nombre?: string
          pct_esperado?: number | null
        }
        Relationships: []
      }
      club_miembro_roles: {
        Row: {
          actualizado_en: string
          alta_por: string
          aviso_aceptado_en: string | null
          aviso_version: string | null
          confirmado_en: string | null
          confirmado_por: string | null
          desde: string
          estado: string
          miembro_id: string
          provisional_hasta: string | null
          referido_por: string | null
          registrado_por: string | null
          rol: string
          validado_en: string | null
          validado_por: string | null
          verifico_residencia: boolean | null
        }
        Insert: {
          actualizado_en?: string
          alta_por?: string
          aviso_aceptado_en?: string | null
          aviso_version?: string | null
          confirmado_en?: string | null
          confirmado_por?: string | null
          desde?: string
          estado?: string
          miembro_id: string
          provisional_hasta?: string | null
          referido_por?: string | null
          registrado_por?: string | null
          rol: string
          validado_en?: string | null
          validado_por?: string | null
          verifico_residencia?: boolean | null
        }
        Update: {
          actualizado_en?: string
          alta_por?: string
          aviso_aceptado_en?: string | null
          aviso_version?: string | null
          confirmado_en?: string | null
          confirmado_por?: string | null
          desde?: string
          estado?: string
          miembro_id?: string
          provisional_hasta?: string | null
          referido_por?: string | null
          registrado_por?: string | null
          rol?: string
          validado_en?: string | null
          validado_por?: string | null
          verifico_residencia?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "club_miembro_roles_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_miembro_roles_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_miembro_roles_referido_por_fkey"
            columns: ["referido_por"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_miembro_roles_referido_por_fkey"
            columns: ["referido_por"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_miembros: {
        Row: {
          codigo: string
          codigo_socio: string | null
          created_at: string
          estado: string
          id: string
          legacy_id: string | null
          location_id: string
          negocio_id: string | null
          nombre: string
          origen: string
          tipo: string
          token_pase: string | null
          token_portal: string
          updated_at: string
        }
        Insert: {
          codigo?: string
          codigo_socio?: string | null
          created_at?: string
          estado?: string
          id?: string
          legacy_id?: string | null
          location_id: string
          negocio_id?: string | null
          nombre: string
          origen?: string
          tipo: string
          token_pase?: string | null
          token_portal?: string
          updated_at?: string
        }
        Update: {
          codigo?: string
          codigo_socio?: string | null
          created_at?: string
          estado?: string
          id?: string
          legacy_id?: string | null
          location_id?: string
          negocio_id?: string | null
          nombre?: string
          origen?: string
          tipo?: string
          token_pase?: string | null
          token_portal?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_miembros_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "club_negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      club_miembros_contacto: {
        Row: {
          created_at: string
          email: string | null
          location_id: string
          miembro_id: string
          optin_email: boolean
          optin_whatsapp: boolean
          telefono: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          location_id: string
          miembro_id: string
          optin_email?: boolean
          optin_whatsapp?: boolean
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          location_id?: string
          miembro_id?: string
          optin_email?: boolean
          optin_whatsapp?: boolean
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_miembros_contacto_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: true
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_miembros_contacto_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: true
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_movimientos: {
        Row: {
          client_op_id: string | null
          created_at: string
          creditos: number | null
          cupon_id: string | null
          factura_pos: string | null
          fecha_visita: string
          id: string
          legacy_ids: string[] | null
          location_id: string
          miembro_id: string
          nota: string | null
          origen: string
          personas: number
          personas_por_credito: number
          pos_ref: Json | null
          registrado_en: string
          registrado_por: string | null
          tipo: string
          valor_credito_crc: number
          visita_clave: string | null
        }
        Insert: {
          client_op_id?: string | null
          created_at?: string
          creditos?: number | null
          cupon_id?: string | null
          factura_pos?: string | null
          fecha_visita?: string
          id?: string
          legacy_ids?: string[] | null
          location_id: string
          miembro_id: string
          nota?: string | null
          origen?: string
          personas: number
          personas_por_credito: number
          pos_ref?: Json | null
          registrado_en?: string
          registrado_por?: string | null
          tipo: string
          valor_credito_crc: number
          visita_clave?: string | null
        }
        Update: {
          client_op_id?: string | null
          created_at?: string
          creditos?: number | null
          cupon_id?: string | null
          factura_pos?: string | null
          fecha_visita?: string
          id?: string
          legacy_ids?: string[] | null
          location_id?: string
          miembro_id?: string
          nota?: string | null
          origen?: string
          personas?: number
          personas_por_credito?: number
          pos_ref?: Json | null
          registrado_en?: string
          registrado_por?: string | null
          tipo?: string
          valor_credito_crc?: number
          visita_clave?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_movimientos_cupon_id_fkey"
            columns: ["cupon_id"]
            isOneToOne: true
            referencedRelation: "club_cupones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_movimientos_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_movimientos_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_negocios: {
        Row: {
          activo: boolean
          created_at: string
          id: string
          location_id: string
          nombre: string
          origen: string
          tipo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: string
          location_id: string
          nombre: string
          origen?: string
          tipo?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: string
          location_id?: string
          nombre?: string
          origen?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      club_pase_cursor: {
        Row: {
          guardado_en: string
          nombre: string
          ultimo_id: number
        }
        Insert: {
          guardado_en?: string
          nombre: string
          ultimo_id?: number
        }
        Update: {
          guardado_en?: string
          nombre?: string
          ultimo_id?: number
        }
        Relationships: []
      }
      club_pase_eventos: {
        Row: {
          creado_en: string
          id: number
          miembro_id: string | null
          motivo: string
        }
        Insert: {
          creado_en?: string
          id?: never
          miembro_id?: string | null
          motivo: string
        }
        Update: {
          creado_en?: string
          id?: never
          miembro_id?: string | null
          motivo?: string
        }
        Relationships: []
      }
      club_pases: {
        Row: {
          actualizado_en: string
          emitido_en: string
          miembro_id: string
          object_id: string
          plataforma: string
        }
        Insert: {
          actualizado_en?: string
          emitido_en?: string
          miembro_id: string
          object_id: string
          plataforma: string
        }
        Update: {
          actualizado_en?: string
          emitido_en?: string
          miembro_id?: string
          object_id?: string
          plataforma?: string
        }
        Relationships: [
          {
            foreignKeyName: "club_pases_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_pases_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_personas_pendientes: {
        Row: {
          client_op_id: string
          cupon_id: string | null
          estado: string
          factura_pos: string | null
          fecha_visita: string
          ganado_mes_crc: number
          id: string
          location_id: string
          miembro_id: string
          movimiento_id: string | null
          nota: string | null
          personas: number
          personas_por_credito: number
          pos_ref: Json | null
          registrado_por: string | null
          resuelto_en: string | null
          resuelto_por: string | null
          valor_credito_crc: number
          visita_clave: string | null
        }
        Insert: {
          client_op_id: string
          cupon_id?: string | null
          estado?: string
          factura_pos?: string | null
          fecha_visita?: string
          ganado_mes_crc: number
          id?: string
          location_id: string
          miembro_id: string
          movimiento_id?: string | null
          nota?: string | null
          personas: number
          personas_por_credito: number
          pos_ref?: Json | null
          registrado_por?: string | null
          resuelto_en?: string | null
          resuelto_por?: string | null
          valor_credito_crc: number
          visita_clave?: string | null
        }
        Update: {
          client_op_id?: string
          cupon_id?: string | null
          estado?: string
          factura_pos?: string | null
          fecha_visita?: string
          ganado_mes_crc?: number
          id?: string
          location_id?: string
          miembro_id?: string
          movimiento_id?: string | null
          nota?: string | null
          personas?: number
          personas_por_credito?: number
          pos_ref?: Json | null
          registrado_por?: string | null
          resuelto_en?: string | null
          resuelto_por?: string | null
          valor_credito_crc?: number
          visita_clave?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_personas_pendientes_cupon_id_fkey"
            columns: ["cupon_id"]
            isOneToOne: false
            referencedRelation: "club_cupones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_personas_pendientes_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_personas_pendientes_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_personas_pendientes_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "club_movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      club_pm_cargos: {
        Row: {
          anulado_en: string | null
          cash_movement_id: string | null
          created_at: string
          estado: string
          factura_pos: string | null
          id: string
          legacy_ids: string[] | null
          location_id: string
          miembro_id: string
          monto_crc: number
          origen: string
          pagado_en: string | null
          pago_id: string | null
          pct: number | null
          subtotal_crc: number | null
        }
        Insert: {
          anulado_en?: string | null
          cash_movement_id?: string | null
          created_at?: string
          estado?: string
          factura_pos?: string | null
          id?: string
          legacy_ids?: string[] | null
          location_id: string
          miembro_id: string
          monto_crc: number
          origen?: string
          pagado_en?: string | null
          pago_id?: string | null
          pct?: number | null
          subtotal_crc?: number | null
        }
        Update: {
          anulado_en?: string | null
          cash_movement_id?: string | null
          created_at?: string
          estado?: string
          factura_pos?: string | null
          id?: string
          legacy_ids?: string[] | null
          location_id?: string
          miembro_id?: string
          monto_crc?: number
          origen?: string
          pagado_en?: string | null
          pago_id?: string | null
          pct?: number | null
          subtotal_crc?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "club_pm_cargos_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_pm_cargos_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_pm_cargos_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "club_pm_pagos"
            referencedColumns: ["id"]
          },
        ]
      }
      club_pm_pagos: {
        Row: {
          cash_movement_id: string | null
          created_at: string
          id: string
          legacy_ids: string[] | null
          location_id: string
          miembro_id: string
          monto_crc: number
          nota: string | null
          origen: string
          pagado_en: string
          registrado_por: string | null
        }
        Insert: {
          cash_movement_id?: string | null
          created_at?: string
          id?: string
          legacy_ids?: string[] | null
          location_id: string
          miembro_id: string
          monto_crc: number
          nota?: string | null
          origen?: string
          pagado_en?: string
          registrado_por?: string | null
        }
        Update: {
          cash_movement_id?: string | null
          created_at?: string
          id?: string
          legacy_ids?: string[] | null
          location_id?: string
          miembro_id?: string
          monto_crc?: number
          nota?: string | null
          origen?: string
          pagado_en?: string
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_pm_pagos_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_pm_pagos_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_premios: {
        Row: {
          beneficiario: string
          creado_en: string
          estado: string
          id: string
          location_id: string
          motivo: string | null
          referido: string
          ticket_id: string | null
          usado_en: string | null
          vence_en: string | null
          visita_id: string | null
        }
        Insert: {
          beneficiario: string
          creado_en?: string
          estado: string
          id?: string
          location_id: string
          motivo?: string | null
          referido: string
          ticket_id?: string | null
          usado_en?: string | null
          vence_en?: string | null
          visita_id?: string | null
        }
        Update: {
          beneficiario?: string
          creado_en?: string
          estado?: string
          id?: string
          location_id?: string
          motivo?: string | null
          referido?: string
          ticket_id?: string | null
          usado_en?: string | null
          vence_en?: string | null
          visita_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_premios_beneficiario_fkey"
            columns: ["beneficiario"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_premios_beneficiario_fkey"
            columns: ["beneficiario"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_premios_referido_fkey"
            columns: ["referido"]
            isOneToOne: true
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_premios_referido_fkey"
            columns: ["referido"]
            isOneToOne: true
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_premios_visita_id_fkey"
            columns: ["visita_id"]
            isOneToOne: false
            referencedRelation: "club_visitas_socio"
            referencedColumns: ["id"]
          },
        ]
      }
      club_promociones: {
        Row: {
          actualizada_en: string
          actualizada_por: string | null
          cortesias: number
          creada_en: string
          creada_por: string | null
          desde: string | null
          dias: number[]
          estado: string
          hasta: string | null
          hora_desde: string | null
          hora_hasta: string | null
          id: string
          location_id: string
          nombre: string
          nombre_en: string | null
          para: string[]
          porcentaje: number
        }
        Insert: {
          actualizada_en?: string
          actualizada_por?: string | null
          cortesias?: number
          creada_en?: string
          creada_por?: string | null
          desde?: string | null
          dias?: number[]
          estado?: string
          hasta?: string | null
          hora_desde?: string | null
          hora_hasta?: string | null
          id?: string
          location_id: string
          nombre: string
          nombre_en?: string | null
          para: string[]
          porcentaje?: number
        }
        Update: {
          actualizada_en?: string
          actualizada_por?: string | null
          cortesias?: number
          creada_en?: string
          creada_por?: string | null
          desde?: string | null
          dias?: number[]
          estado?: string
          hasta?: string | null
          hora_desde?: string | null
          hora_hasta?: string | null
          id?: string
          location_id?: string
          nombre?: string
          nombre_en?: string | null
          para?: string[]
          porcentaje?: number
        }
        Relationships: []
      }
      club_reportes_cerrados: {
        Row: {
          cerrado_en: string
          cerrado_por: string | null
          datos: Json
          id: number
          location_id: string
          mes: string
          motivo: string | null
          sha256: string
          sha256_prev: string | null
          version: number
        }
        Insert: {
          cerrado_en?: string
          cerrado_por?: string | null
          datos: Json
          id?: never
          location_id: string
          mes: string
          motivo?: string | null
          sha256: string
          sha256_prev?: string | null
          version: number
        }
        Update: {
          cerrado_en?: string
          cerrado_por?: string | null
          datos?: Json
          id?: never
          location_id?: string
          mes?: string
          motivo?: string | null
          sha256?: string
          sha256_prev?: string | null
          version?: number
        }
        Relationships: []
      }
      club_socio_solicitudes: {
        Row: {
          atendida_en: string | null
          atendida_por: string | null
          aviso_version: string | null
          creada_en: string
          id: number
          location_id: string
          miembro_id: string
          referido_por: string | null
        }
        Insert: {
          atendida_en?: string | null
          atendida_por?: string | null
          aviso_version?: string | null
          creada_en?: string
          id?: never
          location_id: string
          miembro_id: string
          referido_por?: string | null
        }
        Update: {
          atendida_en?: string | null
          atendida_por?: string | null
          aviso_version?: string | null
          creada_en?: string
          id?: never
          location_id?: string
          miembro_id?: string
          referido_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_socio_solicitudes_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_socio_solicitudes_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_socio_solicitudes_referido_por_fkey"
            columns: ["referido_por"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_socio_solicitudes_referido_por_fkey"
            columns: ["referido_por"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_visitas: {
        Row: {
          created_at: string
          factura_pos: string | null
          fecha: string
          id: string
          location_id: string
          miembro_id: string
          monto_neto: number | null
          origen: string
          personas: number | null
          platos: Json | null
          registrado_por: string | null
        }
        Insert: {
          created_at?: string
          factura_pos?: string | null
          fecha?: string
          id?: string
          location_id: string
          miembro_id: string
          monto_neto?: number | null
          origen?: string
          personas?: number | null
          platos?: Json | null
          registrado_por?: string | null
        }
        Update: {
          created_at?: string
          factura_pos?: string | null
          fecha?: string
          id?: string
          location_id?: string
          miembro_id?: string
          monto_neto?: number | null
          origen?: string
          personas?: number | null
          platos?: Json | null
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_visitas_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_visitas_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
        ]
      }
      club_visitas_socio: {
        Row: {
          aplicar: Json
          client_op_id: string
          con_canje: boolean
          cortesias: Json
          estado_beneficio: string
          fecha: string
          id: string
          location_id: string
          miembro_id: string
          porcentaje: number
          pos_ref: Json | null
          promo_id: string | null
          registrada_en: string
          registrado_por: string | null
          visita_clave: string | null
        }
        Insert: {
          aplicar: Json
          client_op_id: string
          con_canje?: boolean
          cortesias?: Json
          estado_beneficio: string
          fecha: string
          id?: string
          location_id: string
          miembro_id: string
          porcentaje?: number
          pos_ref?: Json | null
          promo_id?: string | null
          registrada_en?: string
          registrado_por?: string | null
          visita_clave?: string | null
        }
        Update: {
          aplicar?: Json
          client_op_id?: string
          con_canje?: boolean
          cortesias?: Json
          estado_beneficio?: string
          fecha?: string
          id?: string
          location_id?: string
          miembro_id?: string
          porcentaje?: number
          pos_ref?: Json | null
          promo_id?: string | null
          registrada_en?: string
          registrado_por?: string | null
          visita_clave?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "club_visitas_socio_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_miembros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "club_visitas_socio_miembro_id_fkey"
            columns: ["miembro_id"]
            isOneToOne: false
            referencedRelation: "club_saldos"
            referencedColumns: ["miembro_id"]
          },
          {
            foreignKeyName: "club_visitas_socio_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "club_promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      club_web_clave: {
        Row: {
          creada_en: string
          id: number
          revocada_en: string | null
          sha256: string
        }
        Insert: {
          creada_en?: string
          id?: never
          revocada_en?: string | null
          sha256: string
        }
        Update: {
          creada_en?: string
          id?: never
          revocada_en?: string | null
          sha256?: string
        }
        Relationships: []
      }
      credit_applications: {
        Row: {
          amount_applied: number
          applied_at: string
          applied_by: string | null
          applied_to_movement_id: string | null
          client_op_id: string | null
          credit_id: string
          currency: string
          id: string
          reversed: boolean
        }
        Insert: {
          amount_applied: number
          applied_at?: string
          applied_by?: string | null
          applied_to_movement_id?: string | null
          client_op_id?: string | null
          credit_id: string
          currency?: string
          id?: string
          reversed?: boolean
        }
        Update: {
          amount_applied?: number
          applied_at?: string
          applied_by?: string | null
          applied_to_movement_id?: string | null
          client_op_id?: string | null
          credit_id?: string
          currency?: string
          id?: string
          reversed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "credit_applications_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_applications_applied_to_movement_id_fkey"
            columns: ["applied_to_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_applications_credit_id_fkey"
            columns: ["credit_id"]
            isOneToOne: false
            referencedRelation: "supplier_credits"
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
      employee_payments: {
        Row: {
          comprobante_url: string | null
          created_at: string
          employee_id: string
          estado: string
          id: string
          metodo: string
          monto_neto: number
          paid_at: string | null
          paid_by: string | null
          period_id: string
          referencia: string | null
          updated_at: string
        }
        Insert: {
          comprobante_url?: string | null
          created_at?: string
          employee_id: string
          estado?: string
          id?: string
          metodo?: string
          monto_neto: number
          paid_at?: string | null
          paid_by?: string | null
          period_id: string
          referencia?: string | null
          updated_at?: string
        }
        Update: {
          comprobante_url?: string | null
          created_at?: string
          employee_id?: string
          estado?: string
          id?: string
          metodo?: string
          monto_neto?: number
          paid_at?: string | null
          paid_by?: string | null
          period_id?: string
          referencia?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_payments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_payments_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "salary_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_payroll: {
        Row: {
          banco: string | null
          created_at: string
          cuenta_iban_alias: string | null
          employee_id: string
          fixed_salary_crc: number
          hourly_rate_crc: number
          nombre_homebanking: string | null
          updated_at: string
        }
        Insert: {
          banco?: string | null
          created_at?: string
          cuenta_iban_alias?: string | null
          employee_id: string
          fixed_salary_crc?: number
          hourly_rate_crc?: number
          nombre_homebanking?: string | null
          updated_at?: string
        }
        Update: {
          banco?: string | null
          created_at?: string
          cuenta_iban_alias?: string | null
          employee_id?: string
          fixed_salary_crc?: number
          hourly_rate_crc?: number
          nombre_homebanking?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_payroll_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_wage_rates: {
        Row: {
          created_at: string
          created_by: string | null
          efectivo_desde: string
          employee_id: string
          fixed_salary_crc: number
          hourly_rate_crc: number
          id: string
          nota: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          efectivo_desde: string
          employee_id: string
          fixed_salary_crc?: number
          hourly_rate_crc?: number
          id?: string
          nota?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          efectivo_desde?: string
          employee_id?: string
          fixed_salary_crc?: number
          hourly_rate_crc?: number
          id?: string
          nota?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_wage_rates_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          banco: string | null
          biotime_emp_code: string | null
          created_at: string
          cuenta_iban_alias: string | null
          fecha_ingreso: string | null
          fixed_salary_crc: number
          full_name: string
          hora_entrada_habitual: string | null
          hora_salida_habitual: string | null
          hourly_rate_crc: number
          id: string
          is_active: boolean
          nombre_homebanking: string | null
          participa_servicio: boolean
          pos_login: string | null
          pos_name: string | null
          profile_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          banco?: string | null
          biotime_emp_code?: string | null
          created_at?: string
          cuenta_iban_alias?: string | null
          fecha_ingreso?: string | null
          fixed_salary_crc?: number
          full_name: string
          hora_entrada_habitual?: string | null
          hora_salida_habitual?: string | null
          hourly_rate_crc?: number
          id?: string
          is_active?: boolean
          nombre_homebanking?: string | null
          participa_servicio?: boolean
          pos_login?: string | null
          pos_name?: string | null
          profile_id?: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          banco?: string | null
          biotime_emp_code?: string | null
          created_at?: string
          cuenta_iban_alias?: string | null
          fecha_ingreso?: string | null
          fixed_salary_crc?: number
          full_name?: string
          hora_entrada_habitual?: string | null
          hora_salida_habitual?: string | null
          hourly_rate_crc?: number
          id?: string
          is_active?: boolean
          nombre_homebanking?: string | null
          participa_servicio?: boolean
          pos_login?: string | null
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
      inventory_review_task: {
        Row: {
          amount_crc: number | null
          cash_movement_id: string | null
          claimed_at: string | null
          claimed_by: string | null
          classification: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          currency: string
          discard_reason: string | null
          discarded_at: string | null
          discarded_by: string | null
          document_id: string | null
          entry_date: string | null
          fx_rate: number
          id: string
          status: string
          suggested_classification: string | null
          suggested_confidence: number | null
          supplier_id: string | null
        }
        Insert: {
          amount_crc?: number | null
          cash_movement_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          classification?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          document_id?: string | null
          entry_date?: string | null
          fx_rate?: number
          id?: string
          status?: string
          suggested_classification?: string | null
          suggested_confidence?: number | null
          supplier_id?: string | null
        }
        Update: {
          amount_crc?: number | null
          cash_movement_id?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          classification?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          document_id?: string | null
          entry_date?: string | null
          fx_rate?: number
          id?: string
          status?: string
          suggested_classification?: string | null
          suggested_confidence?: number | null
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_review_task_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_review_task_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_review_task_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_review_task_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_review_task_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_review_task_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_review_task_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      movement_deletions: {
        Row: {
          authorized_by: string | null
          credit_applications_snapshot: Json | null
          deleted_at: string
          deleted_by: string | null
          id: string
          inventory_snapshot: Json | null
          movement_snapshot: Json
          note: string
        }
        Insert: {
          authorized_by?: string | null
          credit_applications_snapshot?: Json | null
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          inventory_snapshot?: Json | null
          movement_snapshot: Json
          note: string
        }
        Update: {
          authorized_by?: string | null
          credit_applications_snapshot?: Json | null
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          inventory_snapshot?: Json | null
          movement_snapshot?: Json
          note?: string
        }
        Relationships: [
          {
            foreignKeyName: "movement_deletions_authorized_by_fkey"
            columns: ["authorized_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movement_deletions_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      movement_edits: {
        Row: {
          after: Json
          before: Json
          changed: Json
          edited_at: string
          edited_by: string | null
          id: string
          movement_id: string
        }
        Insert: {
          after: Json
          before: Json
          changed: Json
          edited_at?: string
          edited_by?: string | null
          id?: string
          movement_id: string
        }
        Update: {
          after?: Json
          before?: Json
          changed?: Json
          edited_at?: string
          edited_by?: string | null
          id?: string
          movement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "movement_edits_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_config: {
        Row: {
          corte_jornada: string
          created_at: string
          local: string
          umbral_turno_largo_h: number
          updated_at: string
        }
        Insert: {
          corte_jornada?: string
          created_at?: string
          local: string
          umbral_turno_largo_h?: number
          updated_at?: string
        }
        Update: {
          corte_jornada?: string
          created_at?: string
          local?: string
          umbral_turno_largo_h?: number
          updated_at?: string
        }
        Relationships: []
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
      pos_ndf_cursor: {
        Row: {
          last_error: string | null
          last_factura: string | null
          last_fecha_registra: string | null
          last_poll_at: string | null
          local: string
        }
        Insert: {
          last_error?: string | null
          last_factura?: string | null
          last_fecha_registra?: string | null
          last_poll_at?: string | null
          local: string
        }
        Update: {
          last_error?: string | null
          last_factura?: string | null
          last_fecha_registra?: string | null
          last_poll_at?: string | null
          local?: string
        }
        Relationships: []
      }
      pos_ndf_open: {
        Row: {
          area: string | null
          canal: string | null
          clave: string
          detalle_productos: Json | null
          id: string
          id_pedido: string | null
          items_valor: number | null
          local: string
          mesa: string | null
          monto_estimado_crc: number | null
          numero_factura: string | null
          pax: number | null
          pax_alerta: string | null
          pax_pedido: number | null
          pedido_abierto_en: string | null
          salonero_login: string | null
          updated_at: string
        }
        Insert: {
          area?: string | null
          canal?: string | null
          clave: string
          detalle_productos?: Json | null
          id?: string
          id_pedido?: string | null
          items_valor?: number | null
          local: string
          mesa?: string | null
          monto_estimado_crc?: number | null
          numero_factura?: string | null
          pax?: number | null
          pax_alerta?: string | null
          pax_pedido?: number | null
          pedido_abierto_en?: string | null
          salonero_login?: string | null
          updated_at: string
        }
        Update: {
          area?: string | null
          canal?: string | null
          clave?: string
          detalle_productos?: Json | null
          id?: string
          id_pedido?: string | null
          items_valor?: number | null
          local?: string
          mesa?: string | null
          monto_estimado_crc?: number | null
          numero_factura?: string | null
          pax?: number | null
          pax_alerta?: string | null
          pax_pedido?: number | null
          pedido_abierto_en?: string | null
          salonero_login?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pos_ndf_ticket_lines: {
        Row: {
          cantidad: number | null
          codigo_producto: string | null
          es_cortesia: boolean | null
          es_extra: boolean | null
          es_pax: boolean | null
          familia: number | null
          id: string
          monto: number | null
          nombre: string | null
          precio: number | null
          ticket_id: string
          usuario_registra: string | null
        }
        Insert: {
          cantidad?: number | null
          codigo_producto?: string | null
          es_cortesia?: boolean | null
          es_extra?: boolean | null
          es_pax?: boolean | null
          familia?: number | null
          id?: string
          monto?: number | null
          nombre?: string | null
          precio?: number | null
          ticket_id: string
          usuario_registra?: string | null
        }
        Update: {
          cantidad?: number | null
          codigo_producto?: string | null
          es_cortesia?: boolean | null
          es_extra?: boolean | null
          es_pax?: boolean | null
          familia?: number | null
          id?: string
          monto?: number | null
          nombre?: string | null
          precio?: number | null
          ticket_id?: string
          usuario_registra?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_ndf_ticket_lines_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "pos_ndf_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_ndf_tickets: {
        Row: {
          area: string | null
          area_factura: string | null
          cajero_login: string | null
          canal: string
          cheque_crc: number | null
          clase_ingreso: string | null
          clave_fe: string | null
          con_servicio: boolean
          consecutivo_fe: string | null
          cxc_crc: number | null
          deposito_crc: number | null
          descuento_crc: number | null
          dolares_efectivo: number | null
          dolares_tarjeta: number | null
          efectivo_crc: number | null
          electronico_crc: number | null
          estado: string
          fecha_cierra: string | null
          fecha_registra: string
          id: string
          ingested_at: string
          iva_crc: number | null
          local: string
          mesa: string | null
          mesa_factura: string | null
          numero_factura: string
          numero_pedido: string | null
          pax: number
          pax_alerta: string
          pax_articulo: number
          pax_nativo: number
          pedido_abierto_en: string | null
          regalia_crc: number | null
          registrado_por: string
          salonero_login: string | null
          servicio_crc: number | null
          tarjeta_crc: number | null
          tipo: string | null
          total_crc: number | null
          total_fuente: string
          turno: string | null
          valor_servido_crc: number | null
          vuelto_crc: number | null
        }
        Insert: {
          area?: string | null
          area_factura?: string | null
          cajero_login?: string | null
          canal: string
          cheque_crc?: number | null
          clase_ingreso?: string | null
          clave_fe?: string | null
          con_servicio: boolean
          consecutivo_fe?: string | null
          cxc_crc?: number | null
          deposito_crc?: number | null
          descuento_crc?: number | null
          dolares_efectivo?: number | null
          dolares_tarjeta?: number | null
          efectivo_crc?: number | null
          electronico_crc?: number | null
          estado: string
          fecha_cierra?: string | null
          fecha_registra: string
          id?: string
          ingested_at?: string
          iva_crc?: number | null
          local?: string
          mesa?: string | null
          mesa_factura?: string | null
          numero_factura: string
          numero_pedido?: string | null
          pax?: number
          pax_alerta: string
          pax_articulo?: number
          pax_nativo?: number
          pedido_abierto_en?: string | null
          regalia_crc?: number | null
          registrado_por: string
          salonero_login?: string | null
          servicio_crc?: number | null
          tarjeta_crc?: number | null
          tipo?: string | null
          total_crc?: number | null
          total_fuente?: string
          turno?: string | null
          valor_servido_crc?: number | null
          vuelto_crc?: number | null
        }
        Update: {
          area?: string | null
          area_factura?: string | null
          cajero_login?: string | null
          canal?: string
          cheque_crc?: number | null
          clase_ingreso?: string | null
          clave_fe?: string | null
          con_servicio?: boolean
          consecutivo_fe?: string | null
          cxc_crc?: number | null
          deposito_crc?: number | null
          descuento_crc?: number | null
          dolares_efectivo?: number | null
          dolares_tarjeta?: number | null
          efectivo_crc?: number | null
          electronico_crc?: number | null
          estado?: string
          fecha_cierra?: string | null
          fecha_registra?: string
          id?: string
          ingested_at?: string
          iva_crc?: number | null
          local?: string
          mesa?: string | null
          mesa_factura?: string | null
          numero_factura?: string
          numero_pedido?: string | null
          pax?: number
          pax_alerta?: string
          pax_articulo?: number
          pax_nativo?: number
          pedido_abierto_en?: string | null
          regalia_crc?: number | null
          registrado_por?: string
          salonero_login?: string | null
          servicio_crc?: number | null
          tarjeta_crc?: number | null
          tipo?: string | null
          total_crc?: number | null
          total_fuente?: string
          turno?: string | null
          valor_servido_crc?: number | null
          vuelto_crc?: number | null
        }
        Relationships: []
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
      punch_exceptions: {
        Row: {
          created_at: string
          detalle: Json | null
          emp_code: string | null
          employee_id: string | null
          estado: string
          id: string
          local: string | null
          resuelto_at: string | null
          resuelto_by: string | null
          tipo: string
          updated_at: string
          work_date: string | null
        }
        Insert: {
          created_at?: string
          detalle?: Json | null
          emp_code?: string | null
          employee_id?: string | null
          estado?: string
          id?: string
          local?: string | null
          resuelto_at?: string | null
          resuelto_by?: string | null
          tipo: string
          updated_at?: string
          work_date?: string | null
        }
        Update: {
          created_at?: string
          detalle?: Json | null
          emp_code?: string | null
          employee_id?: string | null
          estado?: string
          id?: string
          local?: string | null
          resuelto_at?: string | null
          resuelto_by?: string | null
          tipo?: string
          updated_at?: string
          work_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "punch_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
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
          recibe_propina: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          points: number
          recibe_propina?: boolean
          role: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          points?: number
          recibe_propina?: boolean
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: []
      }
      salary_lines: {
        Row: {
          aporte_servicio: number
          bono: number
          created_at: string
          employee_id: string
          horas: number
          id: string
          pago_horas: number
          period_id: string
          salario_fijo: number
          snapshot: Json | null
          total: number
          updated_at: string
        }
        Insert: {
          aporte_servicio?: number
          bono?: number
          created_at?: string
          employee_id: string
          horas?: number
          id?: string
          pago_horas?: number
          period_id: string
          salario_fijo?: number
          snapshot?: Json | null
          total?: number
          updated_at?: string
        }
        Update: {
          aporte_servicio?: number
          bono?: number
          created_at?: string
          employee_id?: string
          horas?: number
          id?: string
          pago_horas?: number
          period_id?: string
          salario_fijo?: number
          snapshot?: Json | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_lines_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "salary_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_periods: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string | null
          estado: string
          fecha_fin: string
          fecha_ini: string
          id: string
          local: string | null
          paid_at: string | null
          paid_by: string | null
          reopen_motivo: string | null
          reopened_at: string | null
          reopened_by: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_fin: string
          fecha_ini: string
          id?: string
          local?: string | null
          paid_at?: string | null
          paid_by?: string | null
          reopen_motivo?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          fecha_fin?: string
          fecha_ini?: string
          id?: string
          local?: string | null
          paid_at?: string | null
          paid_by?: string | null
          reopen_motivo?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          tipo?: string
          updated_at?: string
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
          area: string | null
          category: string
          code: string | null
          content: string
          created_at: string | null
          created_by: string | null
          display_order: number | null
          doc_type: string | null
          employee_book: boolean
          id: string
          is_active: boolean | null
          pdf_path: string | null
          title: string
          updated_at: string | null
          version: string | null
        }
        Insert: {
          area?: string | null
          category?: string
          code?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          display_order?: number | null
          doc_type?: string | null
          employee_book?: boolean
          id?: string
          is_active?: boolean | null
          pdf_path?: string | null
          title: string
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          area?: string | null
          category?: string
          code?: string | null
          content?: string
          created_at?: string | null
          created_by?: string | null
          display_order?: number | null
          doc_type?: string | null
          employee_book?: boolean
          id?: string
          is_active?: boolean | null
          pdf_path?: string | null
          title?: string
          updated_at?: string | null
          version?: string | null
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
      supplier_credits: {
        Row: {
          amount_crc: number
          amount_usd: number
          client_op_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          document_id: string | null
          fecha_origen: string | null
          id: string
          motivo: string | null
          origin: string
          referencia: string | null
          source_movement_id: string | null
          supplier_id: string
        }
        Insert: {
          amount_crc: number
          amount_usd?: number
          client_op_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_id?: string | null
          fecha_origen?: string | null
          id?: string
          motivo?: string | null
          origin: string
          referencia?: string | null
          source_movement_id?: string | null
          supplier_id: string
        }
        Update: {
          amount_crc?: number
          amount_usd?: number
          client_op_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_id?: string | null
          fecha_origen?: string | null
          id?: string
          motivo?: string | null
          origin?: string
          referencia?: string | null
          source_movement_id?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_credits_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credits_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credits_source_movement_id_fkey"
            columns: ["source_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_credits_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
          email: string | null
          id: string
          is_active: boolean
          metodo_pago: string | null
          moneda: string | null
          name: string
          notificar_pago: string
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          aliases?: string[] | null
          category?: string | null
          ciclo_pago?: string | null
          contact?: string | null
          created_at?: string
          cuenta_iban?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          metodo_pago?: string | null
          moneda?: string | null
          name: string
          notificar_pago?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          aliases?: string[] | null
          category?: string | null
          ciclo_pago?: string | null
          contact?: string | null
          created_at?: string
          cuenta_iban?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          metodo_pago?: string | null
          moneda?: string | null
          name?: string
          notificar_pago?: string
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      suppliers_pre_migracion_2026_07: {
        Row: {
          aliases: string[] | null
          category: string | null
          ciclo_pago: string | null
          contact: string | null
          created_at: string | null
          cuenta_iban: string | null
          id: string | null
          is_active: boolean | null
          metodo_pago: string | null
          moneda: string | null
          name: string | null
          updated_at: string | null
        }
        Insert: {
          aliases?: string[] | null
          category?: string | null
          ciclo_pago?: string | null
          contact?: string | null
          created_at?: string | null
          cuenta_iban?: string | null
          id?: string | null
          is_active?: boolean | null
          metodo_pago?: string | null
          moneda?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          aliases?: string[] | null
          category?: string | null
          ciclo_pago?: string | null
          contact?: string | null
          created_at?: string | null
          cuenta_iban?: string | null
          id?: string | null
          is_active?: boolean | null
          metodo_pago?: string | null
          moneda?: string | null
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      time_punches: {
        Row: {
          biotime_id: number
          created_at: string
          emp_code: string
          employee_id: string | null
          id: string
          local: string
          punch_at: string
          punch_state: string
          raw: Json | null
          synced_at: string
          terminal: string | null
          updated_at: string
        }
        Insert: {
          biotime_id: number
          created_at?: string
          emp_code: string
          employee_id?: string | null
          id?: string
          local: string
          punch_at: string
          punch_state: string
          raw?: Json | null
          synced_at?: string
          terminal?: string | null
          updated_at?: string
        }
        Update: {
          biotime_id?: number
          created_at?: string
          emp_code?: string
          employee_id?: string | null
          id?: string
          local?: string
          punch_at?: string
          punch_state?: string
          raw?: Json | null
          synced_at?: string
          terminal?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_punches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
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
          pool_barra_electronico_crc: number
          pool_efectivo_crc: number
          pool_efectivo_usd: number
          pool_pos_crc: number
          pool_pos_usd: number
          pool_total_crc: number | null
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
          pool_barra_electronico_crc?: number
          pool_efectivo_crc?: number
          pool_efectivo_usd?: number
          pool_pos_crc?: number
          pool_pos_usd?: number
          pool_total_crc?: number | null
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
          pool_barra_electronico_crc?: number
          pool_efectivo_crc?: number
          pool_efectivo_usd?: number
          pool_pos_crc?: number
          pool_pos_usd?: number
          pool_total_crc?: number | null
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
      work_days: {
        Row: {
          created_at: string
          employee_id: string
          es_feriado: boolean
          flags: Json | null
          hours: number
          local: string
          source: string
          updated_at: string
          work_date: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          es_feriado?: boolean
          flags?: Json | null
          hours?: number
          local?: string
          source?: string
          updated_at?: string
          work_date: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          es_feriado?: boolean
          flags?: Json | null
          hours?: number
          local?: string
          source?: string
          updated_at?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_days_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      club_saldos: {
        Row: {
          creditos: number | null
          estado: string | null
          location_id: string | null
          miembro_id: string | null
          nombre: string | null
          personas: number | null
          personas_proximo_credito: number | null
          tipo: string | null
          ultima_actividad: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_supplier_credit: {
        Args: {
          p_amount: number
          p_client_op_id: string
          p_credit_id: string
          p_movement_id: string
        }
        Returns: string
      }
      cerrar_dia_completo: {
        Args: {
          p_ajuste: Json
          p_cierre: Json
          p_client_op_id: string
          p_exchange_rate: number
          p_fecha: string
          p_retiro_crc: number
          p_ventas: Json
        }
        Returns: Json
      }
      cierre_ajuste_op_id: {
        Args: { p_fecha: string; p_moneda: string }
        Returns: string
      }
      club_ajuste: {
        Args: {
          p_miembro: string
          p_nota: string
          p_op: string
          p_personas: number
          p_tipo: string
        }
        Returns: {
          creditos: number
          personas: number
        }[]
      }
      club_alerta_enviada: {
        Args: { p_canal: string; p_id: number }
        Returns: undefined
      }
      club_alertas_pendientes: {
        Args: { p_limite?: number }
        Returns: {
          creditos: number
          fecha: string
          id: number
          miembro_id: string
          saldo_creditos: number
          tipo: string
        }[]
      }
      club_auditar: {
        Args: {
          p_accion: string
          p_antes: Json
          p_despues: Json
          p_objeto: string
          p_tabla: string
        }
        Returns: undefined
      }
      club_buscar: {
        Args: { p_q: string }
        Returns: {
          creditos: number
          estado: string
          id: string
          negocio: string
          nombre: string
          personas: number
          tipo: string
        }[]
      }
      club_canje: {
        Args: {
          p_codigo_canje: string
          p_creditos: number
          p_factura: string
          p_miembro: string
          p_op: string
          p_pos?: Json
        }
        Returns: {
          creditos: number
          error: string
          movimiento: string
          personas: number
        }[]
      }
      club_canje_aplicar: {
        Args: {
          p_codigo: string
          p_creditos: number
          p_factura: string
          p_miembro: string
          p_nota: string
          p_op: string
          p_pos: Json
        }
        Returns: {
          creditos: number
          error: string
          movimiento: string
          personas: number
        }[]
      }
      club_canje_aprobado: {
        Args: {
          p_creditos: number
          p_factura: string
          p_miembro: string
          p_nota: string
          p_op: string
          p_pos: Json
        }
        Returns: {
          creditos: number
          error: string
          movimiento: string
          personas: number
        }[]
      }
      club_canje_aviso: { Args: { p_movimiento: string }; Returns: Json }
      club_canje_bloqueado: {
        Args: { p_actor: string; p_miembro: string }
        Returns: boolean
      }
      club_canje_codigo_generar: {
        Args: { p_token: string }
        Returns: {
          codigo: string
          url: string
          vence_en: string
        }[]
      }
      club_canje_codigo_generar_pase: {
        Args: { p_token_pase: string }
        Returns: {
          codigo: string
          url: string
          vence_en: string
        }[]
      }
      club_codigo_hash: { Args: { p: string }; Returns: string }
      club_codigo_socio_nuevo: { Args: never; Returns: string }
      club_comparacion: {
        Args: { p_desde: string; p_hasta: string; p_location?: string }
        Returns: {
          diferencia: number
          miembro_id: string
          negocio: string
          personas_staging: number
          personas_vieja: number
          referente: string
          semana: string
        }[]
      }
      club_comparacion_cargar: {
        Args: { p_filas: Json; p_location?: string }
        Returns: Json
      }
      club_cortesia_guardar: {
        Args: {
          p_activa: boolean
          p_codigo: string
          p_id: string
          p_location?: string
          p_nombre: string
        }
        Returns: string
      }
      club_cortesias_listar: {
        Args: { p_location?: string }
        Returns: {
          activa: boolean
          actualizada_en: string
          codigo_producto: string
          en_seccion: boolean
          familia: number
          id: string
          nombre: string
          visto_en_facturas: boolean
        }[]
      }
      club_creditos: {
        Args: { p_personas: number; p_ppc: number }
        Returns: number
      }
      club_cruce_detalle: {
        Args: { p_factura: string; p_location: string; p_pos: Json }
        Returns: {
          rol: string
          ticket_id: string
        }[]
      }
      club_cruce_facturas: {
        Args: { p_factura: string; p_location: string; p_pos: Json }
        Returns: string[]
      }
      club_cupon_contacto: {
        Args: { p_codigo: string; p_contacto: Json }
        Returns: boolean
      }
      club_cupon_crear: {
        Args: { p_codigo_referente: string; p_contacto?: Json }
        Returns: {
          codigo: string
          vence_en: string
        }[]
      }
      club_cupon_usar: {
        Args: {
          p_codigo: string
          p_factura: string
          p_op: string
          p_personas: number
          p_pos?: Json
        }
        Returns: {
          creditos: number
          miembro_id: string
          pendientes: number
          personas: number
        }[]
      }
      club_cupon_ver: { Args: { p_codigo: string }; Returns: Json }
      club_descuento_tipo_guardar: {
        Args: {
          p_activo: boolean
          p_id: string
          p_location?: string
          p_nombre: string
          p_pct: number
        }
        Returns: string
      }
      club_descuentos_tipo_listar: {
        Args: { p_location?: string }
        Returns: {
          activo: boolean
          actualizado_en: string
          id: string
          nombre: string
          pct: number
        }[]
      }
      club_excepcion_resolver: {
        Args: {
          p_location?: string
          p_nota: string
          p_ref: string
          p_tipo: string
        }
        Returns: boolean
      }
      club_excepcion_segregacion: {
        Args: {
          p_location: string
          p_ref: string
          p_rol: Database["public"]["Enums"]["user_role"]
          p_tipo: string
        }
        Returns: undefined
      }
      club_excepciones: {
        Args: {
          p_desde: string
          p_hasta: string
          p_location?: string
          p_tipo?: string
        }
        Returns: {
          certeza: string
          detalle: Json
          factura: string
          fecha: string
          nota: string
          ref: string
          resuelta: boolean
          resuelta_en: string
          tipo: string
        }[]
      }
      club_excepciones_abiertas: {
        Args: { p_dias?: number; p_location?: string }
        Returns: number
      }
      club_factura_clave: { Args: { p: string }; Returns: string }
      club_facturas_recientes: {
        Args: { p_location?: string }
        Returns: {
          area: string
          consecutivo_fe: string
          hora: string
          mesa: string
          numero_factura: string
          pedido: string
          total_crc: number
        }[]
      }
      club_gen_codigo: { Args: { p_largo: number }; Returns: string }
      club_local: {
        Args: { p_exigir_activo?: boolean; p_location: string }
        Returns: string
      }
      club_local_activo: { Args: { p_location: string }; Returns: boolean }
      club_local_crear: {
        Args: {
          p_copiar_de?: string
          p_direccion?: string
          p_id: string
          p_mapa?: string
          p_nombre: string
        }
        Returns: string
      }
      club_locales_activos: { Args: never; Returns: Json }
      club_marcador_guardar: {
        Args: {
          p_activo: boolean
          p_codigo: string
          p_id: string
          p_location?: string
          p_nombre: string
          p_pct: number
        }
        Returns: string
      }
      club_marcadores_listar: {
        Args: { p_location?: string }
        Returns: {
          activo: boolean
          actualizado_en: string
          codigo_producto: string
          id: string
          nombre: string
          pct_esperado: number
          visto_en_facturas: boolean
        }[]
      }
      club_miembro_codigo: { Args: { p_id: string }; Returns: string }
      club_miembro_guardar: {
        Args: {
          p_contacto: Json
          p_estado: string
          p_id: string
          p_location?: string
          p_negocio_id: string
          p_nombre: string
          p_tipo: string
        }
        Returns: string
      }
      club_miembro_por_telefono: { Args: { p_tel: string }; Returns: string }
      club_miembro_regenerar_codigo: {
        Args: { p_id: string }
        Returns: {
          codigo: string
          token_portal: string
        }[]
      }
      club_miembro_token: { Args: { p_id: string }; Returns: string }
      club_modo_pruebas: { Args: never; Returns: boolean }
      club_negocio_guardar: {
        Args: {
          p_activo: boolean
          p_id: string
          p_location?: string
          p_nombre: string
          p_tipo: string
        }
        Returns: string
      }
      club_nombre_limpio: { Args: { p: string }; Returns: string }
      club_nombre_pila: { Args: { p: string }; Returns: string }
      club_norm_factura: { Args: { p: string }; Returns: string }
      club_norm_telefono: { Args: { p: string }; Returns: string }
      club_norm_texto: { Args: { p: string }; Returns: string }
      club_num: { Args: { p: number }; Returns: string }
      club_pase_cursor_guardar: {
        Args: { p_id: number; p_nombre: string }
        Returns: undefined
      }
      club_pase_cursor_leer: { Args: { p_nombre: string }; Returns: number }
      club_pase_cursor_rebobinar: {
        Args: { p_id: number; p_motivo: string; p_nombre: string }
        Returns: undefined
      }
      club_pase_datos: { Args: { p_miembro: string }; Returns: Json }
      club_pase_emitido: {
        Args: { p_miembro: string; p_object_id: string; p_plataforma: string }
        Returns: undefined
      }
      club_pase_eventos_leer: {
        Args: { p_despues: number; p_limite?: number }
        Returns: {
          creado_en: string
          id: number
          miembro_id: string
          motivo: string
        }[]
      }
      club_pase_por_token: { Args: { p_token: string }; Returns: string }
      club_pase_token: {
        Args: { p_accion: string; p_miembro: string }
        Returns: boolean
      }
      club_pases_emitidos: {
        Args: { p_despues?: string; p_limite?: number; p_plataforma: string }
        Returns: {
          emitido_en: string
          miembro_id: string
          object_id: string
        }[]
      }
      club_pedidos_abiertos: {
        Args: { p_location?: string }
        Returns: {
          actualizado: string
          area: string
          clave: string
          mesa: string
          pax: number
          pedido: string
          salonero: string
          total_crc: number
        }[]
      }
      club_pendiente_resolver: {
        Args: { p_aprobar: boolean; p_id: string; p_nota: string }
        Returns: boolean
      }
      club_pendientes_listar: {
        Args: { p_location?: string }
        Returns: {
          creditos: number
          fecha_visita: string
          ganado_mes_crc: number
          id: string
          miembro_id: string
          nombre: string
          personas: number
          puedo_resolver: boolean
          registrado_por: string
        }[]
      }
      club_personas_proximo: {
        Args: { p_personas: number; p_ppc: number }
        Returns: number
      }
      club_portal: { Args: { p_token: string }; Returns: Json }
      club_pos_ref: { Args: { p: Json; p_location: string }; Returns: Json }
      club_premios_generar: { Args: { p_location?: string }; Returns: number }
      club_productos: {
        Args: { p_buscar?: string; p_location?: string }
        Returns: {
          codigo: string
          en_seccion: boolean
          es_cortesia: boolean
          familia: number
          nombre: string
          ultima: string
          veces: number
        }[]
      }
      club_promo_beneficio: {
        Args: { p: Database["public"]["Tables"]["club_promociones"]["Row"] }
        Returns: string
      }
      club_promo_vigente_en: {
        Args: {
          p: Database["public"]["Tables"]["club_promociones"]["Row"]
          p_ts: string
        }
        Returns: boolean
      }
      club_promocion_guardar: {
        Args: { p_datos: Json; p_id: string; p_location?: string }
        Returns: string
      }
      club_promociones_listar: {
        Args: { p_location?: string }
        Returns: {
          actualizada_en: string
          beneficio: string
          cortesias: number
          desde: string
          dias: number[]
          estado: string
          hasta: string
          hora_desde: string
          hora_hasta: string
          id: string
          nombre: string
          nombre_en: string
          para: string[]
          porcentaje: number
          vigente_ahora: boolean
        }[]
      }
      club_promociones_vigentes: {
        Args: { p_location: string; p_roles: string[]; p_ts: string }
        Returns: {
          actualizada_en: string
          actualizada_por: string | null
          cortesias: number
          creada_en: string
          creada_por: string | null
          desde: string | null
          dias: number[]
          estado: string
          hasta: string | null
          hora_desde: string | null
          hora_hasta: string | null
          id: string
          location_id: string
          nombre: string
          nombre_en: string | null
          para: string[]
          porcentaje: number
        }[]
        SetofOptions: {
          from: "*"
          to: "club_promociones"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      club_puente_fresco: { Args: { p_location: string }; Returns: boolean }
      club_referente_json: {
        Args: {
          p_codigo: string
          p_k: Database["public"]["Tables"]["club_codigos_canje"]["Row"]
          p_miembro: string
          p_tipo: string
        }
        Returns: Json
      }
      club_reporte_altas: {
        Args: { p_desde: string; p_hasta: string; p_location?: string }
        Returns: {
          altas_caja: number
          confirmo: number
          sin_confirmar: number
          usuario: string
          validaciones: number
          vencidas: number
        }[]
      }
      club_reporte_cerrar: {
        Args: { p_location?: string; p_mes: string; p_motivo?: string }
        Returns: Json
      }
      club_reporte_descuentos: {
        Args: { p_desde: string; p_hasta: string; p_location?: string }
        Returns: {
          descuento_crc: number
          facturas: number
          mes: string
          tipo: string
          turno: string
        }[]
      }
      club_reporte_mes: {
        Args: { p_location?: string; p_mes: string; p_vivo?: boolean }
        Returns: Json
      }
      club_reporte_visitas: {
        Args: { p_desde: string; p_hasta: string; p_location?: string }
        Returns: {
          como_invitado: number
          con_beneficio: number
          con_creditos: number
          max_mismo_socio: number
          sin_factura: number
          socios: number
          usuario: string
          visitas: number
        }[]
      }
      club_resolver: { Args: { p_texto: string }; Returns: Json }
      club_resolver_miembro: { Args: { p_id: string }; Returns: Json }
      club_rol_activar_anfitrion: {
        Args: { p_miembro: string; p_nota: string; p_rol: string }
        Returns: boolean
      }
      club_saldo_personas: { Args: { p_miembro: string }; Returns: number }
      club_sin_cruce_candidatas: {
        Args: { p_buscar?: string; p_movimiento: string }
        Returns: {
          area: string
          asignada_a_otro: boolean
          consecutivo_fe: string
          hora: string
          mesa: string
          misma_mesa: boolean
          numero_factura: string
          total_crc: number
        }[]
      }
      club_sin_cruce_elegir: {
        Args: {
          p_movimiento: string
          p_nota?: string
          p_numero_factura: string
        }
        Returns: string
      }
      club_socio_alta_caja: {
        Args: {
          p_email: string
          p_location?: string
          p_nombre: string
          p_verifico_residencia: boolean
          p_whatsapp: string
        }
        Returns: Json
      }
      club_socio_autoalta: { Args: { p_datos: Json }; Returns: Json }
      club_socio_baja_portal: { Args: { p_token: string }; Returns: boolean }
      club_socio_confirmar: {
        Args: { p_miembro: string; p_nota: string }
        Returns: boolean
      }
      club_socio_crear: {
        Args: {
          p_alta_por: string
          p_aviso: string
          p_email: string
          p_estado: string
          p_location: string
          p_nombre: string
          p_referido: string
          p_tel: string
        }
        Returns: string
      }
      club_socio_provisional: {
        Args: { p_dias: number; p_miembro: string }
        Returns: undefined
      }
      club_socio_solicitudes_abiertas: {
        Args: never
        Returns: {
          creada_en: string
          estado_socio: string
          miembro_id: string
          nombre: string
        }[]
      }
      club_socio_validar: {
        Args: {
          p_location?: string
          p_miembro: string
          p_verifico_residencia: boolean
        }
        Returns: Json
      }
      club_socio_visita: {
        Args: {
          p_location?: string
          p_miembro: string
          p_op: string
          p_pos: Json
        }
        Returns: Json
      }
      club_socios_mantenimiento: { Args: never; Returns: Json }
      club_socios_por_confirmar: {
        Args: never
        Returns: {
          alta_por: string
          miembro_id: string
          nombre: string
          provisional_hasta: string
          puedo_confirmar: boolean
          registrado_por: string
        }[]
      }
      club_tarjeta_manual: {
        Args: {
          p_factura: string
          p_miembro: string
          p_op: string
          p_personas: number
          p_pos?: Json
        }
        Returns: {
          creditos: number
          personas: number
        }[]
      }
      club_tiene_rol: {
        Args: { p_estados?: string[]; p_miembro: string; p_roles: string[] }
        Returns: boolean
      }
      club_vencer: {
        Args: { p_confirmo_total: number; p_corte: string }
        Returns: number
      }
      club_vencer_candidatos: {
        Args: { p_corte: string }
        Returns: {
          creditos: number
          limite: string
          location_id: string
          miembro_id: string
          personas: number
          personas_por_credito: number
          ultima_actividad: string
          valor_credito_crc: number
          vencimiento_meses: number
        }[]
      }
      club_vencer_simular: {
        Args: { p_corte: string }
        Returns: {
          creditos: number
          miembro_id: string
          nombre: string
          personas: number
          tipo: string
          ultima_actividad: string
        }[]
      }
      club_visita_canonica: {
        Args: { p_factura: string; p_location: string; p_pos: Json }
        Returns: string
      }
      club_visita_control: {
        Args: {
          p_factura: string
          p_location: string
          p_miembro: string
          p_personas: number
          p_pos: Json
          p_visita: string
        }
        Returns: undefined
      }
      club_web_clave_cargar: { Args: { p_sha256: string }; Returns: number }
      club_web_ok: { Args: never; Returns: boolean }
      complete_inventory_review: {
        Args: { p_lines: Json; p_note: string; p_task_id: string }
        Returns: undefined
      }
      create_supplier_credit: {
        Args: {
          p_amount_crc: number
          p_amount_usd?: number
          p_client_op_id?: string
          p_currency?: string
          p_document_id?: string
          p_fecha_origen?: string
          p_motivo?: string
          p_origin: string
          p_referencia?: string
          p_source_movement_id?: string
          p_supplier_id: string
        }
        Returns: string
      }
      delete_movement_cascade: {
        Args: {
          p_manager_email?: string
          p_manager_password?: string
          p_movement_id: string
          p_note: string
        }
        Returns: undefined
      }
      delete_supplier_credit: {
        Args: { p_credit_id: string; p_note: string }
        Returns: undefined
      }
      derivar_work_days: {
        Args: { p_desde: string; p_hasta: string; p_local: string }
        Returns: Json
      }
      deshacer_cierre_dia: {
        Args: {
          p_fecha: string
          p_manager_email?: string
          p_manager_password?: string
        }
        Returns: Json
      }
      discard_inventory_review: {
        Args: { p_reason: string; p_task_id: string }
        Returns: undefined
      }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      mark_factura_verified: {
        Args: { p_movement_id: string }
        Returns: undefined
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
      pos_ndf_ingestar: {
        Args: {
          p_cursor: Json
          p_lineas: Json
          p_local: string
          p_open: Json
          p_tickets: Json
        }
        Returns: Json
      }
      pos_prompax_agregado: {
        Args: { p_desde: string; p_hasta: string; p_local: string }
        Returns: Json
      }
      pos_reopen_orden: {
        Args: { p_by: string; p_order_id: string; p_reason: string }
        Returns: undefined
      }
      pos_unmerge_orden: {
        Args: { p_from: string; p_into: string }
        Returns: undefined
      }
      pos_ventas_latido: {
        Args: { p_local: string }
        Returns: {
          last_poll_at: string
        }[]
      }
      pos_ventas_lineas: {
        Args: { p_limit?: number; p_offset?: number; p_ticket_ids: string[] }
        Returns: {
          cantidad: number
          codigo_producto: string
          familia: number
          monto: number
          nombre: string
          ticket_id: string
          usuario_registra: string
        }[]
      }
      pos_ventas_tickets_rango: {
        Args: {
          p_desde: string
          p_hasta: string
          p_limit?: number
          p_local: string
          p_offset?: number
        }
        Returns: {
          cajero_login: string
          canal: string
          estado: string
          fecha_cierra: string
          fecha_registra: string
          id: string
          iva_crc: number
          mesa: string
          numero_factura: string
          pax: number
          pax_articulo: number
          regalia_crc: number
          registrado_por: string
          salonero_login: string
          servicio_crc: number
          total_crc: number
          valor_servido_crc: number
        }[]
      }
      post_accounting_entry: {
        Args: {
          p_account_id: string
          p_amount_crc: number
          p_client_op_id?: string
          p_currency?: string
          p_entry_date: string
          p_fx_rate?: number
          p_kind: string
          p_note?: string
          p_source_id: string
          p_source_type: string
        }
        Returns: string
      }
      sync_pos_tips_to_pool: {
        Args: { p_date: string; p_session_id: string }
        Returns: Json
      }
      verify_manager: {
        Args: { p_email: string; p_password: string }
        Returns: boolean
      }
      verify_manager_password: { Args: { p_password: string }; Returns: Json }
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

